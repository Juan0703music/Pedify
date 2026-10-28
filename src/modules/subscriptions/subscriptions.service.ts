import { prisma, type DbClient } from "../../config/database.js";
import { env } from "../../config/env.js";
import type { PlanCode } from "../../generated/prisma/enums.js";
import { wompi } from "../../services/wompi.service.js";
import type { TenantContext } from "../../types/common.js";
import { clock } from "../../utils/clock.js";
import { conflict } from "../../utils/errors.js";
import { businessesLabel, DEFAULT_TRIAL_PLAN, planOf, PLANS, TRIAL_DAYS, UPGRADE, type Plan } from "./plans.js";
import { addMonths, latest, subscriptionState } from "./subscription-state.js";
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
    const [{ subscription, plan, state }, inReview] = await Promise.all([
      current(businessId),
      prisma.planTransfer.count({ where: { businessId, status: "PENDING" } }),
    ]);
    return {
      plan: subscription.plan,
      planName: plan.name,
      status: state.status,
      endsAt: state.endsAt,
      daysLeft: state.daysLeft,
      graceEndsAt: state.graceEndsAt,
      canReceiveOrders: state.canReceiveOrders,
      /** Ya subió el comprobante de un pago directo y espera la confirmación. */
      paymentInReview: inReview > 0,
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
      // Pago en línea con Wompi (sandbox = llaves de prueba, sin cobros reales).
      onlinePayment: wompi.enabled() ? { provider: "WOMPI", sandbox: wompi.sandbox() } : null,
      support: env.SUPPORT_WHATSAPP
        ? { whatsapp: env.SUPPORT_WHATSAPP, url: `https://wa.me/${env.SUPPORT_WHATSAPP}?text=${encodeURIComponent(message)}` }
        : null,
    };
  },

  /**
   * Registra un pago y extiende la suscripción desde la fecha más tardía entre hoy, el fin de lo ya
   * pagado y el fin de la prueba (no se pierden días). Lo usan el panel central y los pagos en línea.
   */
  async applyPayment(
    tx: DbClient,
    businessId: string,
    input: { plan: PlanCode; months: number; amount: number; method: string; reference: string | null; note: string | null; recordedById: string | null },
  ) {
    // Bloquea la suscripción: dos pagos al mismo tiempo no calculan el periodo desde la misma fecha.
    await tx.$queryRaw`SELECT 1 FROM subscriptions WHERE business_id = ${businessId}::uuid FOR UPDATE`;
    const { subscription } = await current(businessId, tx);
    const periodStart = latest(clock.now(), subscription.paidUntil, subscription.trialEndsAt);
    const periodEnd = addMonths(periodStart, input.months);
    await subscriptionsRepository.update(businessId, { plan: input.plan, paidUntil: periodEnd }, tx);
    return subscriptionsRepository.createPayment({ businessId, ...input, periodStart, periodEnd }, tx);
  },

  /**
   * ¿Puede la persona crear otro negocio? Cuenta los negocios de los que es propietaria y usa el plan
   * más amplio entre ellos (Emprendedor: 1 · Negocio: 3 · Empresa: ilimitados). Si aún no es dueña de
   * ninguno (p. ej. solo es empleada), puede crear el primero. `message` explica por qué no.
   */
  async businessAllowance(userId: string, db: DbClient = prisma) {
    const plans = (await subscriptionsRepository.ownedPlans(userId, db)).map((code) => planOf(code ?? DEFAULT_TRIAL_PLAN));
    const owned = plans.length;
    if (owned === 0) return { allowed: true, owned, max: null, planName: null, message: null };
    const widest = plans.reduce((best, plan) =>
      best.maxBusinesses === null || (plan.maxBusinesses !== null && plan.maxBusinesses <= best.maxBusinesses) ? best : plan,
    );
    const max = widest.maxBusinesses;
    if (max === null || owned < max) return { allowed: true, owned, max, planName: widest.name, message: null };
    const nextCode = UPGRADE[widest.code];
    const next = nextCode ? planOf(nextCode) : null;
    const upgrade = next ? ` Pásate al plan ${next.name} para tener ${businessesLabel(next.maxBusinesses)}.` : "";
    return { allowed: false, owned, max, planName: widest.name, message: `Tu plan ${widest.name} permite ${businessesLabel(max)}.${upgrade}` };
  },

  /** Verifica el límite de negocios antes de crear otro (dentro de la transacción que lo crea). */
  async assertCanCreateBusiness(userId: string, db: DbClient = prisma) {
    const allowance = await subscriptionsService.businessAllowance(userId, db);
    if (!allowance.allowed) throw conflict(allowance.message!, "PLAN_LIMIT");
  },

  /** Un plan más pequeño solo se puede pagar si el menú y el equipo caben en sus límites. */
  async assertPlanFits(businessId: string, plan: Plan) {
    const usage = await subscriptionsRepository.usage(businessId);
    if (plan.maxProducts !== null && usage.products > plan.maxProducts) {
      throw conflict(`Tienes ${usage.products} productos en el menú y el plan ${plan.name} permite ${plan.maxProducts}. Elimina algunos o elige un plan más grande.`, "PLAN_TOO_SMALL");
    }
    if (plan.maxMembers !== null && usage.members > plan.maxMembers) {
      const allowed = `${plan.maxMembers} ${plan.maxMembers === 1 ? "persona" : "personas"}`;
      throw conflict(`Tienes ${usage.members} personas en el equipo y el plan ${plan.name} permite ${allowed}. Quita algunas o elige un plan más grande.`, "PLAN_TOO_SMALL");
    }
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
