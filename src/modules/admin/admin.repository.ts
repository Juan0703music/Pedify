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
    const where = Prisma.sql`
      WHERE (${like}::text IS NULL OR name ILIKE ${like} OR slug ILIKE ${like} OR "ownerEmail" ILIKE ${like})
        AND (${options.status ?? null}::text IS NULL OR "subscriptionStatus" = ${options.status ?? null})`;
    const base = Prisma.sql`
      SELECT b.id, b.name, b.slug, b.city, b.status::text AS status, b.created_at AS "createdAt",
             s.plan::text AS plan, s.trial_ends_at AS "trialEndsAt", s.paid_until AS "paidUntil",
             ${subscriptionStatus(options.now)} AS "subscriptionStatus",
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
      prisma.$queryRaw<AdminBusinessRow[]>`SELECT * FROM (${base}) t ${where} ORDER BY "createdAt" DESC LIMIT ${options.take} OFFSET ${options.skip}`,
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
             COUNT(*) FILTER (WHERE st = 'ACTIVE' AND plan = 'EMPRENDEDOR')::int AS "activeEmprendedor",
             COUNT(*) FILTER (WHERE st = 'ACTIVE' AND plan = 'NEGOCIO')::int AS "activeNegocio",
             COUNT(*) FILTER (WHERE st = 'ACTIVE' AND plan = 'EMPRESA')::int AS "activeEmpresa"
      FROM (
        SELECT b.created_at, s.plan::text AS plan, ${subscriptionStatus(now)} AS st
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
