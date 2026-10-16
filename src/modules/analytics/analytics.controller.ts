import type { Request, Response } from "express";
import { getTenant } from "../../middlewares/authorize.js";
import type { RangeQuery } from "./analytics.schemas.js";
import { analyticsService } from "./analytics.service.js";

export const analyticsController = {
  async summary(req: Request, res: Response) {
    res.json({ data: await analyticsService.summary(getTenant(req), req.query as unknown as RangeQuery) });
  },

  async today(req: Request, res: Response) {
    res.json({ data: await analyticsService.today(getTenant(req)) });
  },
};
