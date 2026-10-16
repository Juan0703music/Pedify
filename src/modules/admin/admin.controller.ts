import type { Request, Response } from "express";
import { getAuth } from "../../middlewares/authenticate.js";
import type { BusinessParams, ListBusinessesQuery, RecordPaymentInput, UpdateBusinessAdminInput } from "./admin.schemas.js";
import { adminService } from "./admin.service.js";

export const adminController = {
  async metrics(_req: Request, res: Response) {
    res.json({ data: await adminService.metrics() });
  },

  async listBusinesses(req: Request, res: Response) {
    res.json({ data: await adminService.listBusinesses(req.query as unknown as ListBusinessesQuery) });
  },

  async getBusiness(req: Request, res: Response) {
    const { id } = req.params as BusinessParams;
    res.json({ data: await adminService.getBusiness(id) });
  },

  async updateBusiness(req: Request, res: Response) {
    const { id } = req.params as BusinessParams;
    res.json({ data: await adminService.updateBusiness(getAuth(req).userId, id, req.body as UpdateBusinessAdminInput) });
  },

  async recordPayment(req: Request, res: Response) {
    const { id } = req.params as BusinessParams;
    res.status(201).json({ data: await adminService.recordPayment(getAuth(req).userId, id, req.body as RecordPaymentInput) });
  },
};
