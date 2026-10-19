import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { requireBusiness } from "../../middlewares/authorize.js";
import { orderLimiter, trackingLimiter } from "../../middlewares/rateLimiter.js";
import { validate } from "../../middlewares/validate.js";
import { ordersController } from "./orders.controller.js";
import {
  changeStatusSchema,
  createOrderSchema,
  listOrdersQuerySchema,
  orderParamsSchema,
  paymentSchema,
  storeOrderIdParamsSchema,
  storeOrderParamsSchema,
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

// ─── /api/v1/store/:slug/orders — pedidos desde la tienda pública, sin sesión ───
export const storeOrderRoutes = Router({ mergeParams: true });

storeOrderRoutes.post(
  "/",
  orderLimiter,
  validate({ params: storeOrderParamsSchema, body: createOrderSchema }),
  ordersController.createFromStore,
);
storeOrderRoutes.get("/:id", trackingLimiter, validate({ params: storeOrderIdParamsSchema }), ordersController.track);
storeOrderRoutes.post(
  "/:id/whatsapp",
  validate({ params: whatsappOpenedParamsSchema, body: whatsappOpenedSchema }),
  ordersController.whatsappOpened,
);
