import { Router, type Request, type Response } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { getTenant, requireBusiness } from "../../middlewares/authorize.js";
import { uploadLimiter } from "../../middlewares/rateLimiter.js";
import { imageBody } from "../../middlewares/upload.js";
import { validate } from "../../middlewares/validate.js";
import {
  paymentAccountParamsSchema,
  updatePaymentAccountSchema,
  type PaymentAccountParams,
  type UpdatePaymentAccountInput,
} from "./payment-accounts.schemas.js";
import { paymentAccountsService } from "./payment-accounts.service.js";

// ─── /api/v1/businesses/current/payment-accounts — cuentas para cobrar con QR (solo el propietario) ───
export const paymentAccountsRoutes = Router();
paymentAccountsRoutes.use(authenticate, requireBusiness("OWNER"));

const params = validate({ params: paymentAccountParamsSchema });
const kindOf = (req: Request) => (req.params as PaymentAccountParams).kind;

paymentAccountsRoutes.get("/", async (req: Request, res: Response) => {
  res.json({ data: await paymentAccountsService.list(getTenant(req).businessId) });
});

paymentAccountsRoutes.put("/:kind", validate({ params: paymentAccountParamsSchema, body: updatePaymentAccountSchema }), async (req: Request, res: Response) => {
  res.json({ data: await paymentAccountsService.update(getTenant(req), kindOf(req), req.body as UpdatePaymentAccountInput) });
});

paymentAccountsRoutes.post("/:kind/qr", uploadLimiter, params, imageBody, async (req: Request, res: Response) => {
  res.json({ data: await paymentAccountsService.setQr(getTenant(req), kindOf(req), req.body as Buffer) });
});

paymentAccountsRoutes.delete("/:kind", params, async (req: Request, res: Response) => {
  await paymentAccountsService.remove(getTenant(req), kindOf(req));
  res.status(204).end();
});
