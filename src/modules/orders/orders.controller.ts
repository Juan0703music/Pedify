import type { Request, Response } from "express";
import { getAuth } from "../../middlewares/authenticate.js";
import { getTenant } from "../../middlewares/authorize.js";
import { ordersService } from "./orders.service.js";
import type {
  ChangeStatusInput,
  CreateOrderInput,
  ListOrdersQuery,
  OrderParams,
  PaymentInput,
  StoreOrderParams,
  WhatsappOpenedParams,
} from "./orders.schemas.js";

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

  /** POST /api/v1/store/:slug/orders/:id/whatsapp — el cliente abrió WhatsApp con el mensaje. */
  async whatsappOpened(req: Request, res: Response) {
    const { slug, id } = req.params as WhatsappOpenedParams;
    await ordersService.markWhatsappOpened(slug, id, (req.body as { idempotencyKey: string }).idempotencyKey);
    res.status(204).end();
  },
};
