import { prisma } from "../../config/database.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { TenantContext } from "../../types/common.js";
import { badRequest, conflict, notFound } from "../../utils/errors.js";
import { categoriesRepository } from "./categories.repository.js";
import { productsRepository } from "./products.repository.js";

export const MAX_CATEGORIES = 50;

const categoryNotFound = () => notFound("No encontramos esa categoría. Puede que la hayan eliminado.", "CATEGORY_NOT_FOUND");
const nameTaken = (name: string) => conflict(`Ya tienes una categoría llamada «${name}».`, "CATEGORY_EXISTS");

const isUniqueError = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const sameIds = (a: string[], b: string[]) => a.length === b.length && new Set([...a, ...b]).size === a.length;

export const categoriesService = {
  list(tenant: TenantContext) {
    return categoriesRepository.list(tenant.businessId);
  },

  async create(tenant: TenantContext, name: string) {
    try {
      const category = await prisma.$transaction(async (tx) => {
        if ((await categoriesRepository.count(tenant.businessId, tx)) >= MAX_CATEGORIES) {
          throw conflict(`Puedes tener hasta ${MAX_CATEGORIES} categorías.`, "CATEGORY_LIMIT");
        }
        if (await categoriesRepository.findByName(tenant.businessId, name, tx)) throw nameTaken(name);
        const position = await categoriesRepository.nextPosition(tenant.businessId, tx);
        return categoriesRepository.create({ businessId: tenant.businessId, name, position }, tx);
      });
      return { ...category, productCount: 0 };
    } catch (error) {
      if (isUniqueError(error)) throw nameTaken(name);
      throw error;
    }
  },

  async rename(tenant: TenantContext, id: string, name: string) {
    const existing = await categoriesRepository.findByName(tenant.businessId, name);
    if (existing && existing.id !== id) throw nameTaken(name);
    try {
      if (!(await categoriesRepository.rename(id, tenant.businessId, name))) throw categoryNotFound();
    } catch (error) {
      if (isUniqueError(error)) throw nameTaken(name);
      throw error;
    }
    const category = await categoriesRepository.findById(id, tenant.businessId);
    if (!category) throw categoryNotFound();
    return category;
  },

  /** Elimina la categoría; sus productos pasan, en el mismo orden, al final de "Sin categoría". */
  async remove(tenant: TenantContext, id: string) {
    return prisma.$transaction(async (tx) => {
      const category = await categoriesRepository.findById(id, tenant.businessId, tx);
      if (!category) throw categoryNotFound();

      const productIds = await productsRepository.currentIdsInCategory(tenant.businessId, id, tx);
      let position = await productsRepository.nextPosition(tenant.businessId, null, tx);
      for (const productId of productIds) {
        await productsRepository.update(productId, tenant.businessId, { categoryId: null, position: position++ }, tx);
      }
      await categoriesRepository.delete(id, tenant.businessId, tx);
      return { movedProducts: productIds.length };
    });
  },

  /**
   * Elige los productos de una categoría (casillas en "Mi menú"). Los marcados quedan en ella: los que
   * ya estaban conservan su orden y los nuevos llegan al final. Los desmarcados pasan a "Sin categoría".
   */
  async setProducts(tenant: TenantContext, id: string, productIds: string[]) {
    return prisma.$transaction(async (tx) => {
      const category = await categoriesRepository.findById(id, tenant.businessId, tx);
      if (!category) throw categoryNotFound();

      const found = await productsRepository.findCurrentByIds(tenant.businessId, productIds, tx);
      if (found.length !== productIds.length) {
        throw badRequest("Algunos productos ya no están en tu menú. Recarga la página e intenta de nuevo.", "PRODUCT_NOT_FOUND");
      }

      const wanted = new Set(productIds);
      const current = await productsRepository.currentIdsInCategory(tenant.businessId, id, tx);
      const kept = current.filter((productId) => wanted.has(productId));
      const added = productIds.filter((productId) => !current.includes(productId));
      const removed = current.filter((productId) => !wanted.has(productId));

      for (const [position, productId] of [...kept, ...added].entries()) {
        await productsRepository.update(productId, tenant.businessId, { categoryId: id, position }, tx);
      }
      let position = await productsRepository.nextPosition(tenant.businessId, null, tx);
      for (const productId of removed) {
        await productsRepository.update(productId, tenant.businessId, { categoryId: null, position: position++ }, tx);
      }
      return { added: added.length, removed: removed.length, productCount: productIds.length };
    });
  },

  async reorder(tenant: TenantContext, categoryIds: string[]) {
    await prisma.$transaction(async (tx) => {
      const current = await categoriesRepository.ids(tenant.businessId, tx);
      if (!sameIds(current, categoryIds)) {
        throw conflict("Tus categorías cambiaron mientras las ordenabas. Recarga la página e intenta de nuevo.", "ORDER_OUTDATED");
      }
      await categoriesRepository.setPositions(tenant.businessId, categoryIds, tx);
    });
  },
};
