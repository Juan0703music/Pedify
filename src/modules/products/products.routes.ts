import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { requireBusiness } from "../../middlewares/authorize.js";
import { uploadLimiter } from "../../middlewares/rateLimiter.js";
import { imageBody } from "../../middlewares/upload.js";
import { validate } from "../../middlewares/validate.js";
import { categoriesController, productsController } from "./products.controller.js";
import {
  categoryParamsSchema,
  categoryProductsSchema,
  categorySchema,
  createProductSchema,
  listProductsQuerySchema,
  productParamsSchema,
  reorderCategoriesSchema,
  reorderProductsSchema,
  updateProductSchema,
} from "./products.schemas.js";

// Cualquier miembro consulta el menú; solo el propietario lo modifica.
// Excepción: un empleado puede marcar productos agotados (PATCH con isAvailable, ver productsService.update).
const anyMember = requireBusiness();
const ownerOnly = requireBusiness("OWNER");
const params = validate({ params: productParamsSchema });

// ─── /api/v1/products (sección 4 del documento) ───
export const productsRoutes = Router();
productsRoutes.use(authenticate);

productsRoutes.get("/", anyMember, validate({ query: listProductsQuerySchema }), productsController.list);
productsRoutes.post("/", ownerOnly, validate({ body: createProductSchema }), productsController.create);
productsRoutes.get("/summary", anyMember, productsController.summary);
productsRoutes.put("/order", ownerOnly, validate({ body: reorderProductsSchema }), productsController.reorder);

productsRoutes.get("/:id", anyMember, params, productsController.get);
productsRoutes.patch("/:id", anyMember, validate({ params: productParamsSchema, body: updateProductSchema }), productsController.update);
productsRoutes.delete("/:id", ownerOnly, params, productsController.remove);
productsRoutes.post("/:id/restore", ownerOnly, params, productsController.restore);
productsRoutes.post("/:id/image", ownerOnly, uploadLimiter, params, imageBody, productsController.setImage);
productsRoutes.delete("/:id/image", ownerOnly, params, productsController.removeImage);

// ─── /api/v1/categories ───
export const categoriesRoutes = Router();
categoriesRoutes.use(authenticate);

const categoryParams = validate({ params: categoryParamsSchema });

categoriesRoutes.get("/", anyMember, categoriesController.list);
categoriesRoutes.post("/", ownerOnly, validate({ body: categorySchema }), categoriesController.create);
categoriesRoutes.put("/order", ownerOnly, validate({ body: reorderCategoriesSchema }), categoriesController.reorder);
categoriesRoutes.patch("/:id", ownerOnly, validate({ params: categoryParamsSchema, body: categorySchema }), categoriesController.rename);
categoriesRoutes.delete("/:id", ownerOnly, categoryParams, categoriesController.remove);
categoriesRoutes.put("/:id/products", ownerOnly, validate({ params: categoryParamsSchema, body: categoryProductsSchema }), categoriesController.setProducts);
