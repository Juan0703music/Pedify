import { prisma, type DbClient } from "../../config/database.js";

const categorySelect = { id: true, name: true, position: true, createdAt: true } as const;

export const categoriesRepository = {
  /** Categorías en orden, con la cantidad de productos vigentes de cada una. */
  async list(businessId: string) {
    const rows = await prisma.category.findMany({
      where: { businessId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { ...categorySelect, _count: { select: { products: { where: { archivedAt: null } } } } },
    });
    return rows.map(({ _count, ...category }) => ({ ...category, productCount: _count.products }));
  },

  listNames(businessId: string) {
    return prisma.category.findMany({
      where: { businessId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true },
    });
  },

  /** Busca siempre dentro del negocio (nunca solo por id). */
  findById(id: string, businessId: string, db: DbClient = prisma) {
    return db.category.findFirst({ where: { id, businessId }, select: categorySelect });
  },

  /** Nombre repetido sin distinguir mayúsculas ("Bebidas" = "bebidas"). */
  findByName(businessId: string, name: string, db: DbClient = prisma) {
    return db.category.findFirst({
      where: { businessId, name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
  },

  count(businessId: string, db: DbClient = prisma) {
    return db.category.count({ where: { businessId } });
  },

  async nextPosition(businessId: string, db: DbClient = prisma) {
    const result = await db.category.aggregate({ where: { businessId }, _max: { position: true } });
    return (result._max.position ?? -1) + 1;
  },

  create(data: { businessId: string; name: string; position: number }, db: DbClient = prisma) {
    return db.category.create({ data, select: categorySelect });
  },

  /** Actualiza solo si la categoría pertenece al negocio. */
  async rename(id: string, businessId: string, name: string, db: DbClient = prisma) {
    const { count } = await db.category.updateMany({ where: { id, businessId }, data: { name } });
    return count > 0;
  },

  async delete(id: string, businessId: string, db: DbClient = prisma) {
    const { count } = await db.category.deleteMany({ where: { id, businessId } });
    return count > 0;
  },

  async ids(businessId: string, db: DbClient = prisma) {
    const rows = await db.category.findMany({ where: { businessId }, select: { id: true } });
    return rows.map((row) => row.id);
  },

  async setPositions(businessId: string, ids: string[], db: DbClient = prisma) {
    for (const [position, id] of ids.entries()) {
      await db.category.updateMany({ where: { id, businessId }, data: { position } });
    }
  },
};
