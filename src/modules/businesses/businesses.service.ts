import { randomBytes } from "node:crypto";
import { prisma, type DbClient } from "../../config/database.js";
import type { MembershipRole } from "../../generated/prisma/enums.js";
import type { TenantContext } from "../../types/common.js";
import { deleteImage, saveImage } from "../../services/storage.service.js";
import { badRequest, conflict, notFound } from "../../utils/errors.js";
import { newTrialEnd, subscriptionsService } from "../subscriptions/subscriptions.service.js";
import { authRepository } from "../auth/auth.repository.js";
import { hashPassword } from "../auth/password.js";
import { businessesRepository } from "./businesses.repository.js";
import type {
  AddMemberInput,
  CreateBusinessInput,
  DaySchedule,
  UpdateBusinessInput,
  UpdateSettingsInput,
} from "./businesses.schemas.js";

/** Imágenes de la tienda: logo (cuadrado) y portada (banner). */
export type BusinessImage = "logo" | "banner";

const IMAGE_FIELDS = {
  logo: { url: "logoUrl", key: "logoKey" },
  banner: { url: "bannerUrl", key: "bannerKey" },
} as const;

/** Horario inicial: todos los días de 11:00 a 22:00 (el comerciante lo ajusta en Configuración). */
export const DEFAULT_OPENING_HOURS: DaySchedule[] = Array.from({ length: 7 }, (_, day) => ({
  day,
  closed: false,
  open: "11:00",
  close: "22:00",
}));

/** "Sabores del Caribe" → "sabores-del-caribe" */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " y ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return slug.length >= 3 ? slug : `negocio-${slug || randomBytes(2).toString("hex")}`.replace(/-+$/g, "");
}

async function generateUniqueSlug(name: string, db: DbClient): Promise<string> {
  const base = slugify(name);
  if (!(await businessesRepository.slugExists(base, db))) return base;
  for (let suffix = 2; suffix <= 20; suffix++) {
    const candidate = `${base.slice(0, 46)}-${suffix}`;
    if (!(await businessesRepository.slugExists(candidate, db))) return candidate;
  }
  return `${base.slice(0, 44)}-${randomBytes(3).toString("hex")}`;
}

export const businessesService = {
  /** Registra un negocio con el usuario como propietario. Acepta un cliente de transacción. */
  async createForOwner(ownerId: string, input: CreateBusinessInput, db: DbClient = prisma) {
    const slug = await generateUniqueSlug(input.name, db);
    return businessesRepository.createWithOwner(
      {
        name: input.name,
        slug,
        phone: input.phone,
        ownerId,
        trialEndsAt: newTrialEnd(),
        settings: {
          openingHours: DEFAULT_OPENING_HOURS,
          // Si el teléfono del negocio es celular, se usa también como WhatsApp inicial.
          whatsappPhone: input.phone.startsWith("573") ? input.phone : null,
          paymentMethods: ["CASH"],
        },
      },
      db,
    );
  },

  async createAdditional(userId: string, input: CreateBusinessInput) {
    return prisma.$transaction((tx) => businessesService.createForOwner(userId, input, tx));
  },

  async listMine(userId: string) {
    const memberships = await businessesRepository.listUserMemberships(userId);
    return memberships.map(({ business, role }) => ({ ...business, role }));
  },

  async getCurrent(tenant: TenantContext) {
    const business = await businessesRepository.findById(tenant.businessId);
    if (!business) throw notFound("No encontramos el negocio.");
    return { ...business, role: tenant.role, subscription: await subscriptionsService.summary(tenant.businessId) };
  },

  async updateCurrent(tenant: TenantContext, input: UpdateBusinessInput) {
    if (input.slug) {
      const current = await businessesRepository.findById(tenant.businessId);
      if (current && current.slug !== input.slug && (await businessesRepository.slugExists(input.slug))) {
        throw conflict("Ese enlace ya lo usa otro negocio. Prueba con otro.", "SLUG_TAKEN");
      }
    }
    return businessesRepository.update(tenant.businessId, input);
  },

  /** Guarda el logo o la portada (procesados en el servidor) y borra la imagen anterior. */
  async setImage(tenant: TenantContext, kind: BusinessImage, file: Buffer) {
    const fields = IMAGE_FIELDS[kind];
    const previous = await businessesRepository.findImageKeys(tenant.businessId);
    const saved = await saveImage(file, kind, `businesses/${tenant.businessId}/${kind}`);
    let business;
    try {
      business = await businessesRepository.update(tenant.businessId, { [fields.url]: saved.url, [fields.key]: saved.key });
    } catch (error) {
      await deleteImage(saved.key);
      throw error;
    }
    await deleteImage(previous?.[fields.key]);
    return business;
  },

  async removeImage(tenant: TenantContext, kind: BusinessImage) {
    const fields = IMAGE_FIELDS[kind];
    const previous = await businessesRepository.findImageKeys(tenant.businessId);
    const business = await businessesRepository.update(tenant.businessId, { [fields.url]: null, [fields.key]: null });
    await deleteImage(previous?.[fields.key]);
    return business;
  },

  async getSettings(tenant: TenantContext) {
    const settings = await businessesRepository.findSettings(tenant.businessId);
    if (!settings) throw notFound("El negocio no tiene configuración.");
    return settings;
  },

  async updateSettings(tenant: TenantContext, input: UpdateSettingsInput) {
    const current = await businessesService.getSettings(tenant);
    const deliveryEnabled = input.deliveryEnabled ?? current.deliveryEnabled;
    const pickupEnabled = input.pickupEnabled ?? current.pickupEnabled;
    if (!deliveryEnabled && !pickupEnabled) {
      throw badRequest("Activa al menos una modalidad de entrega: domicilio o recoger.", "NO_DELIVERY_MODE");
    }
    return businessesRepository.updateSettings(tenant.businessId, input);
  },

  async listMembers(tenant: TenantContext) {
    return businessesRepository.listMembers(tenant.businessId);
  },

  /**
   * Agrega un miembro. Si el correo ya tiene cuenta, solo se vincula al negocio;
   * si no, se crea la cuenta con la contraseña inicial indicada por el propietario.
   */
  async addMember(tenant: TenantContext, input: AddMemberInput) {
    return prisma.$transaction(async (tx) => {
      await subscriptionsService.assertLimit(tenant.businessId, "members", tx);
      const existing = await authRepository.findUserByEmail(input.email, tx);
      if (existing) {
        if (await businessesRepository.findMembership(existing.id, tenant.businessId, tx)) {
          throw conflict("Esa persona ya pertenece a tu negocio.", "ALREADY_MEMBER");
        }
        return businessesRepository.createMembership(
          { userId: existing.id, businessId: tenant.businessId, role: input.role },
          tx,
        );
      }

      if (!input.password) {
        throw badRequest("Ese correo no tiene cuenta. Escribe una contraseña inicial para crearla.", "PASSWORD_REQUIRED", {
          fields: { password: "Escribe una contraseña inicial." },
        });
      }
      const user = await authRepository.createUser(
        { name: input.name, email: input.email, passwordHash: await hashPassword(input.password) },
        tx,
      );
      return businessesRepository.createMembership({ userId: user.id, businessId: tenant.businessId, role: input.role }, tx);
    });
  },

  /** Cambia el rol de un miembro; el negocio nunca puede quedar sin propietario. */
  async updateMemberRole(tenant: TenantContext, membershipId: string, role: MembershipRole) {
    return prisma.$transaction(
      async (tx) => {
        const member = await businessesRepository.findMember(membershipId, tenant.businessId, tx);
        if (!member) throw notFound("No encontramos ese miembro.");
        if (member.role === "OWNER" && role !== "OWNER" && (await businessesRepository.countOwners(tenant.businessId, tx)) <= 1) {
          throw conflict("El negocio debe tener al menos un propietario.", "LAST_OWNER");
        }
        return businessesRepository.updateMembershipRole(membershipId, role, tx);
      },
      { isolationLevel: "Serializable" },
    );
  },

  async removeMember(tenant: TenantContext, membershipId: string) {
    await prisma.$transaction(
      async (tx) => {
        const member = await businessesRepository.findMember(membershipId, tenant.businessId, tx);
        if (!member) throw notFound("No encontramos ese miembro.");
        if (member.role === "OWNER" && (await businessesRepository.countOwners(tenant.businessId, tx)) <= 1) {
          throw conflict("No puedes quitar al único propietario del negocio.", "LAST_OWNER");
        }
        await businessesRepository.deleteMembership(membershipId, tx);
      },
      { isolationLevel: "Serializable" },
    );
  },
};
