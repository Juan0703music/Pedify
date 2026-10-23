import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { PlanCode } from "../../generated/prisma/enums.js";
import { authenticate, getAuth } from "../../middlewares/authenticate.js";
import { getTenant, requireBusiness } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import { wompiEventSchema, type WompiEvent } from "../../services/wompi.service.js";
import { storeUrl } from "../businesses/businesses.controller.js";
import { businessesService } from "../businesses/businesses.service.js";
import { planCheckoutsService } from "./plan-checkouts.service.js";
import { subscriptionsService } from "./subscriptions.service.js";

const checkoutSchema = z.object({
  plan: z.enum(PlanCode, { error: "Elige uno de los planes." }),
  months: z.union([z.literal(1), z.literal(12)], { error: "Paga un mes o el año completo (12 meses)." }),
});
const checkoutParamsSchema = z.object({ id: z.uuid("Pago inválido.") });
const confirmSchema = z.object({ transactionId: z.string().trim().min(1).max(100).optional() });

// ─── /api/v1/subscription — "Mi plan" del negocio activo (solo el propietario) ───
export const subscriptionRoutes = Router();
subscriptionRoutes.use(authenticate, requireBusiness("OWNER"));

subscriptionRoutes.get("/", async (req: Request, res: Response) => {
  const tenant = getTenant(req);
  const business = await businessesService.getCurrent(tenant);
  res.json({ data: await subscriptionsService.details(tenant, { name: business.name, storeUrl: storeUrl(business.slug) }) });
});

// Pagar el plan en línea: devuelve el enlace de Wompi y, al volver, confirma la transacción.
subscriptionRoutes.post("/checkouts", validate({ body: checkoutSchema }), async (req: Request, res: Response) => {
  const input = req.body as z.infer<typeof checkoutSchema>;
  res.status(201).json({ data: await planCheckoutsService.start(getTenant(req), getAuth(req).userId, input) });
});

subscriptionRoutes.post("/checkouts/:id/confirm", validate({ params: checkoutParamsSchema, body: confirmSchema }), async (req: Request, res: Response) => {
  const { id } = req.params as z.infer<typeof checkoutParamsSchema>;
  const { transactionId } = req.body as z.infer<typeof confirmSchema>;
  res.json({ data: await planCheckoutsService.confirm(getTenant(req), id, transactionId) });
});

// ─── /api/v1/webhooks/wompi — avisos de Wompi sobre las transacciones (sin sesión, con firma) ───
export const wompiWebhookRoutes = Router();

wompiWebhookRoutes.post("/", validate({ body: wompiEventSchema }), async (req: Request, res: Response) => {
  await planCheckoutsService.handleEvent(req.body as WompiEvent);
  res.json({ data: { received: true } });
});
