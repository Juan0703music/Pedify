import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { PlanCode } from "../../generated/prisma/enums.js";
import { authenticate, getAuth } from "../../middlewares/authenticate.js";
import { getTenant, requireBusiness } from "../../middlewares/authorize.js";
import { proofLimiter } from "../../middlewares/rateLimiter.js";
import { imageBody } from "../../middlewares/upload.js";
import { validate } from "../../middlewares/validate.js";
import { wompiEventSchema, type WompiEvent } from "../../services/wompi.service.js";
import { storeUrl } from "../businesses/businesses.controller.js";
import { businessesService } from "../businesses/businesses.service.js";
import { planCheckoutsService } from "./plan-checkouts.service.js";
import { planTransfersService } from "./plan-transfers.service.js";
import { PLATFORM_ACCOUNT_KINDS, platformAccountsService } from "./platform-accounts.service.js";
import { subscriptionsService } from "./subscriptions.service.js";

const checkoutSchema = z.object({
  plan: z.enum(PlanCode, { error: "Elige uno de los planes." }),
  months: z.union([z.literal(1), z.literal(12)], { error: "Paga un mes o el año completo (12 meses)." }),
});
const checkoutParamsSchema = z.object({ id: z.uuid("Pago inválido.") });
const confirmSchema = z.object({ transactionId: z.string().trim().min(1).max(100).optional() });
const transferQuerySchema = checkoutSchema.extend({
  months: z.coerce.number().pipe(checkoutSchema.shape.months),
  method: z.enum(PLATFORM_ACCOUNT_KINDS, { error: "Paga por Nequi o con la llave Bre-B." }),
});
const transferParamsSchema = z.object({ id: z.uuid("Pago inválido.") });
const qrParamsSchema = z.object({ kind: z.enum(PLATFORM_ACCOUNT_KINDS) });

// ─── /api/v1/subscription — "Mi plan" del negocio activo (solo el propietario) ───
export const subscriptionRoutes = Router();
subscriptionRoutes.use(authenticate, requireBusiness("OWNER"));

subscriptionRoutes.get("/", async (req: Request, res: Response) => {
  const tenant = getTenant(req);
  const business = await businessesService.getCurrent(tenant);
  const [details, accounts, transfer] = await Promise.all([
    subscriptionsService.details(tenant, { name: business.name, storeUrl: storeUrl(business.slug) }),
    platformAccountsService.usable(),
    planTransfersService.latestFor(tenant.businessId),
  ]);
  // Pago directo a las cuentas de Pedify (Nequi o llave Bre-B) con comprobante: null si no hay cuentas.
  res.json({ data: { ...details, directPayment: accounts.length > 0 ? { accounts } : null, transfer } });
});

// Pagar el plan directo a Nequi o a la llave Bre-B de Pedify: sube el comprobante y queda en revisión.
subscriptionRoutes.post("/transfers", proofLimiter, validate({ query: transferQuerySchema }), imageBody, async (req: Request, res: Response) => {
  const input = req.query as unknown as z.infer<typeof transferQuerySchema>;
  res.status(201).json({ data: await planTransfersService.create(getTenant(req), getAuth(req).userId, input, req.body as Buffer) });
});

subscriptionRoutes.delete("/transfers/:id", validate({ params: transferParamsSchema }), async (req: Request, res: Response) => {
  await planTransfersService.cancel(getTenant(req), (req.params as z.infer<typeof transferParamsSchema>).id);
  res.status(204).end();
});

// El QR de pago de Pedify en PNG, para guardarlo y pagar desde el mismo celular.
subscriptionRoutes.get("/payment-qr/:kind.png", validate({ params: qrParamsSchema }), async (req: Request, res: Response) => {
  const { kind } = req.params as z.infer<typeof qrParamsSchema>;
  res
    .set("Cache-Control", "no-cache")
    .set("Content-Disposition", `attachment; filename="qr-pedify-${kind === "BRE_B" ? "breb" : "nequi"}.png"`)
    .type("image/png")
    .send(await platformAccountsService.qrPng(kind));
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
