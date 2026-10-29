import { Router, type Request, type Response } from "express";
import { authenticate, getAuth } from "../../middlewares/authenticate.js";
import { requirePlatformAdmin } from "../../middlewares/authorize.js";
import { uploadLimiter } from "../../middlewares/rateLimiter.js";
import { imageBody } from "../../middlewares/upload.js";
import { validate } from "../../middlewares/validate.js";
import { paginationQuerySchema, type PaginationQuery } from "../../utils/pagination.js";
import { updatePaymentAccountSchema, type UpdatePaymentAccountInput } from "../payment-accounts/payment-accounts.schemas.js";
import { planTransfersService } from "../subscriptions/plan-transfers.service.js";
import { platformAccountsService } from "../subscriptions/platform-accounts.service.js";
import { adminController } from "./admin.controller.js";
import { adminService } from "./admin.service.js";
import {
  businessParamsSchema,
  listBusinessesQuerySchema,
  listTransfersQuerySchema,
  platformAccountParamsSchema,
  recordPaymentSchema,
  rejectTransferSchema,
  transferParamsSchema,
  updateBusinessAdminSchema,
  type ListTransfersQuery,
  type PlatformAccountParams,
  type TransferParams,
} from "./admin.schemas.js";

// ─── /api/v1/admin — panel central de Pedify (sección 16 del documento) ───
export const adminRoutes = Router();
adminRoutes.use(authenticate, requirePlatformAdmin);

const params = validate({ params: businessParamsSchema });

adminRoutes.get("/metrics", adminController.metrics);
adminRoutes.get("/analytics", async (_req: Request, res: Response) => {
  res.json({ data: await adminService.analytics() });
});
adminRoutes.get("/businesses", validate({ query: listBusinessesQuerySchema }), adminController.listBusinesses);
adminRoutes.get("/businesses/:id", params, adminController.getBusiness);
adminRoutes.patch("/businesses/:id", validate({ params: businessParamsSchema, body: updateBusinessAdminSchema }), adminController.updateBusiness);
adminRoutes.post("/businesses/:id/payments", validate({ params: businessParamsSchema, body: recordPaymentSchema }), adminController.recordPayment);

// Ingresos: los pagos de los planes de todos los negocios.
adminRoutes.get("/payments", validate({ query: paginationQuerySchema }), async (req: Request, res: Response) => {
  res.json({ data: await adminService.listPayments(req.query as unknown as PaginationQuery) });
});

// ─── Pagos directos de los planes (Nequi o llave Bre-B): revisar, aprobar o rechazar ───
const transferId = (req: Request) => (req.params as TransferParams).id;

adminRoutes.get("/transfers", validate({ query: listTransfersQuerySchema }), async (req: Request, res: Response) => {
  res.json({ data: await planTransfersService.list(req.query as unknown as ListTransfersQuery) });
});

adminRoutes.get("/transfers/:id/image", validate({ params: transferParamsSchema }), async (req: Request, res: Response) => {
  res.set("Cache-Control", "private, no-store").type("image/webp").send(await planTransfersService.image(transferId(req)));
});

adminRoutes.post("/transfers/:id/approve", validate({ params: transferParamsSchema }), async (req: Request, res: Response) => {
  res.json({ data: await planTransfersService.approve(getAuth(req).userId, transferId(req)) });
});

adminRoutes.post("/transfers/:id/reject", validate({ params: transferParamsSchema, body: rejectTransferSchema }), async (req: Request, res: Response) => {
  res.json({ data: await planTransfersService.reject(getAuth(req).userId, transferId(req), (req.body as { reason: string }).reason) });
});

// ─── Cuentas de Pedify para recibir el pago de los planes ───
const accountKind = (req: Request) => (req.params as PlatformAccountParams).kind;
const accountParams = validate({ params: platformAccountParamsSchema });

adminRoutes.get("/payment-accounts", async (_req: Request, res: Response) => {
  res.json({ data: await platformAccountsService.list() });
});

adminRoutes.put("/payment-accounts/:kind", validate({ params: platformAccountParamsSchema, body: updatePaymentAccountSchema }), async (req: Request, res: Response) => {
  res.json({ data: await platformAccountsService.update(accountKind(req), req.body as UpdatePaymentAccountInput) });
});

adminRoutes.post("/payment-accounts/:kind/qr", uploadLimiter, accountParams, imageBody, async (req: Request, res: Response) => {
  res.json({ data: await platformAccountsService.setQr(accountKind(req), req.body as Buffer) });
});

adminRoutes.delete("/payment-accounts/:kind", accountParams, async (req: Request, res: Response) => {
  await platformAccountsService.remove(accountKind(req));
  res.status(204).end();
});
