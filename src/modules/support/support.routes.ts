import { Router, type Request, type Response } from "express";
import { authenticate, getAuth } from "../../middlewares/authenticate.js";
import { requireCaptcha } from "../../middlewares/captcha.js";
import { supportLimiter, supportMessageLimiter } from "../../middlewares/rateLimiter.js";
import { validate } from "../../middlewares/validate.js";
import { notFound } from "../../utils/errors.js";
import { createTicketSchema, publicTicketSchema, supportMessageSchema, ticketParamsSchema, type CreateTicketInput, type PublicTicketInput } from "./support.schemas.js";
import { supportService } from "./support.service.js";

const ticketId = (req: Request) => (req.params as { id: string }).id;
const body = (req: Request) => (req.body as { body: string }).body;

// ─── /api/v1/support — solicitudes y PQRS de la persona con sesión (desde el panel de su negocio) ───
export const supportRoutes = Router();
supportRoutes.use(authenticate);

supportRoutes.get("/tickets", async (req: Request, res: Response) => {
  res.json({ data: await supportService.listForUser(getAuth(req).userId) });
});

supportRoutes.get("/unread", async (req: Request, res: Response) => {
  res.json({ data: { unread: await supportService.unreadForUser(getAuth(req).userId) } });
});

supportRoutes.post("/tickets", supportLimiter, validate({ body: createTicketSchema }), async (req: Request, res: Response) => {
  res.status(201).json({ data: await supportService.createForUser(getAuth(req), req.body as CreateTicketInput) });
});

supportRoutes.get("/tickets/:id", validate({ params: ticketParamsSchema }), async (req: Request, res: Response) => {
  res.json({ data: await supportService.getForUser(getAuth(req).userId, ticketId(req)) });
});

supportRoutes.post("/tickets/:id/messages", supportMessageLimiter, validate({ params: ticketParamsSchema, body: supportMessageSchema }), async (req: Request, res: Response) => {
  res.status(201).json({ data: await supportService.replyAsUser(getAuth(req).userId, ticketId(req), body(req)) });
});

// ─── /api/v1/support/public — desde /soporte, sin cuenta (el caso se abre con la clave del enlace) ───
export const publicSupportRoutes = Router();

const accessKey = (req: Request) => {
  const key = req.get("x-support-key") ?? "";
  if (!/^[\w-]{20,64}$/.test(key)) throw notFound("No encontramos esa solicitud. Revisa el enlace del correo.", "TICKET_NOT_FOUND");
  return key;
};

publicSupportRoutes.post("/", supportLimiter, requireCaptcha, validate({ body: publicTicketSchema }), async (req: Request, res: Response) => {
  res.status(201).json({ data: await supportService.createPublic(req.body as PublicTicketInput) });
});

publicSupportRoutes.get("/:id", validate({ params: ticketParamsSchema }), async (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store").json({ data: await supportService.getWithKey(ticketId(req), accessKey(req)) });
});

publicSupportRoutes.post("/:id/messages", supportMessageLimiter, validate({ params: ticketParamsSchema, body: supportMessageSchema }), async (req: Request, res: Response) => {
  res.status(201).json({ data: await supportService.replyWithKey(ticketId(req), accessKey(req), body(req)) });
});
