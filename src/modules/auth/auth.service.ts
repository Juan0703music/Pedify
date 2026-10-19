import { createHash, randomBytes } from "node:crypto";
import { prisma, type DbClient } from "../../config/database.js";
import { env } from "../../config/env.js";
import type { AuthContext } from "../../types/common.js";
import { mailer } from "../../services/mail.service.js";
import { badRequest, conflict, forbidden, unauthorized } from "../../utils/errors.js";
import { escapeHtml } from "../../utils/html.js";
import { logger } from "../../utils/logger.js";
import { businessesRepository } from "../businesses/businesses.repository.js";
import { businessesService } from "../businesses/businesses.service.js";
import { pushRepository } from "../push/push.repository.js";
import { authRepository } from "./auth.repository.js";
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  UpdateProfileInput,
} from "./auth.schemas.js";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = env.SESSION_TTL_DAYS * DAY_MS;
/** Vida máxima de una sesión aunque se siga usando; después hay que volver a iniciar sesión. */
const SESSION_MAX_LIFETIME_MS = Math.max(30, env.SESSION_TTL_DAYS) * DAY_MS;
/** Frecuencia máxima con la que se actualiza `last_used_at` (evita una escritura por petición). */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
/** Vigencia del enlace para restablecer la contraseña. */
const RESET_TTL_MS = 30 * 60 * 1000;

interface ClientMeta {
  userAgent?: string;
}

export interface NewSession {
  token: string;
  expiresAt: Date;
}

/** Token aleatorio de 256 bits; en la base solo se guarda su SHA-256. */
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Crea la sesión y devuelve el token (para la cookie) y el contexto de autenticación. */
async function openSession(
  userId: string,
  activeBusinessId: string | null,
  meta: ClientMeta,
  db: DbClient = prisma,
): Promise<{ auth: AuthContext; session: NewSession }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const { id } = await authRepository.createSession(
    { userId, tokenHash: hashToken(token), activeBusinessId, userAgent: meta.userAgent?.slice(0, 255), expiresAt },
    db,
  );
  return { auth: { userId, sessionId: id, activeBusinessId }, session: { token, expiresAt } };
}

export const authService = {
  /** Crea la cuenta del comerciante, su negocio (como propietario) y la sesión, todo en una transacción. */
  async register(input: RegisterInput, meta: ClientMeta) {
    if (await authRepository.findUserByEmail(input.email)) {
      throw conflict("Ya existe una cuenta con ese correo. Inicia sesión.", "EMAIL_TAKEN");
    }
    const passwordHash = await hashPassword(input.password);

    return prisma.$transaction(async (tx) => {
      const user = await authRepository.createUser(
        { name: input.name, email: input.email, passwordHash, privacyAcceptedAt: new Date() },
        tx,
      );
      const business = await businessesService.createForOwner(
        user.id,
        { name: input.businessName, phone: input.businessPhone },
        tx,
      );
      return openSession(user.id, business.id, meta, tx);
    });
  },

  async login(input: LoginInput, meta: ClientMeta) {
    const credentials = await authRepository.findCredentialsByEmail(input.email);
    const valid = credentials
      ? await verifyPassword(credentials.passwordHash, input.password)
      : await verifyAgainstDummy(input.password);

    if (!credentials || !valid) {
      throw unauthorized("Correo o contraseña incorrectos.", "INVALID_CREDENTIALS");
    }

    const memberships = await businessesRepository.listUserMemberships(credentials.id);
    // El rol elegido al entrar debe ser el de la cuenta; además define con qué negocio empieza.
    const matching = input.as ? memberships.filter((membership) => membership.role === input.as) : memberships;
    if (input.as && matching.length === 0 && (input.as === "EMPLOYEE" || memberships.length > 0)) {
      throw forbidden(
        input.as === "EMPLOYEE"
          ? "Esta cuenta no es de empleado. Elige «Soy el dueño» para entrar."
          : "Esta cuenta es de empleado. Elige «Soy empleado» para entrar.",
        "ROLE_MISMATCH",
      );
    }
    const opened = await openSession(credentials.id, (matching[0] ?? memberships[0])?.businessId ?? null, meta);
    await authRepository.deleteStaleSessions(credentials.id, new Date(Date.now() - SESSION_MAX_LIFETIME_MS));
    return opened;
  },

  /**
   * Valida el token de la cookie. Devuelve null si no existe, fue revocado o venció.
   * Renovación deslizante: cuando queda menos de la mitad de la vida, se extiende.
   */
  async resolveSession(token: string): Promise<{ auth: AuthContext; renewedExpiresAt: Date | null } | null> {
    const session = await authRepository.findSessionByTokenHash(hashToken(token));
    const now = Date.now();
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now) return null;

    let renewedExpiresAt: Date | null = null;
    const remaining = session.expiresAt.getTime() - now;
    const hardLimit = session.createdAt.getTime() + SESSION_MAX_LIFETIME_MS;

    if (remaining < SESSION_TTL_MS / 2 && session.expiresAt.getTime() < hardLimit) {
      renewedExpiresAt = new Date(Math.min(now + SESSION_TTL_MS, hardLimit));
      await authRepository.touchSession(session.id, { lastUsedAt: new Date(now), expiresAt: renewedExpiresAt });
    } else if (now - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
      await authRepository.touchSession(session.id, { lastUsedAt: new Date(now) });
    }

    return {
      auth: { userId: session.userId, sessionId: session.id, activeBusinessId: session.activeBusinessId },
      renewedExpiresAt,
    };
  },

  /** Usuario, negocios a los que pertenece y negocio activo de la sesión. */
  async getProfile(auth: AuthContext) {
    const user = await authRepository.findUserById(auth.userId);
    if (!user) throw unauthorized();

    const businesses = await businessesService.listMine(auth.userId);
    let activeBusinessId = auth.activeBusinessId;

    // Si el usuario perdió acceso al negocio activo, la sesión pasa al primero disponible.
    if (!businesses.some((business) => business.id === activeBusinessId)) {
      activeBusinessId = businesses[0]?.id ?? null;
      await authRepository.setActiveBusiness(auth.sessionId, activeBusinessId);
    }

    return { user, businesses, activeBusinessId };
  },

  async updateProfile(auth: AuthContext, input: UpdateProfileInput) {
    return authRepository.updateUser(auth.userId, { name: input.name });
  },

  async switchBusiness(auth: AuthContext, businessId: string) {
    const membership = await businessesRepository.findMembership(auth.userId, businessId);
    if (!membership) throw forbidden("No tienes acceso a este negocio.", "NOT_A_MEMBER");
    await authRepository.setActiveBusiness(auth.sessionId, businessId);
  },

  /** Cambia la contraseña y cierra todas las demás sesiones abiertas. */
  async changePassword(auth: AuthContext, input: ChangePasswordInput) {
    const credentials = await authRepository.findCredentialsById(auth.userId);
    if (!credentials) throw unauthorized();
    if (!(await verifyPassword(credentials.passwordHash, input.currentPassword))) {
      throw forbidden("La contraseña actual no es correcta.", "INVALID_PASSWORD");
    }
    await authRepository.updateUser(auth.userId, { passwordHash: await hashPassword(input.newPassword) });
    await authRepository.revokeUserSessions(auth.userId, auth.sessionId);
  },

  async logout(auth: AuthContext) {
    await authRepository.revokeSession(auth.sessionId);
  },

  /** Cierra la sesión en todos los dispositivos (incluido el actual). */
  async logoutAll(auth: AuthContext) {
    await authRepository.revokeUserSessions(auth.userId);
    // Ningún dispositivo sigue recibiendo avisos de pedidos de esta cuenta.
    await pushRepository.deleteByUser(auth.userId);
  },

  /**
   * Recuperación de contraseña (sección 12): si el correo tiene cuenta, se envía un enlace de un solo
   * uso válido por 30 minutos. La respuesta es la misma exista o no la cuenta, y el correo se envía
   * sin esperar para que el tiempo de respuesta tampoco lo delate.
   */
  async forgotPassword(input: ForgotPasswordInput) {
    const user = await authRepository.findUserByEmail(input.email);
    if (!user) return;
    const token = randomBytes(32).toString("base64url");
    await authRepository.createPasswordReset(user.id, hashToken(token), new Date(Date.now() + RESET_TTL_MS));
    const link = new URL(`/restablecer?token=${token}`, env.APP_URL).toString();
    const firstName = user.name.split(" ")[0] ?? user.name;
    void mailer
      .send({
        to: user.email,
        subject: "Restablece tu contraseña de Pedify",
        text: [
          `Hola, ${firstName}:`,
          "",
          "Recibimos una solicitud para restablecer la contraseña de tu cuenta de Pedify.",
          `Ábrela en los próximos 30 minutos desde este enlace: ${link}`,
          "",
          "Si no fuiste tú, ignora este correo: tu contraseña no cambia.",
        ].join("\n"),
        html: `<p>Hola, ${escapeHtml(firstName)}:</p>
<p>Recibimos una solicitud para restablecer la contraseña de tu cuenta de Pedify.</p>
<p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#17161c;color:#ffffff;border-radius:10px;text-decoration:none;font-weight:600">Crear una contraseña nueva</a></p>
<p>El enlace vence en 30 minutos y solo se puede usar una vez.</p>
<p style="color:#5c5a63">Si no fuiste tú, ignora este correo: tu contraseña no cambia.</p>`,
      })
      .catch((err) => logger.error({ err }, "No se pudo enviar el correo de recuperación"));
  },

  /** Cambia la contraseña con un enlace válido y cierra todas las sesiones de la cuenta. */
  async resetPassword(input: ResetPasswordInput) {
    const invalid = () => badRequest("El enlace venció o ya se usó. Pide uno nuevo.", "RESET_LINK_INVALID");
    const reset = await authRepository.findPasswordReset(hashToken(input.token));
    if (!reset || reset.usedAt || reset.expiresAt.getTime() <= Date.now()) throw invalid();
    const passwordHash = await hashPassword(input.newPassword);
    await prisma.$transaction(async (tx) => {
      if (!(await authRepository.consumePasswordReset(reset.id, tx))) throw invalid();
      await authRepository.updateUser(reset.userId, { passwordHash }, tx);
      await authRepository.revokeUserSessions(reset.userId, undefined, tx);
      await tx.pushSubscription.deleteMany({ where: { userId: reset.userId } });
    });
  },
};
