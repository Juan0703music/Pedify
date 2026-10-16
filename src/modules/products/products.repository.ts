import { prisma, type DbClient } from "../../config/database.js";
import type { Prisma } from "../../generated/prisma/client.js";

/** Campos que devuelve la API (la clave interna de la imagen no sale del servidor). */
export const productSelect = {
  id: true,
  categoryId: true,
  name: true,
  description: true,
  price: true,
  imageUrl: true,
  isActive: true,
  isAvailable: true,
  position: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const productWithKeySelect = { ...productSelect, imageKey: true } as const;

/** Las consultas por id siempre van acompañadas del negocio (clave única compuesta id + business_id). */
const byTenant = (id: string, businessId: string) => ({ id_businessId: { id, businessId } });

export const productsRepository = {
  list(businessId: string, archived: boolean) {
    return prisma.product.findMany({
      where: { businessId, archivedAt: archived ? { not: null } : null },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: productSelect,
    });
  },

  findById(id: string, businessId: string, db: DbClient = prisma) {
    return db.product.findUnique({ where: byTenant(id, businessId), select: productWithKeySelect });
  },

  countCurrent(businessId: string, db: DbClient = prisma) {
    return db.product.count({ where: { businessId, archivedAt: null } });
  },

  async summary(businessId: string) {
    const where = { businessId, archivedAt: null };
    const [total, visible, soldOut, withImage] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.count({ where: { ...where, isActive: true } }),
      prisma.product.count({ where: { ...where, isActive: true, isAvailable: false } }),
      prisma.product.count({ where: { ...where, imageUrl: { not: null } } }),
    ]);
    return { total, visible, soldOut, withImage };
  },

  /** Siguiente posición al final de una categoría (null = sin categoría). */
  async nextPosition(businessId: string, categoryId: string | null, db: DbClient = prisma) {
    const result = await db.product.aggregate({
      where: { businessId, categoryId, archivedAt: null },
      _max: { position: true },
    });
    return (result._max.position ?? -1) + 1;
  },

  create(data: Prisma.ProductUncheckedCreateInput, db: DbClient = prisma) {
    return db.product.create({ data, select: productSelect });
  },

  update(id: string, businessId: string, data: Prisma.ProductUncheckedUpdateInput, db: DbClient = prisma) {
    return db.product.update({ where: byTenant(id, businessId), data, select: productSelect });
  },

  delete(id: string, businessId: string, db: DbClient = prisma) {
    return db.product.delete({ where: byTenant(id, businessId), select: { id: true } });
  },

  async appearsInOrders(id: string, businessId: string, db: DbClient = prisma) {
    return (await db.orderItem.count({ where: { productId: id, businessId } })) > 0;
  },

  /** Ids vigentes (no archivados) de una categoría, en su orden actual. */
  async currentIdsInCategory(businessId: string, categoryId: string | null, db: DbClient = prisma) {
    const rows = await db.product.findMany({
      where: { businessId, categoryId, archivedAt: null },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    return rows.map((row) => row.id);
  },

  async setPositions(businessId: string, ids: string[], db: DbClient = prisma) {
    for (const [position, id] of ids.entries()) {
      await db.product.update({ where: byTenant(id, businessId), data: { position } });
    }
  },

  /** Catálogo público: productos visibles y no archivados (incluye agotados para mostrarlos como tales). */
  listForStore(businessId: string) {
    return prisma.product.findMany({
      where: { businessId, isActive: true, archivedAt: null },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, categoryId: true, name: true, description: true, price: true, imageUrl: true, isAvailable: true },
    });
  },
};
