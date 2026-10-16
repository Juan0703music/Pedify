import { clock } from "../../utils/clock.js";
import { roundCOP } from "../../utils/currency.js";
import { addDays, dateIn, daysBetween, startOfDay } from "../../utils/dates.js";
import { notFound } from "../../utils/errors.js";
import type { TenantContext } from "../../types/common.js";
import { businessesRepository } from "../businesses/businesses.repository.js";
import { analyticsRepository, type Period } from "./analytics.repository.js";
import type { RangeQuery } from "./analytics.schemas.js";

/**
 * Indicadores de la sección 11 del documento:
 * - Ventas: suma de los pedidos que cumplen la política de ventas del negocio
 *   (aceptados, entregados o pagados). Un pedido cancelado nunca cuenta.
 * - Pedidos: cantidad de pedidos registrados en el periodo.
 * - Producto más vendido: el de más unidades vendidas.
 * - Ticket promedio: ventas ÷ cantidad de pedidos incluidos en las ventas (redondeo al peso).
 * Los días se cuentan en la zona horaria del negocio (Colombia).
 */
async function context(tenant: TenantContext) {
  const settings = await businessesRepository.findSettings(tenant.businessId);
  if (!settings) throw notFound("El negocio no tiene configuración.");
  return { timeZone: settings.timezone, policy: settings.salesPolicy };
}

const average = (sales: number, orders: number) => (orders > 0 ? roundCOP(sales / orders) : 0);

export const analyticsService = {
  async summary(tenant: TenantContext, query: RangeQuery) {
    const { timeZone, policy } = await context(tenant);
    const today = dateIn(clock.now(), timeZone);
    const from = query.from ?? query.to ?? today;
    const to = query.to ?? from;

    const period: Period = {
      businessId: tenant.businessId,
      start: startOfDay(from, timeZone),
      end: startOfDay(addDays(to, 1), timeZone),
      policy,
    };
    // Periodo anterior de la misma duración, para comparar.
    const length = daysBetween(from, to) + 1;
    const previousFrom = addDays(from, -length);
    const previous: Period = { ...period, start: startOfDay(previousFrom, timeZone), end: period.start };

    const [totals, before, byDay, byHour, topProducts] = await Promise.all([
      analyticsRepository.totals(period),
      analyticsRepository.totals(previous),
      analyticsRepository.byDay(period, from, to, timeZone),
      analyticsRepository.byHour(period, timeZone),
      analyticsRepository.topProducts(period, 10),
    ]);

    return {
      range: { from, to, days: length, timeZone },
      salesPolicy: policy,
      sales: totals.sales,
      salesOrders: totals.salesOrders,
      averageTicket: average(totals.sales, totals.salesOrders),
      orders: {
        created: totals.created,
        pending: totals.pending,
        accepted: totals.accepted,
        delivered: totals.delivered,
        cancelled: totals.cancelled,
        paid: totals.paid,
      },
      delivery: { delivery: totals.deliveryOrders, pickup: totals.pickupOrders },
      topProduct: topProducts[0] ?? null,
      topProducts,
      byDay,
      byHour,
      previous: {
        from: previousFrom,
        to: addDays(from, -1),
        sales: before.sales,
        salesOrders: before.salesOrders,
        created: before.created,
        averageTicket: average(before.sales, before.salesOrders),
      },
    };
  },

  /** Resumen del día para el Inicio del panel (visible para todo el equipo). */
  async today(tenant: TenantContext) {
    const { timeZone, policy } = await context(tenant);
    const today = dateIn(clock.now(), timeZone);
    const period: Period = {
      businessId: tenant.businessId,
      start: startOfDay(today, timeZone),
      end: startOfDay(addDays(today, 1), timeZone),
      policy,
    };
    const [totals, topProducts] = await Promise.all([analyticsRepository.totals(period), analyticsRepository.topProducts(period, 3)]);
    return {
      date: today,
      salesPolicy: policy,
      sales: totals.sales,
      salesOrders: totals.salesOrders,
      averageTicket: average(totals.sales, totals.salesOrders),
      created: totals.created,
      pending: totals.pending,
      cancelled: totals.cancelled,
      topProducts,
    };
  },
};
