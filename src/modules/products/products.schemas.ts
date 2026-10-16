import { z } from "zod";
import { copAmountSchema } from "../../utils/currency.js";
import { optionalText } from "../businesses/businesses.schemas.js";

const uniqueIds = (ids: string[]) => new Set(ids).size === ids.length;

const productNameSchema = z
  .string({ error: "Escribe el nombre del producto." })
  .trim()
  .min(2, "Escribe el nombre del producto.")
  .max(80, "El nombre no puede superar 80 caracteres.");

const priceSchema = copAmountSchema.positive("El precio debe ser mayor que $0.");

const categoryIdSchema = z.uuid("Elige una categoría válida.").nullable();

export const createProductSchema = z.object({
  name: productNameSchema,
  description: optionalText(300, "La descripción"),
  price: priceSchema,
  categoryId: categoryIdSchema.optional(),
  /** Visible en la tienda. */
  isActive: z.boolean().default(true),
  /** false = agotado. */
  isAvailable: z.boolean().default(true),
});

export const updateProductSchema = z.object({
  name: productNameSchema.optional(),
  description: optionalText(300, "La descripción"),
  price: priceSchema.optional(),
  categoryId: categoryIdSchema.optional(),
  isActive: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
});

export const productParamsSchema = z.object({
  id: z.uuid("Producto inválido."),
});

export const listProductsQuerySchema = z.object({
  /** current: menú vigente · archived: productos archivados (aparecían en pedidos). */
  status: z.enum(["current", "archived"]).default("current"),
});

/** Orden completo de los productos de una categoría (null = sin categoría). */
export const reorderProductsSchema = z.object({
  categoryId: categoryIdSchema,
  productIds: z.array(z.uuid()).min(1).max(500).refine(uniqueIds, "Hay productos repetidos en la lista."),
});

const categoryNameSchema = z
  .string({ error: "Escribe el nombre de la categoría." })
  .trim()
  .min(2, "Escribe el nombre de la categoría.")
  .max(40, "El nombre no puede superar 40 caracteres.");

export const categorySchema = z.object({
  name: categoryNameSchema,
});

export const categoryParamsSchema = z.object({
  id: z.uuid("Categoría inválida."),
});

export const reorderCategoriesSchema = z.object({
  categoryIds: z.array(z.uuid()).min(1).max(100).refine(uniqueIds, "Hay categorías repetidas en la lista."),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductParams = z.infer<typeof productParamsSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
export type ReorderProductsInput = z.infer<typeof reorderProductsSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type CategoryParams = z.infer<typeof categoryParamsSchema>;
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>;
