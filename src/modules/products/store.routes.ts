import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middlewares/validate.js";
import { storeController } from "./store.controller.js";

const storeParamsSchema = z.object({
  slug: z.string().trim().toLowerCase().max(60),
});

export type StoreParams = z.infer<typeof storeParamsSchema>;

// ─── /api/v1/store — tienda pública, sin sesión ───
export const storeRoutes = Router();

storeRoutes.get("/:slug", validate({ params: storeParamsSchema }), storeController.show);
