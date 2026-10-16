import { prisma, type DbClient } from "../../config/database.js";
import { Prisma } from "../../generated/prisma/client.js";

/** Pedidos que cuentan como compra del cliente: aceptados por el negocio (sin pendientes ni cancelados). */
const ACCEPTED = Prisma.sql`o.status IN ('CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED')`;

export interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  createdAt: Date;
  orders: number;
  spent: number;
  lastOrderAt: Date | null;
}

function searchFilter(search: string | undefined) {
  const text = search?.trim();
  if (!text) return Prisma.empty;
  const digits = text.replace(/\D/g, "");
  const like = `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  return digits.length >= 3
    ? Prisma.sql`AND (c.name ILIKE ${like} OR c.phone LIKE ${`%${digits}%`})`
    : Prisma.sql`AND c.name ILIKE ${like}`;
}

export const customersRepository = {
  /** Clientes con su cantidad de pedidos, total comprado y último pedido (del más reciente al más antiguo). */
  async list(businessId: string, options: { search?: string; skip: number; take: number }) {
    const filter = searchFilter(options.search);
    const rows = await prisma.$queryRaw<CustomerRow[]>`
      SELECT c.id, c.name, c.phone, c.created_at AS "createdAt",
             COUNT(o.id) FILTER (WHERE o.status <> 'CANCELLED')::int AS orders,
             COALESCE(SUM(o.total) FILTER (WHERE ${ACCEPTED}), 0)::int AS spent,
             MAX(o.created_at) AS "lastOrderAt"
      FROM customers c
      LEFT JOIN orders o ON o.customer_id = c.id AND o.business_id = c.business_id
      WHERE c.business_id = ${businessId}::uuid AND c.phone NOT LIKE 'eliminado-%' ${filter}
      GROUP BY c.id
      ORDER BY MAX(o.created_at) DESC NULLS LAST, c.created_at DESC
      LIMIT ${options.take} OFFSET ${options.skip}`;
    const [count] = await prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM customers c WHERE c.business_id = ${businessId}::uuid AND c.phone NOT LIKE 'eliminado-%' ${filter}`;
    return { items: rows, total: count?.total ?? 0 };
  },

  /**
   * Supresión de datos personales (Ley 1581 de 2012): se anonimiza al cliente y la copia de sus datos
   * en los pedidos; los pedidos se conservan (valores y productos) para la contabilidad del negocio.
   */
  async erase(id: string, businessId: string) {
    return prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id_businessId: { id, businessId } }, select: { id: true } });
      if (!customer) return false;
      await tx.order.updateMany({
        where: { customerId: id, businessId },
        data: { customerName: "Cliente eliminado", customerPhone: "eliminado", addressReferences: null, notes: null },
      });
      // Un domicilio debe conservar una dirección (restricción de la base): se reemplaza el texto.
      await tx.order.updateMany({ where: { customerId: id, businessId, deliveryType: "DELIVERY" }, data: { deliveryAddress: "Dirección eliminada" } });
      await tx.customerAddress.deleteMany({ where: { customerId: id } });
      await tx.customer.update({ where: { id }, data: { name: "Cliente eliminado", phone: `eliminado-${id}` } });
      return true;
    });
  },

  findDetail(id: string, businessId: string) {
    return prisma.customer.findUnique({
      where: { id_businessId: { id, businessId } },
      select: {
        id: true,
        name: true,
        phone: true,
        createdAt: true,
        addresses: { orderBy: { createdAt: "desc" }, select: { id: true, address: true, references: true, createdAt: true } },
        orders: {
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, number: true, status: true, deliveryType: true, total: true, paidAt: true, createdAt: true },
        },
      },
    });
  },

  /** Un cliente por teléfono dentro de cada negocio; el nombre se actualiza con el del último pedido. */
  upsertByPhone(data: { businessId: string; phone: string; name: string }, db: DbClient = prisma) {
    return db.customer.upsert({
      where: { businessId_phone: { businessId: data.businessId, phone: data.phone } },
      create: data,
      update: { name: data.name },
      select: { id: true },
    });
  },

  /** Dirección ya usada por el cliente (sin distinguir mayúsculas). */
  findAddress(customerId: string, address: string, db: DbClient = prisma) {
    return db.customerAddress.findFirst({
      where: { customerId, address: { equals: address, mode: "insensitive" } },
      select: { id: true, references: true },
    });
  },

  createAddress(data: { customerId: string; address: string; references: string | null }, db: DbClient = prisma) {
    return db.customerAddress.create({ data, select: { id: true } });
  },

  updateAddressReferences(id: string, references: string, db: DbClient = prisma) {
    return db.customerAddress.update({ where: { id }, data: { references }, select: { id: true } });
  },
};
