import { Router, type Request, type Response } from "express";
import { authenticate, getAuth } from "../../middlewares/authenticate.js";
import { getTenant, requireBusiness } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import { subscribeSchema, unsubscribeSchema, type SubscribeInput, type UnsubscribeInput } from "./push.schemas.js";
import { pushService } from "./push.service.js";

// ─── /api/v1/push — avisos de pedidos nuevos en los dispositivos del equipo (propietario y empleados) ───
export const pushRoutes = Router();
pushRoutes.use(authenticate, requireBusiness());

/** Llave pública VAPID con la que el navegador crea la suscripción (o `enabled: false`). */
pushRoutes.get("/public-key", (_req: Request, res: Response) => {
  res.json({ data: pushService.publicKey() });
});

pushRoutes.post("/subscriptions", validate({ body: subscribeSchema }), async (req: Request, res: Response) => {
  const data = await pushService.subscribe(getAuth(req).userId, getTenant(req), req.body as SubscribeInput, req.get("user-agent"));
  res.status(201).json({ data });
});

pushRoutes.delete("/subscriptions", validate({ body: unsubscribeSchema }), async (req: Request, res: Response) => {
  await pushService.unsubscribe(getAuth(req).userId, (req.body as UnsubscribeInput).endpoint);
  res.status(204).end();
});

pushRoutes.post("/test", async (req: Request, res: Response) => {
  res.json({ data: await pushService.sendTest(getAuth(req).userId, getTenant(req)) });
});
