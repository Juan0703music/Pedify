import { prisma, type DbClient } from "../../config/database.js";
import type { PlanCode } from "../../generated/prisma/enums.js";

const subscriptionSelect = { businessId: true, plan: true, trialEndsAt: true, paidUntil: true, createdAt: true } as const;

const paymentSelect = {
  id: true,
  plan: true,
  amount: true,
  months: true,
  method: true,
  reference: true,
  note: true,
  periodStart: true,
  periodEnd: true,
  createdAt: true,
  recordedBy: { select: { name: true } },
} as const;

export const subscriptionsRepository = {
  find(businessId: string, db: DbClient = prisma) {
    return db.subscription.findUnique({ where: { businessId }, select: subscriptionSelect });
  },

  /** Crea la suscripción de prueba si el negocio no tiene (negocios creados antes de la fase 5). */
  ensure(businessId: string, trialEndsAt: Date, db: DbClient = prisma) {
    return db.subscription.upsert({
      where: { businessId },
      create: { businessId, trialEndsAt },
      update: {},
      select: subscriptionSelect,
    });
  },

  update(businessId: string, data: { plan?: PlanCode; trialEndsAt?: Date; paidUntil?: Date | null }, db: DbClient = prisma) {
    return db.subscription.update({ where: { businessId }, data, select: subscriptionSelect });
  },

  createPayment(
    data: {
      businessId: string;
      plan: PlanCode;
      amount: number;
      months: number;
      method: string;
      reference: string | null;
      note: string | null;
      periodStart: Date;
      periodEnd: Date;
      recordedById: string;
    },
    db: DbClient = prisma,
  ) {
    return db.subscriptionPayment.create({ data, select: paymentSelect });
  },

  listPayments(businessId: string, take = 24) {
    return prisma.subscriptionPayment.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take, select: paymentSelect });
  },

  async usage(businessId: string, db: DbClient = prisma) {
    const [products, members] = await Promise.all([
      db.product.count({ where: { businessId, archivedAt: null } }),
      db.businessMembership.count({ where: { businessId } }),
    ]);
    return { products, members };
  },
};
