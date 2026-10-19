import { randomBytes } from "node:crypto";
import { DEFAULT_EMPLOYEE_PERMISSIONS, permissionsOf, toPermissionColumns } from "./permissions.js";
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
  UpdateMemberInput,
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

type StoredMember = Awaited<ReturnType<typeof businessesRepository.listMembers>>[number];

/** Miembro para la API: sus permisos efectivos en lugar de las columnas. */
function toMember(member: StoredMember) {
  const { canMarkSoldOut: _a, canViewSales: _b, canViewCustomers: _c, canViewAnalytics: _d, ...rest } = member;
  return { ...rest, permissions: permissionsOf(member) };
}

/** Permisos de un miembro nuevo: los indicados, sobre los valores iniciales de un empleado. */
function permissionsFor(input: AddMemberInput) {
  return toPermissionColumns({ ...DEFAULT_EMPLOYEE_PERMISSIONS, ...(input.permissions ?? {}) });
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
    return {
      ...business,
      role: tenant.role,
      permissions: tenant.permissions,
      subscription: await subscriptionsService.summary(tenant.businessId),
    };
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
    return (await businessesRepository.listMembers(tenant.businessId)).map(toMember);
  },

  /**
   * Agrega un miembro. Si el correo ya tiene cuenta, solo se vincula al negocio y la persona sigue
   * entrando con SU contraseña (un propietario nunca puede cambiar la contraseña de una cuenta que
   * ya existe); la respuesta lo indica con `existingAccount: true` para avisarle al propietario.
   * Si no tiene cuenta, se crea con la contraseña inicial indicada por el propietario.
   */
  async addMember(tenant: TenantContext, input: AddMemberInput) {
    return prisma.$transaction(async (tx) => {
      await subscriptionsService.assertLimit(tenant.businessId, "members", tx);
      const existing = await authRepository.findUserByEmail(input.email, tx);
      if (existing) {
        if (await businessesRepository.findMembership(existing.id, tenant.businessId, tx)) {
          throw conflict("Esa persona ya pertenece a tu negocio.", "ALREADY_MEMBER");
        }
        return {
          ...toMember(
            await businessesRepository.createMembership({ userId: existing.id, businessId: tenant.businessId, role: input.role, ...permissionsFor(input) }, tx),
          ),
          existingAccount: true,
        };
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
      return {
        ...toMember(
          await businessesRepository.createMembership({ userId: user.id, businessId: tenant.businessId, role: input.role, ...permissionsFor(input) }, tx),
        ),
        existingAccount: false,
      };
    });
  },

  /** Cambia el rol o los permisos de un miembro; el negocio nunca puede quedar sin propietario. */
  async updateMember(tenant: TenantContext, membershipId: string, input: UpdateMemberInput) {
    return prisma.$transaction(
      async (tx) => {
        const member = await businessesRepository.findMember(membershipId, tenant.businessId, tx);
        if (!member) throw notFound("No encontramos ese miembro.");
        const role = input.role ?? member.role;
        if (member.role === "OWNER" && role !== "OWNER" && (await businessesRepository.countOwners(tenant.businessId, tx)) <= 1) {
          throw conflict("El negocio debe tener al menos un propietario.", "LAST_OWNER");
        }
        const updated = await businessesRepository.updateMembership(
          membershipId,
          { role, ...toPermissionColumns(input.permissions ?? {}) },
          tx,
        );
        return toMember(updated);
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
