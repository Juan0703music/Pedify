import { prisma, type DbClient } from "../../config/database.js";
import { env } from "../../config/env.js";
import type { TenantContext } from "../../types/common.js";
import { clock } from "../../utils/clock.js";
import { conflict } from "../../utils/errors.js";
import { planOf, PLANS, TRIAL_DAYS, UPGRADE } from "./plans.js";
import { subscriptionState } from "./subscription-state.js";
import { subscriptionsRepository } from "./subscriptions.repository.js";

export const newTrialEnd = () => new Date(clock.now().getTime() + TRIAL_DAYS * 86_400_000);

/** Suscripción del negocio con su plan y su estado calculado a la fecha. */
async function current(businessId: string, db: DbClient = prisma) {
  const subscription = (await subscriptionsRepository.find(businessId, db)) ?? (await subscriptionsRepository.ensure(businessId, newTrialEnd(), db));
  return { subscription, plan: planOf(subscription.plan), state: subscriptionState(subscription, clock.now()) };
}

export const subscriptionsService = {
  current,

  /** Resumen para el panel (va en GET /businesses/current). */
  async summary(businessId: string) {
    const { subscription, plan, state } = await current(businessId);
    return {
      plan: subscription.plan,
      planName: plan.name,
      status: state.status,
      endsAt: state.endsAt,
      daysLeft: state.daysLeft,
      graceEndsAt: state.graceEndsAt,
      canReceiveOrders: state.canReceiveOrders,
    };
  },

  /** Página "Mi plan": estado, uso frente a los límites, planes disponibles, pagos y cómo pagar. */
  async details(tenant: TenantContext, business: { name: string; storeUrl: string }) {
    const [{ subscription, plan, state }, usage, payments] = await Promise.all([
      current(tenant.businessId),
      subscriptionsRepository.usage(tenant.businessId),
      subscriptionsRepository.listPayments(tenant.businessId),
    ]);
    const message = `Hola, quiero pagar el plan ${plan.name} de Pedify para mi negocio ${business.name} (${business.storeUrl}).`;
    return {
      plan: subscription.plan,
      planName: plan.name,
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      annualDiscountPercent: plan.annualDiscountPercent,
      trialEndsAt: subscription.trialEndsAt,
      paidUntil: subscription.paidUntil,
      ...state,
      usage,
      limits: { products: plan.maxProducts, members: plan.maxMembers },
      plans: Object.values(PLANS),
      payments,
      support: env.SUPPORT_WHATSAPP
        ? { whatsapp: env.SUPPORT_WHATSAPP, url: `https://wa.me/${env.SUPPORT_WHATSAPP}?text=${encodeURIComponent(message)}` }
        : null,
    };
  },

  /** Verifica el límite del plan antes de agregar un producto o una persona al equipo. */
  async assertLimit(businessId: string, kind: "products" | "members", db: DbClient = prisma) {
    const { plan } = await current(businessId, db);
    const limit = kind === "products" ? plan.maxProducts : plan.maxMembers;
    if (limit === null) return; // plan sin límite
    const usage = await subscriptionsRepository.usage(businessId, db);
    if (usage[kind] >= limit) {
      const what = kind === "products" ? `${limit} productos` : `${limit} ${limit === 1 ? "persona" : "personas"} en el equipo`;
      const next = UPGRADE[plan.code];
      const upgrade = next ? ` Pásate al plan ${planOf(next).name} para agregar más.` : "";
      throw conflict(`Tu plan ${plan.name} permite hasta ${what}.${upgrade}`, "PLAN_LIMIT");
    }
  },
};
