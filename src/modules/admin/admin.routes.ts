import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { requirePlatformAdmin } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import { adminController } from "./admin.controller.js";
import { businessParamsSchema, listBusinessesQuerySchema, recordPaymentSchema, updateBusinessAdminSchema } from "./admin.schemas.js";

// ─── /api/v1/admin — panel central de PedifyAI (sección 16 del documento) ───
export const adminRoutes = Router();
adminRoutes.use(authenticate, requirePlatformAdmin);

const params = validate({ params: businessParamsSchema });

adminRoutes.get("/metrics", adminController.metrics);
adminRoutes.get("/businesses", validate({ query: listBusinessesQuerySchema }), adminController.listBusinesses);
adminRoutes.get("/businesses/:id", params, adminController.getBusiness);
adminRoutes.patch("/businesses/:id", validate({ params: businessParamsSchema, body: updateBusinessAdminSchema }), adminController.updateBusiness);
adminRoutes.post("/businesses/:id/payments", validate({ params: businessParamsSchema, body: recordPaymentSchema }), adminController.recordPayment);
