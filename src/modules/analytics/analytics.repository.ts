import { prisma } from "../../config/database.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { SalesPolicy } from "../../generated/prisma/enums.js";

/**
 * Consultas de analíticas directamente en PostgreSQL (sección 11 del documento).
 * Los periodos llegan como instantes [inicio, fin) ya calculados en la zona horaria del negocio,
 * y las agrupaciones por día u hora usan `AT TIME ZONE` con esa misma zona.
 */

const ACCEPTED = Prisma.sql`o.status IN ('CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED')`;

/** Qué pedidos cuentan como venta según la política del negocio. Los cancelados nunca cuentan. */
function salesFilter(policy: SalesPolicy) {
  if (policy === "DELIVERED") return Prisma.sql`o.status = 'DELIVERED'`;
  if (policy === "PAID") return Prisma.sql`(o.paid_at IS NOT NULL AND o.status <> 'CANCELLED')`;
  return ACCEPTED;
}

export interface Period {
  businessId: string;
  start: Date;
  end: Date;
  policy: SalesPolicy;
}

const inPeriod = (p: Period) => Prisma.sql`o.business_id = ${p.businessId}::uuid AND o.created_at >= ${p.start} AND o.created_at < ${p.end}`;

const toNumber = (value: bigint | number | null) => Number(value ?? 0);

export const analyticsRepository = {
  async totals(p: Period) {
    const sales = salesFilter(p.policy);
    const [row] = await prisma.$queryRaw<
      {
        created: number;
        pending: number;
        accepted: number;
        delivered: number;
        cancelled: number;
        paid: number;
        salesOrders: number;
        sales: bigint;
        deliveryOrders: number;
        pickupOrders: number;
      }[]
    >`
      SELECT COUNT(*)::int AS created,
             COUNT(*) FILTER (WHERE o.status = 'PENDING')::int AS pending,
             COUNT(*) FILTER (WHERE ${ACCEPTED})::int AS accepted,
             COUNT(*) FILTER (WHERE o.status = 'DELIVERED')::int AS delivered,
             COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::int AS cancelled,
             COUNT(*) FILTER (WHERE o.paid_at IS NOT NULL AND o.status <> 'CANCELLED')::int AS paid,
             COUNT(*) FILTER (WHERE ${sales})::int AS "salesOrders",
             COALESCE(SUM(o.total) FILTER (WHERE ${sales}), 0)::bigint AS sales,
             COUNT(*) FILTER (WHERE ${sales} AND o.delivery_type = 'DELIVERY')::int AS "deliveryOrders",
             COUNT(*) FILTER (WHERE ${sales} AND o.delivery_type = 'PICKUP')::int AS "pickupOrders"
      FROM orders o
      WHERE ${inPeriod(p)}`;
    return {
      created: row?.created ?? 0,
      pending: row?.pending ?? 0,
      accepted: row?.accepted ?? 0,
      delivered: row?.delivered ?? 0,
      cancelled: row?.cancelled ?? 0,
      paid: row?.paid ?? 0,
      salesOrders: row?.salesOrders ?? 0,
      sales: toNumber(row?.sales ?? 0),
      deliveryOrders: row?.deliveryOrders ?? 0,
      pickupOrders: row?.pickupOrders ?? 0,
    };
  },

  /** Ventas y pedidos por día del periodo (incluye los días sin ventas). */
  async byDay(p: Period, from: string, to: string, timeZone: string) {
    const rows = await prisma.$queryRaw<{ date: string; sales: bigint; orders: number }[]>`
      SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
             COALESCE(SUM(o.total) FILTER (WHERE ${salesFilter(p.policy)}), 0)::bigint AS sales,
             COUNT(o.id) FILTER (WHERE ${salesFilter(p.policy)})::int AS orders
      FROM generate_series(${from}::date, ${to}::date, interval '1 day') AS d(day)
      LEFT JOIN orders o ON ${inPeriod(p)} AND (o.created_at AT TIME ZONE ${timeZone})::date = d.day::date
      GROUP BY d.day
      ORDER BY d.day`;
    return rows.map((row) => ({ date: row.date, sales: toNumber(row.sales), orders: row.orders }));
  },

  /** Pedidos que cuentan como venta por hora del día (horas pico). */
  async byHour(p: Period, timeZone: string) {
    const rows = await prisma.$queryRaw<{ hour: number; orders: number }[]>`
      SELECT EXTRACT(HOUR FROM o.created_at AT TIME ZONE ${timeZone})::int AS hour, COUNT(*)::int AS orders
      FROM orders o
      WHERE ${inPeriod(p)} AND ${salesFilter(p.policy)}
      GROUP BY 1
      ORDER BY 1`;
    const byHour = new Map(rows.map((row) => [row.hour, row.orders]));
    return Array.from({ length: 24 }, (_, hour) => ({ hour, orders: byHour.get(hour) ?? 0 }));
  },

  /** Productos más vendidos por unidades (con el nombre actual del producto si aún existe). */
  async topProducts(p: Period, limit: number) {
    const rows = await prisma.$queryRaw<{ productId: string; name: string; quantity: number; revenue: bigint }[]>`
      SELECT oi.product_id AS "productId",
             COALESCE(MAX(pr.name), MAX(oi.product_name)) AS name,
             SUM(oi.quantity)::int AS quantity,
             SUM(oi.subtotal)::bigint AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id AND o.business_id = oi.business_id
      LEFT JOIN products pr ON pr.id = oi.product_id
      WHERE ${inPeriod(p)} AND ${salesFilter(p.policy)}
      GROUP BY oi.product_id
      ORDER BY quantity DESC, revenue DESC
      LIMIT ${limit}`;
    return rows.map((row) => ({ ...row, revenue: toNumber(row.revenue) }));
  },
};
