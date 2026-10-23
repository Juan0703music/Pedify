import { readFileSync } from "node:fs";
import { prisma } from "../../config/database.js";
import { environmentName, isProduction } from "../../config/env.js";
import { productionWarnings } from "../../config/readiness.js";
import { notifications } from "../../services/notification.service.js";
import { clock } from "../../utils/clock.js";
import { notFound } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { buildPage } from "../../utils/pagination.js";
import { storeUrl } from "../businesses/businesses.controller.js";
import { planOf, PLANS, priceFor } from "../subscriptions/plans.js";
import { latest, subscriptionState } from "../subscriptions/subscription-state.js";
import { subscriptionsRepository } from "../subscriptions/subscriptions.repository.js";
import { subscriptionsService } from "../subscriptions/subscriptions.service.js";
import { adminRepository } from "./admin.repository.js";
import type { ListBusinessesQuery, RecordPaymentInput, UpdateBusinessAdminInput } from "./admin.schemas.js";

const DAY = 86_400_000;
const version = (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string }).version;

export const adminService = {
  /** Métricas globales de la plataforma y estado del sistema. */
  async metrics() {
    const now = clock.now();
    const started = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Math.round(performance.now() - started);
    const [businesses, orders] = await Promise.all([adminRepository.businessMetrics(now), adminRepository.orderMetrics(now)]);
    const mrr =
      (businesses?.activeEmprendedor ?? 0) * PLANS.EMPRENDEDOR.priceMonthly +
      (businesses?.activeNegocio ?? 0) * PLANS.NEGOCIO.priceMonthly +
      (businesses?.activeEmpresa ?? 0) * PLANS.EMPRESA.priceMonthly;
    return {
      businesses,
      orders,
      /** Ingreso mensual recurrente estimado con los precios de lista de las suscripciones activas. */
      mrr,
      plans: Object.values(PLANS),
      system: {
        version,
        nodeVersion: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1_048_576),
        dbLatencyMs,
        environment: environmentName,
        /** Configuración pendiente para operar en producción (vacía en desarrollo). */
        warnings: isProduction ? productionWarnings() : [],
      },
    };
  },

  async listBusinesses(query: ListBusinessesQuery) {
    const { items, total } = await adminRepository.listBusinesses({
      now: clock.now(),
      search: query.search,
      status: query.status,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return buildPage(items, total, query);
  },

  async getBusiness(id: string) {
    const business = await adminRepository.findBusiness(id);
    if (!business) throw notFound("No encontramos ese negocio.");
    const [{ subscription, plan, state }, payments] = await Promise.all([
      subscriptionsService.current(id),
      subscriptionsRepository.listPayments(id),
    ]);
    return {
      ...business,
      storeUrl: storeUrl(business.slug),
      subscription: { ...subscription, planName: plan.name, priceMonthly: plan.priceMonthly, priceYearly: plan.priceYearly, ...state },
      payments,
    };
  },

  /** Suspender o reactivar, cambiar de plan o ampliar la prueba. */
  async updateBusiness(adminId: string, id: string, input: UpdateBusinessAdminInput) {
    const { subscription } = await subscriptionsService.current(id);
    await prisma.$transaction(async (tx) => {
      if (input.status) await tx.business.update({ where: { id }, data: { status: input.status } });
      const changes: { plan?: typeof subscription.plan; trialEndsAt?: Date } = {};
      if (input.plan) changes.plan = input.plan;
      if (input.extendTrialDays) changes.trialEndsAt = new Date(latest(clock.now(), subscription.trialEndsAt).getTime() + input.extendTrialDays * DAY);
      if (Object.keys(changes).length > 0) await subscriptionsRepository.update(id, changes, tx);
    });
    notifications.businessChanged({ businessId: id, scope: "subscription", clientId: null });
    logger.info({ adminId, businessId: id, changes: input }, "Cambio administrativo en un negocio");
    return adminService.getBusiness(id);
  },

  /** Registra un pago recibido (Nequi, transferencia…) y extiende la suscripción sin perder días. */
  async recordPayment(adminId: string, id: string, input: RecordPaymentInput) {
    const { subscription } = await subscriptionsService.current(id);
    const plan = planOf(input.plan ?? subscription.plan);
    await prisma.$transaction((tx) =>
      subscriptionsService.applyPayment(tx, id, {
        plan: plan.code,
        amount: input.amount ?? priceFor(plan, input.months),
        months: input.months,
        method: input.method,
        reference: input.reference || null,
        note: input.note || null,
        recordedById: adminId,
      }),
    );
    notifications.businessChanged({ businessId: id, scope: "subscription", clientId: null });
    logger.info({ adminId, businessId: id, plan: plan.code, months: input.months }, "Pago de suscripción registrado");
    const updated = await adminService.getBusiness(id);
    return { ...updated, subscription: { ...updated.subscription, ...subscriptionState(updated.subscription, clock.now()) } };
  },
};
