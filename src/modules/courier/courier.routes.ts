import { Router, type Request, type Response } from "express";
import { courierLimiter } from "../../middlewares/rateLimiter.js";
import { validate } from "../../middlewares/validate.js";
import { notFound } from "../../utils/errors.js";
import { courierKeySchema, courierLocationSchema, type CourierLocationInput } from "./courier.schemas.js";
import { courierService } from "./courier.service.js";

/** Clave del enlace en la cabecera X-Courier-Key (inválida = 404, sin dar pistas). */
function keyOf(req: Request): string {
  const key = courierKeySchema.safeParse(req.get("x-courier-key") ?? "");
  if (!key.success) throw notFound("Este enlace no es válido.", "COURIER_LINK_INVALID");
  return key.data;
}

// ─── /api/v1/courier — página del domiciliario, sin cuenta (con la clave del enlace) ───
export const courierRoutes = Router();
courierRoutes.use(courierLimiter);

courierRoutes.get("/", async (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  res.json({ data: await courierService.view(keyOf(req)) });
});

courierRoutes.post("/location", validate({ body: courierLocationSchema }), async (req: Request, res: Response) => {
  await courierService.updateLocation(keyOf(req), req.body as CourierLocationInput);
  res.status(204).end();
});

courierRoutes.post("/delivered", async (req: Request, res: Response) => {
  await courierService.markDelivered(keyOf(req));
  res.status(204).end();
});
