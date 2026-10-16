import { prisma, type DbClient } from "../../config/database.js";
import { Prisma } from "../../generated/prisma/client.js";
import { deleteImage, saveImage } from "../../services/storage.service.js";
import type { TenantContext } from "../../types/common.js";
import { badRequest, conflict, forbidden, notFound } from "../../utils/errors.js";
import { subscriptionsService } from "../subscriptions/subscriptions.service.js";
import { categoriesRepository } from "./categories.repository.js";
import { productsRepository } from "./products.repository.js";
import type { CreateProductInput, ReorderProductsInput, UpdateProductInput } from "./products.schemas.js";

/** Límite de productos vigentes por negocio (protege la tienda y la base de datos). */
export const MAX_PRODUCTS = 500;

const productNotFound = () => notFound("No encontramos ese producto. Puede que lo hayan eliminado.", "PRODUCT_NOT_FOUND");

const isForeignKeyError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";

/** Verifica que la categoría pertenezca al negocio; null = sin categoría. */
async function resolveCategory(businessId: string, categoryId: string | null | undefined, db: DbClient) {
  if (!categoryId) return null;
  const category = await categoriesRepository.findById(categoryId, businessId, db);
  if (!category) {
    throw badRequest("Esa categoría no existe. Recarga la página.", "CATEGORY_NOT_FOUND", {
      fields: { categoryId: "Elige una categoría de la lista." },
    });
  }
  return category.id;
}

/** Quita la clave interna de la imagen antes de responder. */
function toPublic<T extends { imageKey?: string | null }>(product: T): Omit<T, "imageKey"> {
  const { imageKey: _imageKey, ...rest } = product;
  return rest;
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && new Set([...a, ...b]).size === a.length;

export const productsService = {
  list(tenant: TenantContext, status: "current" | "archived") {
    return productsRepository.list(tenant.businessId, status === "archived");
  },

  summary(tenant: TenantContext) {
    return productsRepository.summary(tenant.businessId);
  },

  async get(tenant: TenantContext, id: string) {
    const product = await productsRepository.findById(id, tenant.businessId);
    if (!product) throw productNotFound();
    return toPublic(product);
  },

  /** Crea el producto al final de su categoría. */
  async create(tenant: TenantContext, input: CreateProductInput) {
    return prisma.$transaction(async (tx) => {
      await subscriptionsService.assertLimit(tenant.businessId, "products", tx);
      if ((await productsRepository.countCurrent(tenant.businessId, tx)) >= MAX_PRODUCTS) {
        throw conflict(`Llegaste al límite de ${MAX_PRODUCTS} productos. Elimina o archiva los que ya no vendes.`, "PRODUCT_LIMIT");
      }
      const categoryId = await resolveCategory(tenant.businessId, input.categoryId, tx);
      const position = await productsRepository.nextPosition(tenant.businessId, categoryId, tx);
      return productsRepository.create(
        {
          businessId: tenant.businessId,
          categoryId,
          position,
          name: input.name,
          description: input.description ?? null,
          price: input.price,
          isActive: input.isActive,
          isAvailable: input.isAvailable,
        },
        tx,
      );
    });
  },

  /**
   * El propietario edita todo. Un empleado solo puede marcar el producto como agotado o disponible
   * (es parte de la operación diaria del mostrador).
   */
  async update(tenant: TenantContext, id: string, input: UpdateProductInput) {
    const changes = Object.entries(input).filter(([, value]) => value !== undefined);
    if (tenant.role !== "OWNER" && changes.some(([key]) => key !== "isAvailable")) {
      throw forbidden("Solo el propietario puede editar el menú. Tú puedes marcar productos como agotados o disponibles.", "ROLE_REQUIRED");
    }

    return prisma.$transaction(async (tx) => {
      const current = await productsRepository.findById(id, tenant.businessId, tx);
      if (!current) throw productNotFound();
      if (current.archivedAt) throw conflict("Este producto está archivado. Restáuralo para editarlo.", "PRODUCT_ARCHIVED");

      const data: Prisma.ProductUncheckedUpdateInput = {
        name: input.name,
        description: input.description,
        price: input.price,
        isActive: input.isActive,
        isAvailable: input.isAvailable,
      };
      if (input.categoryId !== undefined && input.categoryId !== current.categoryId) {
        const categoryId = await resolveCategory(tenant.businessId, input.categoryId, tx);
        data.categoryId = categoryId;
        data.position = await productsRepository.nextPosition(tenant.businessId, categoryId, tx);
      }
      return productsRepository.update(id, tenant.businessId, data, tx);
    });
  },

  /**
   * Elimina el producto. Si aparece en pedidos se archiva en lugar de borrarse
   * (sección 5 del documento): sale de la tienda y del menú, pero el historial se conserva.
   */
  async remove(tenant: TenantContext, id: string): Promise<{ result: "deleted" | "archived" }> {
    const product = await productsRepository.findById(id, tenant.businessId);
    if (!product) throw productNotFound();

    const archive = async () => {
      if (!product.archivedAt) await productsRepository.update(id, tenant.businessId, { archivedAt: new Date() });
      return { result: "archived" as const };
    };

    if (await productsRepository.appearsInOrders(id, tenant.businessId)) return archive();
    try {
      await productsRepository.delete(id, tenant.businessId);
    } catch (error) {
      // Un pedido lo incluyó justo ahora: la clave foránea (ON DELETE RESTRICT) lo protege.
      if (isForeignKeyError(error)) return archive();
      throw error;
    }
    await deleteImage(product.imageKey);
    return { result: "deleted" };
  },

  /** Devuelve un producto archivado al menú, al final de su categoría. */
  async restore(tenant: TenantContext, id: string) {
    return prisma.$transaction(async (tx) => {
      const product = await productsRepository.findById(id, tenant.businessId, tx);
      if (!product) throw productNotFound();
      if (!product.archivedAt) return toPublic(product);
      await subscriptionsService.assertLimit(tenant.businessId, "products", tx);
      if ((await productsRepository.countCurrent(tenant.businessId, tx)) >= MAX_PRODUCTS) {
        throw conflict(`Llegaste al límite de ${MAX_PRODUCTS} productos.`, "PRODUCT_LIMIT");
      }
      const position = await productsRepository.nextPosition(tenant.businessId, product.categoryId, tx);
      return productsRepository.update(id, tenant.businessId, { archivedAt: null, position }, tx);
    });
  },

  /** Recibe el orden completo de una categoría; si el menú cambió entre tanto, pide recargar. */
  async reorder(tenant: TenantContext, input: ReorderProductsInput) {
    await prisma.$transaction(async (tx) => {
      const current = await productsRepository.currentIdsInCategory(tenant.businessId, input.categoryId, tx);
      if (!sameIds(current, input.productIds)) {
        throw conflict("Tu menú cambió mientras lo ordenabas. Recarga la página e intenta de nuevo.", "ORDER_OUTDATED");
      }
      await productsRepository.setPositions(tenant.businessId, input.productIds, tx);
    });
  },

  /** Guarda la foto (procesada en el servidor) y borra la anterior. */
  async setImage(tenant: TenantContext, id: string, file: Buffer) {
    const product = await productsRepository.findById(id, tenant.businessId);
    if (!product) throw productNotFound();

    const saved = await saveImage(file, "product", `businesses/${tenant.businessId}/products/${id}`);
    let updated;
    try {
      updated = await productsRepository.update(id, tenant.businessId, { imageUrl: saved.url, imageKey: saved.key });
    } catch (error) {
      await deleteImage(saved.key);
      throw error;
    }
    await deleteImage(product.imageKey);
    return updated;
  },

  async removeImage(tenant: TenantContext, id: string) {
    const product = await productsRepository.findById(id, tenant.businessId);
    if (!product) throw productNotFound();
    const updated = await productsRepository.update(id, tenant.businessId, { imageUrl: null, imageKey: null });
    await deleteImage(product.imageKey);
    return updated;
  },
};
