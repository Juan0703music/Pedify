import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { requireBusiness } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import { analyticsController } from "./analytics.controller.js";
import { rangeQuerySchema } from "./analytics.schemas.js";

// ─── /api/v1/analytics ───
export const analyticsRoutes = Router();
analyticsRoutes.use(authenticate);

// Resumen del día para el Inicio: todo el equipo.
analyticsRoutes.get("/today", requireBusiness(), analyticsController.today);
// Analíticas completas: solo el propietario.
analyticsRoutes.get("/summary", requireBusiness("OWNER"), validate({ query: rangeQuerySchema }), analyticsController.summary);
