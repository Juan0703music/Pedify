import { prisma } from "../../config/database.js";
import { Prisma } from "../../generated/prisma/client.js";
import { GRACE_DAYS } from "../subscriptions/plans.js";

/**
 * Consultas del panel central de Pedify (sección 16 del documento): negocios registrados,
 * planes, suscripciones y métricas globales. El estado de la suscripción se calcula en SQL con
 * las mismas reglas que `subscriptionState` (pagada → prueba → gracia → vencida).
 */
const subscriptionStatus = (now: Date) => Prisma.sql`
  CASE
    WHEN b.status = 'SUSPENDED' THEN 'SUSPENDED'
    WHEN s.paid_until > ${now} THEN 'ACTIVE'
    WHEN s.trial_ends_at > ${now} THEN 'TRIAL'
    WHEN GREATEST(COALESCE(s.paid_until, s.trial_ends_at), s.trial_ends_at) + ${`${GRACE_DAYS} days`}::interval > ${now} THEN 'PAST_DUE'
    ELSE 'EXPIRED'
  END`;

const ACCEPTED = Prisma.sql`o.status IN ('CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED')`;

/** Fin del periodo vigente (pago o prueba), como `endsAt` de `subscriptionState`. */
const ENDS_AT = Prisma.sql`GREATEST(COALESCE(s.paid_until, s.trial_ends_at), s.trial_ends_at)`;
/** «Por vencer»: en prueba o pagados que terminan en los próximos días. */
const EXPIRING_DAYS = 7;

export interface AdminBusinessRow {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  status: "ACTIVE" | "SUSPENDED";
  createdAt: Date;
  plan: "EMPRENDEDOR" | "NEGOCIO" | "EMPRESA";
  trialEndsAt: Date;
  paidUntil: Date | null;
  subscriptionStatus: string;
  endsAt: Date;
  /** Subió el comprobante de un pago directo que espera revisión. */
  paymentInReview: boolean;
  /** Último recordatorio de vencimiento enviado para el periodo vigente. */
  lastReminder: "DAYS_5" | "DAY_1" | "EXPIRED" | null;
  ownerName: string | null;
  ownerEmail: string | null;
  products: number;
  orders30: number;
  lastOrderAt: Date | null;
}

export const adminRepository = {
  async listBusinesses(options: { now: Date; search?: string; status?: string; skip: number; take: number }) {
    const text = options.search?.trim();
    const like = text ? `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%` : null;
    const status = options.status ?? null;
    const where = Prisma.sql`
      WHERE (${like}::text IS NULL OR name ILIKE ${like} OR slug ILIKE ${like} OR "ownerEmail" ILIKE ${like})
        AND (${status}::text IS NULL OR "subscriptionStatus" = ${status}
          OR (${status}::text = 'EXPIRING' AND "subscriptionStatus" IN ('ACTIVE', 'TRIAL')
              AND "endsAt" <= ${options.now}::timestamptz + ${`${EXPIRING_DAYS} days`}::interval))`;
    const base = Prisma.sql`
      SELECT b.id, b.name, b.slug, b.city, b.status::text AS status, b.created_at AS "createdAt",
             s.plan::text AS plan, s.trial_ends_at AS "trialEndsAt", s.paid_until AS "paidUntil",
             ${subscriptionStatus(options.now)} AS "subscriptionStatus",
             ${ENDS_AT} AS "endsAt",
             EXISTS (SELECT 1 FROM plan_transfers t WHERE t.business_id = b.id AND t.status = 'PENDING') AS "paymentInReview",
             CASE WHEN s.reminder_ends_at = ${ENDS_AT} THEN s.reminder_stage::text END AS "lastReminder",
             owner.name AS "ownerName", owner.email AS "ownerEmail",
             (SELECT COUNT(*)::int FROM products p WHERE p.business_id = b.id AND p.archived_at IS NULL) AS products,
             (SELECT COUNT(*)::int FROM orders o WHERE o.business_id = b.id AND o.created_at > ${options.now}::timestamptz - interval '30 days') AS orders30,
             (SELECT MAX(o.created_at) FROM orders o WHERE o.business_id = b.id) AS "lastOrderAt"
      FROM businesses b
      JOIN subscriptions s ON s.business_id = b.id
      LEFT JOIN LATERAL (
        SELECT u.name, u.email FROM business_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.business_id = b.id AND m.role = 'OWNER' ORDER BY m.created_at LIMIT 1
      ) owner ON true`;
    const [items, count] = await Promise.all([
      // «Por vencer»: primero el que vence antes.
      prisma.$queryRaw<AdminBusinessRow[]>`
        SELECT * FROM (${base}) t ${where}
        ORDER BY CASE WHEN ${status}::text = 'EXPIRING' THEN "endsAt" END ASC, "createdAt" DESC
        LIMIT ${options.take} OFFSET ${options.skip}`,
      prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total FROM (${base}) t ${where}`,
    ]);
    return { items, total: count[0]?.total ?? 0 };
  },

  async businessMetrics(now: Date) {
    const [row] = await prisma.$queryRaw<
      {
        total: number;
        trial: number;
        active: number;
        pastDue: number;
        expired: number;
        suspended: number;
        new7: number;
        new30: number;
        expiring: number;
        activeEmprendedor: number;
        activeNegocio: number;
        activeEmpresa: number;
      }[]
    >`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE st = 'TRIAL')::int AS trial,
             COUNT(*) FILTER (WHERE st = 'ACTIVE')::int AS active,
             COUNT(*) FILTER (WHERE st = 'PAST_DUE')::int AS "pastDue",
             COUNT(*) FILTER (WHERE st = 'EXPIRED')::int AS expired,
             COUNT(*) FILTER (WHERE st = 'SUSPENDED')::int AS suspended,
             COUNT(*) FILTER (WHERE created_at > ${now}::timestamptz - interval '7 days')::int AS new7,
             COUNT(*) FILTER (WHERE created_at > ${now}::timestamptz - interval '30 days')::int AS new30,
             COUNT(*) FILTER (WHERE st IN ('ACTIVE', 'TRIAL') AND ends_at <= ${now}::timestamptz + ${`${EXPIRING_DAYS} days`}::interval)::int AS expiring,
             COUNT(*) FILTER (WHERE st = 'ACTIVE' AND plan = 'EMPRENDEDOR')::int AS "activeEmprendedor",
             COUNT(*) FILTER (WHERE st = 'ACTIVE' AND plan = 'NEGOCIO')::int AS "activeNegocio",
             COUNT(*) FILTER (WHERE st = 'ACTIVE' AND plan = 'EMPRESA')::int AS "activeEmpresa"
      FROM (
        SELECT b.created_at, s.plan::text AS plan, ${subscriptionStatus(now)} AS st, ${ENDS_AT} AS ends_at
        FROM businesses b JOIN subscriptions s ON s.business_id = b.id
      ) t`;
    return row;
  },

  async orderMetrics(now: Date) {
    const [row] = await prisma.$queryRaw<{ orders1: number; orders30: number; gmv30: bigint; storesWithOrders7: number }[]>`
      SELECT COUNT(*) FILTER (WHERE o.created_at > ${now}::timestamptz - interval '1 day')::int AS orders1,
             COUNT(*) FILTER (WHERE o.created_at > ${now}::timestamptz - interval '30 days')::int AS orders30,
             COALESCE(SUM(o.total) FILTER (WHERE o.created_at > ${now}::timestamptz - interval '30 days' AND ${ACCEPTED}), 0)::bigint AS gmv30,
             COUNT(DISTINCT o.business_id) FILTER (WHERE o.created_at > ${now}::timestamptz - interval '7 days')::int AS "storesWithOrders7"
      FROM orders o`;
    return { ...row, gmv30: Number(row?.gmv30 ?? 0) };
  },

  /** Lo que ha recibido Pedify por los planes (pagos en línea y registrados): este mes, 30 días y en total. */
  async revenueMetrics(now: Date) {
    const [row] = await prisma.$queryRaw<{ month: bigint; days30: bigint; total: bigint; payments: number; owners: number }[]>`
      SELECT COALESCE(SUM(p.amount) FILTER (
               WHERE p.created_at >= date_trunc('month', ${now}::timestamptz AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota'
             ), 0)::bigint AS month,
             COALESCE(SUM(p.amount) FILTER (WHERE p.created_at > ${now}::timestamptz - interval '30 days'), 0)::bigint AS days30,
             COALESCE(SUM(p.amount), 0)::bigint AS total,
             COUNT(p.id)::int AS payments,
             (SELECT COUNT(DISTINCT m.user_id)::int FROM business_memberships m WHERE m.role = 'OWNER') AS owners
      FROM subscription_payments p`;
    return { month: Number(row?.month ?? 0), days30: Number(row?.days30 ?? 0), total: Number(row?.total ?? 0), payments: row?.payments ?? 0, owners: row?.owners ?? 0 };
  },

  /**
   * Series de las gráficas del panel central, por calendario de Colombia: ingresos y negocios nuevos
   * de los últimos 12 meses; pedidos y ventas de las tiendas de los últimos 30 días (con los 30
   * anteriores para comparar), por día y por día de la semana × hora; negocios por plan y estado;
   * y las tiendas con más pedidos.
   */
  async analytics(now: Date) {
    const local = Prisma.sql`(${now}::timestamptz AT TIME ZONE 'America/Bogota')`;
    const firstMonth = Prisma.sql`(date_trunc('month', ${local}) - interval '11 months')`;
    const firstDay = Prisma.sql`(date_trunc('day', ${local}) - interval '29 days')`;
    const windowStart = Prisma.sql`(${firstDay} AT TIME ZONE 'America/Bogota')`;
    const [months, days, previous, hours, plans, topStores] = await Promise.all([
      prisma.$queryRaw<{ month: string; revenue: bigint; payments: number; newBusinesses: number }[]>`
        WITH m AS (SELECT generate_series(${firstMonth}, date_trunc('month', ${local}), interval '1 month') AS start)
        SELECT to_char(m.start, 'YYYY-MM') AS month, COALESCE(p.revenue, 0)::bigint AS revenue,
               COALESCE(p.payments, 0)::int AS payments, COALESCE(b.count, 0)::int AS "newBusinesses"
        FROM m
        LEFT JOIN (
          SELECT date_trunc('month', created_at AT TIME ZONE 'America/Bogota') AS start, SUM(amount) AS revenue, COUNT(*) AS payments
          FROM subscription_payments WHERE created_at >= ${firstMonth} AT TIME ZONE 'America/Bogota' GROUP BY 1
        ) p ON p.start = m.start
        LEFT JOIN (
          SELECT date_trunc('month', created_at AT TIME ZONE 'America/Bogota') AS start, COUNT(*) AS count
          FROM businesses WHERE created_at >= ${firstMonth} AT TIME ZONE 'America/Bogota' GROUP BY 1
        ) b ON b.start = m.start
        ORDER BY m.start`,
      prisma.$queryRaw<{ day: string; orders: number; gmv: bigint }[]>`
        WITH d AS (SELECT generate_series(${firstDay}, date_trunc('day', ${local}), interval '1 day') AS start)
        SELECT to_char(d.start, 'YYYY-MM-DD') AS day, COALESCE(o.orders, 0)::int AS orders, COALESCE(o.gmv, 0)::bigint AS gmv
        FROM d
        LEFT JOIN (
          SELECT date_trunc('day', o.created_at AT TIME ZONE 'America/Bogota') AS start, COUNT(*) AS orders,
                 SUM(o.total) FILTER (WHERE ${ACCEPTED}) AS gmv
          FROM orders o WHERE o.created_at >= ${windowStart} GROUP BY 1
        ) o ON o.start = d.start
        ORDER BY d.start`,
      prisma.$queryRaw<{ orders: number; gmv: bigint }[]>`
        SELECT COUNT(*)::int AS orders, COALESCE(SUM(o.total) FILTER (WHERE ${ACCEPTED}), 0)::bigint AS gmv
        FROM orders o WHERE o.created_at >= ${windowStart} - interval '30 days' AND o.created_at < ${windowStart}`,
      prisma.$queryRaw<{ weekday: number; hour: number; orders: number }[]>`
        SELECT (EXTRACT(ISODOW FROM o.created_at AT TIME ZONE 'America/Bogota') - 1)::int AS weekday,
               EXTRACT(HOUR FROM o.created_at AT TIME ZONE 'America/Bogota')::int AS hour, COUNT(*)::int AS orders
        FROM orders o WHERE o.created_at >= ${windowStart} GROUP BY 1, 2`,
      prisma.$queryRaw<{ plan: string; status: string; count: number }[]>`
        SELECT plan, status, COUNT(*)::int AS count
        FROM (SELECT s.plan::text AS plan, ${subscriptionStatus(now)} AS status FROM businesses b JOIN subscriptions s ON s.business_id = b.id) t
        GROUP BY 1, 2`,
      prisma.$queryRaw<{ id: string; name: string; slug: string; orders: number; gmv: bigint }[]>`
        SELECT b.id, b.name, b.slug, COUNT(*)::int AS orders, COALESCE(SUM(o.total) FILTER (WHERE ${ACCEPTED}), 0)::bigint AS gmv
        FROM orders o JOIN businesses b ON b.id = o.business_id
        WHERE o.created_at >= ${windowStart}
        GROUP BY b.id, b.name, b.slug ORDER BY orders DESC, gmv DESC, b.name LIMIT 6`,
    ]);
    return {
      months: months.map((row) => ({ ...row, revenue: Number(row.revenue) })),
      days: days.map((row) => ({ ...row, gmv: Number(row.gmv) })),
      previous: { orders: previous[0]?.orders ?? 0, gmv: Number(previous[0]?.gmv ?? 0) },
      hours,
      plans,
      topStores: topStores.map((row) => ({ ...row, gmv: Number(row.gmv) })),
    };
  },

  /** Pagos de los planes de todos los negocios, del más reciente al más antiguo. */
  async listPayments(options: { skip: number; take: number }) {
    const [items, total] = await Promise.all([
      prisma.subscriptionPayment.findMany({
        orderBy: { createdAt: "desc" },
        skip: options.skip,
        take: options.take,
        select: {
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
          business: { select: { id: true, name: true, slug: true } },
          recordedBy: { select: { name: true } },
        },
      }),
      prisma.subscriptionPayment.count(),
    ]);
    return { items, total };
  },

  findBusiness(id: string) {
    return prisma.business.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        phone: true,
        city: true,
        status: true,
        createdAt: true,
        memberships: { orderBy: { createdAt: "asc" }, select: { role: true, user: { select: { name: true, email: true } } } },
        _count: { select: { products: { where: { archivedAt: null } }, orders: true, customers: true } },
      },
    });
  },
};
