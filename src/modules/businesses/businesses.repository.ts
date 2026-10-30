import { prisma, type DbClient } from "../../config/database.js";
import { permissionColumnsSelect, type PermissionColumns } from "./permissions.js";
import type { IdDocumentType, MembershipRole, PaymentMethod, PlanCode } from "../../generated/prisma/enums.js";
import type { Prisma } from "../../generated/prisma/client.js";

export const businessSelect = {
  id: true,
  name: true,
  slug: true,
  phone: true,
  status: true,
  description: true,
  city: true,
  address: true,
  logoUrl: true,
  bannerUrl: true,
  legalName: true,
  idType: true,
  idNumber: true,
  contactEmail: true,
  createdAt: true,
} as const;

/** Quién vende: nombre o razón social y documento (se muestran en la tienda). */
export interface BusinessLegal {
  legalName: string;
  idType: IdDocumentType;
  idNumber: string;
}

export const settingsSelect = {
  openingHours: true,
  timezone: true,
  acceptingOrders: true,
  whatsappPhone: true,
  deliveryEnabled: true,
  deliveryPricing: true,
  deliveryFee: true,
  deliveryTiers: true,
  deliveryExtraKmFee: true,
  deliveryMaxKm: true,
  locationLat: true,
  locationLng: true,
  deliveryArea: true,
  pickupEnabled: true,
  dineInEnabled: true,
  minimumOrder: true,
  paymentMethods: true,
  salesPolicy: true,
  updatedAt: true,
} as const;

const memberSelect = {
  id: true,
  role: true,
  createdAt: true,
  ...permissionColumnsSelect,
  user: { select: { id: true, name: true, email: true } },
} as const;

export const businessesRepository = {
  findById(id: string) {
    return prisma.business.findUnique({ where: { id }, select: businessSelect });
  },

  async slugExists(slug: string, db: DbClient = prisma): Promise<boolean> {
    return (await db.business.count({ where: { slug } })) > 0;
  },

  /** Crea el negocio con su configuración inicial y el propietario como primer miembro. */
  createWithOwner(
    data: {
      name: string;
      slug: string;
      phone: string;
      ownerId: string;
      trialPlan: PlanCode;
      trialEndsAt: Date;
      legal?: BusinessLegal;
      settings: {
        openingHours: Prisma.InputJsonValue;
        whatsappPhone: string | null;
        paymentMethods: PaymentMethod[];
      };
    },
    db: DbClient = prisma,
  ) {
    return db.business.create({
      data: {
        name: data.name,
        slug: data.slug,
        phone: data.phone,
        ...data.legal,
        memberships: { create: { userId: data.ownerId, role: "OWNER" } },
        settings: { create: data.settings },
        subscription: { create: { plan: data.trialPlan, trialEndsAt: data.trialEndsAt } },
      },
      select: businessSelect,
    });
  },

  findImageKeys(id: string) {
    return prisma.business.findUnique({ where: { id }, select: { logoKey: true, bannerKey: true } });
  },

  /** Tienda pública: datos visibles del negocio y su configuración. */
  findStoreBySlug(slug: string) {
    return prisma.business.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        description: true,
        city: true,
        address: true,
        phone: true,
        logoUrl: true,
        bannerUrl: true,
        legalName: true,
        idType: true,
        idNumber: true,
        contactEmail: true,
        settings: { select: settingsSelect },
      },
    });
  },

  update(id: string, data: Prisma.BusinessUpdateInput) {
    return prisma.business.update({ where: { id }, data, select: businessSelect });
  },

  findSettings(businessId: string) {
    return prisma.businessSettings.findUnique({ where: { businessId }, select: settingsSelect });
  },

  updateSettings(businessId: string, data: Prisma.BusinessSettingsUpdateInput) {
    return prisma.businessSettings.update({ where: { businessId }, data, select: settingsSelect });
  },

  findMembership(userId: string, businessId: string, db: DbClient = prisma) {
    return db.businessMembership.findUnique({
      where: { userId_businessId: { userId, businessId } },
      select: { id: true, role: true, businessId: true, ...permissionColumnsSelect, business: { select: { status: true } } },
    });
  },

  listUserMemberships(userId: string) {
    return prisma.businessMembership.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { businessId: true, role: true, business: { select: { id: true, name: true, slug: true, status: true } } },
    });
  },

  listMembers(businessId: string) {
    return prisma.businessMembership.findMany({
      where: { businessId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: memberSelect,
    });
  },

  /** Busca un miembro siempre dentro del negocio indicado (nunca solo por id). */
  findMember(membershipId: string, businessId: string, db: DbClient = prisma) {
    return db.businessMembership.findFirst({ where: { id: membershipId, businessId }, select: memberSelect });
  },

  createMembership(
    data: { userId: string; businessId: string; role: MembershipRole } & Partial<PermissionColumns>,
    db: DbClient = prisma,
  ) {
    return db.businessMembership.create({ data, select: memberSelect });
  },

  updateMembership(membershipId: string, data: Prisma.BusinessMembershipUpdateInput, db: DbClient = prisma) {
    return db.businessMembership.update({ where: { id: membershipId }, data, select: memberSelect });
  },

  deleteMembership(membershipId: string, db: DbClient = prisma) {
    return db.businessMembership.delete({ where: { id: membershipId }, select: { id: true } });
  },

  countOwners(businessId: string, db: DbClient = prisma) {
    return db.businessMembership.count({ where: { businessId, role: "OWNER" } });
  },
};
