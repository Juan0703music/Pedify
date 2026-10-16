import { Router, type Request, type Response } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { getTenant, requireBusiness } from "../../middlewares/authorize.js";
import { storeUrl } from "../businesses/businesses.controller.js";
import { businessesService } from "../businesses/businesses.service.js";
import { subscriptionsService } from "./subscriptions.service.js";

// ─── /api/v1/subscription — "Mi plan" del negocio activo (solo el propietario) ───
export const subscriptionRoutes = Router();
subscriptionRoutes.use(authenticate, requireBusiness("OWNER"));

subscriptionRoutes.get("/", async (req: Request, res: Response) => {
  const tenant = getTenant(req);
  const business = await businessesService.getCurrent(tenant);
  res.json({ data: await subscriptionsService.details(tenant, { name: business.name, storeUrl: storeUrl(business.slug) }) });
});
