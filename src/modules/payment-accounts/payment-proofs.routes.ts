import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { proofLimiter } from "../../middlewares/rateLimiter.js";
import { imageBody } from "../../middlewares/upload.js";
import { validate } from "../../middlewares/validate.js";
import { notFound } from "../../utils/errors.js";
import { PaymentAccountKind } from "../../generated/prisma/enums.js";
import { businessesRepository } from "../businesses/businesses.repository.js";
import { storeOrderParamsSchema, type StoreOrderParams } from "../orders/orders.schemas.js";
import { PAYMENT_ACCOUNT_LABEL } from "./payment-accounts.schemas.js";
import { paymentAccountsService } from "./payment-accounts.service.js";
import { paymentProofsService } from "./payment-proofs.service.js";

// ─── /api/v1/store/:slug/payment-proofs — el cliente sube su comprobante antes de pedir (sin sesión) ───
export const storePaymentProofRoutes = Router({ mergeParams: true });

storePaymentProofRoutes.post("/", proofLimiter, validate({ params: storeOrderParamsSchema }), imageBody, async (req: Request, res: Response) => {
  const { slug } = req.params as StoreOrderParams;
  res.status(201).json({ data: await paymentProofsService.upload(slug, req.body as Buffer) });
});

// ─── /api/v1/store/:slug/payment-qr/:kind.png — el QR de pago para guardarlo en el celular ───
const qrParamsSchema = storeOrderParamsSchema.extend({ kind: z.enum(PaymentAccountKind) });
export const storePaymentQrRoutes = Router({ mergeParams: true });

storePaymentQrRoutes.get("/:kind.png", validate({ params: qrParamsSchema }), async (req: Request, res: Response) => {
  const { slug, kind } = req.params as z.infer<typeof qrParamsSchema>;
  const business = await businessesRepository.findStoreBySlug(slug);
  if (!business || business.status !== "ACTIVE" || !business.settings) throw notFound("Esta tienda no existe o ya no está disponible.", "STORE_NOT_FOUND");
  const png = await paymentAccountsService.qrPngForStore(business.id, business.settings.paymentMethods, kind);
  res
    .set("Cache-Control", "no-cache")
    .set("Content-Disposition", `attachment; filename="qr-${PAYMENT_ACCOUNT_LABEL[kind].toLowerCase().replace(/[^a-z]/g, "")}-${slug}.png"`)
    .type("image/png")
    .send(png);
});
