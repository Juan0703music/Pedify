import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { requireBusiness, requirePermission } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import { analyticsController } from "./analytics.controller.js";
import { rangeQuerySchema } from "./analytics.schemas.js";

// ─── /api/v1/analytics ───
export const analyticsRoutes = Router();
analyticsRoutes.use(authenticate);

// Resumen del día para el Inicio: el propietario y los empleados con permiso de ver las ventas.
analyticsRoutes.get("/today", requireBusiness(), requirePermission("viewSales"), analyticsController.today);
// Analíticas completas: el propietario y los empleados con ese permiso.
analyticsRoutes.get(
  "/summary",
  requireBusiness(),
  requirePermission("viewAnalytics"),
  validate({ query: rangeQuerySchema }),
  analyticsController.summary,
);
