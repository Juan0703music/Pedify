import type { Request, Response } from "express";
import { getAuth } from "../../middlewares/authenticate.js";
import { getTenant } from "../../middlewares/authorize.js";
import { notFound } from "../../utils/errors.js";
import { idempotencyKeySchema } from "./orders.schemas.js";
import { ordersService } from "./orders.service.js";
import { courierService } from "../courier/courier.service.js";
import type {
  ChangeStatusInput,
  CreateOrderInput,
  ListOrdersQuery,
  OrderParams,
  PaymentInput,
  StoreOrderParams,
  StoreOrderIdParams,
  WhatsappOpenedParams,
} from "./orders.schemas.js";

/** Clave secreta del pedido que envía el navegador del cliente (cabecera X-Order-Key). */
function orderKey(req: Request) {
  const key = idempotencyKeySchema.safeParse(req.get("x-order-key") ?? "");
  if (!key.success) throw notFound("No encontramos ese pedido.", "ORDER_NOT_FOUND");
  return key.data;
}

export const ordersController = {
  // ─── Panel ───
  async list(req: Request, res: Response) {
    res.json({ data: await ordersService.list(getTenant(req), req.query as unknown as ListOrdersQuery) });
  },

  async get(req: Request, res: Response) {
    const { id } = req.params as OrderParams;
    res.json({ data: await ordersService.get(getTenant(req), id) });
  },

  async changeStatus(req: Request, res: Response) {
    const { id } = req.params as OrderParams;
    res.json({ data: await ordersService.changeStatus(getTenant(req), getAuth(req).userId, id, req.body as ChangeStatusInput) });
  },

  async setPaid(req: Request, res: Response) {
    const { id } = req.params as OrderParams;
    const { paid } = req.body as PaymentInput;
    res.json({ data: await ordersService.setPaid(getTenant(req), getAuth(req).userId, id, paid) });
  },

  // ─── Tienda pública ───
  /** POST /api/v1/store/:slug/orders — 201 pedido nuevo · 200 reintento con la misma clave. */
  async createFromStore(req: Request, res: Response) {
    const { slug } = req.params as StoreOrderParams;
    const result = await ordersService.createFromStore(slug, req.body as CreateOrderInput);
    res.set("Cache-Control", "no-store");
    res.status(result.created ? 201 : 200).json({ data: { order: result.order, whatsapp: result.whatsapp } });
  },

  /** POST /api/v1/orders/:id/courier-link — enlace (y QR) para el domiciliario; cambia el anterior. */
  async courierLink(req: Request, res: Response) {
    const { id } = req.params as OrderParams;
    res.status(201).json({ data: await courierService.createLink(getTenant(req), id) });
  },

  /** GET /api/v1/store/:slug/orders/:id — seguimiento del pedido (cabecera X-Order-Key). */
  async track(req: Request, res: Response) {
    const { slug, id } = req.params as StoreOrderIdParams;
    res.set("Cache-Control", "no-store");
    res.json({ data: await ordersService.trackFromStore(slug, id, orderKey(req)) });
  },

  /** POST /api/v1/store/:slug/orders/:id/whatsapp — el cliente abrió WhatsApp con el mensaje. */
  async whatsappOpened(req: Request, res: Response) {
    const { slug, id } = req.params as WhatsappOpenedParams;
    await ordersService.markWhatsappOpened(slug, id, (req.body as { idempotencyKey: string }).idempotencyKey);
    res.status(204).end();
  },
};
