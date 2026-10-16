import type { Request, Response } from "express";
import { getTenant } from "../../middlewares/authorize.js";
import type { CustomerParams, ListCustomersQuery } from "./customers.schemas.js";
import { customersService } from "./customers.service.js";

export const customersController = {
  async list(req: Request, res: Response) {
    res.json({ data: await customersService.list(getTenant(req), req.query as unknown as ListCustomersQuery) });
  },

  async erase(req: Request, res: Response) {
    const { id } = req.params as CustomerParams;
    await customersService.erase(getTenant(req), id);
    res.status(204).end();
  },

  async get(req: Request, res: Response) {
    const { id } = req.params as CustomerParams;
    res.json({ data: await customersService.get(getTenant(req), id) });
  },
};
