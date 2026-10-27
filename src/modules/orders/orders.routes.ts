import { Router, type Request, type Response } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { getTenant, requireBusiness } from "../../middlewares/authorize.js";
import { orderLimiter, proofLimiter, trackingLimiter } from "../../middlewares/rateLimiter.js";
import { validate } from "../../middlewares/validate.js";
import { paymentProofsService } from "../payment-accounts/payment-proofs.service.js";
import { ordersController } from "./orders.controller.js";
import {
  changeStatusSchema,
  createOrderSchema,
  listOrdersQuerySchema,
  orderParamsSchema,
  paymentSchema,
  storeOrderIdParamsSchema,
  storeOrderParamsSchema,
  tablePaymentSchema,
  tableQrScanSchema,
  whatsappOpenedParamsSchema,
  whatsappOpenedSchema,
} from "./orders.schemas.js";

// ─── /api/v1/orders — panel: propietario y empleados atienden los pedidos ───
export const ordersRoutes = Router();
ordersRoutes.use(authenticate, requireBusiness());

ordersRoutes.get("/", validate({ query: listOrdersQuerySchema }), ordersController.list);
ordersRoutes.get("/:id", validate({ params: orderParamsSchema }), ordersController.get);
ordersRoutes.patch("/:id/status", validate({ params: orderParamsSchema, body: changeStatusSchema }), ordersController.changeStatus);
ordersRoutes.patch("/:id/payment", validate({ params: orderParamsSchema, body: paymentSchema }), ordersController.setPaid);
// Comprobante que subió el cliente al pagar por adelantado (imagen privada, nunca en caché compartida).
ordersRoutes.get("/:id/payment-proof", validate({ params: orderParamsSchema }), async (req: Request, res: Response) => {
  const image = await paymentProofsService.image(getTenant(req), (req.params as { id: string }).id);
  res.set("Cache-Control", "private, no-store").type("image/webp").send(image);
});
// Enlace para que el domiciliario comparta su ubicación (cualquier persona del equipo lo despacha).
ordersRoutes.post("/:id/courier-link", validate({ params: orderParamsSchema }), ordersController.courierLink);

// ─── /api/v1/store/:slug/orders — pedidos desde la tienda pública, sin sesión ───
export const storeOrderRoutes = Router({ mergeParams: true });

storeOrderRoutes.post(
  "/",
  orderLimiter,
  validate({ params: storeOrderParamsSchema, body: createOrderSchema }),
  ordersController.createFromStore,
);
storeOrderRoutes.get("/:id", trackingLimiter, validate({ params: storeOrderIdParamsSchema }), ordersController.track);
// Pagar la cuenta de la mesa: el cliente escanea el QR de pago del local y luego sube su comprobante.
storeOrderRoutes.post(
  "/:id/payment-scan",
  trackingLimiter,
  validate({ params: storeOrderIdParamsSchema, body: tableQrScanSchema }),
  ordersController.scanTableQr,
);
storeOrderRoutes.post(
  "/:id/payment-proof",
  proofLimiter,
  validate({ params: storeOrderIdParamsSchema, body: tablePaymentSchema }),
  ordersController.payTableBill,
);
storeOrderRoutes.post(
  "/:id/whatsapp",
  validate({ params: whatsappOpenedParamsSchema, body: whatsappOpenedSchema }),
  ordersController.whatsappOpened,
);
