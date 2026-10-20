import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { clientErrorLimiter } from "../../middlewares/rateLimiter.js";
import { validate } from "../../middlewares/validate.js";
import { logger } from "../../utils/logger.js";

/**
 * Errores de JavaScript de los navegadores (public/js/error-report.js). Solo se registran en el log:
 * permiten corregir fallas que pasan en ciertos celulares y que en el servidor no se ven.
 */
const clientErrorSchema = z.object({
  message: z.string().trim().min(1).max(500),
  source: z.string().trim().max(300).optional(),
  line: z.number().int().min(0).max(10_000_000).optional(),
  column: z.number().int().min(0).max(10_000_000).optional(),
  stack: z.string().max(3000).optional(),
  /** Solo la ruta (sin `?` ni `#`, donde pueden ir claves). */
  page: z.string().trim().max(300).optional(),
});

export const clientErrorsRoutes = Router();

clientErrorsRoutes.post("/", clientErrorLimiter, validate({ body: clientErrorSchema }), (req: Request, res: Response) => {
  const report = req.body as z.infer<typeof clientErrorSchema>;
  logger.warn({ clientError: report, userAgent: req.get("user-agent")?.slice(0, 300) }, "Error de JavaScript en el navegador");
  res.status(204).end();
});
