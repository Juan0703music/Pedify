import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { requireBusiness } from "../../middlewares/authorize.js";
import { registerLimiter, uploadLimiter } from "../../middlewares/rateLimiter.js";
import { imageBody } from "../../middlewares/upload.js";
import { validate } from "../../middlewares/validate.js";
import { businessesController } from "./businesses.controller.js";
import {
  addMemberSchema,
  createBusinessSchema,
  membershipParamsSchema,
  qrQuerySchema,
  updateBusinessSchema,
  updateMemberSchema,
  updateSettingsSchema,
} from "./businesses.schemas.js";

export const businessesRoutes = Router();

businessesRoutes.use(authenticate);

// Negocios del usuario (no requiere negocio activo).
businessesRoutes.get("/", businessesController.listMine);
businessesRoutes.post("/", registerLimiter, validate({ body: createBusinessSchema }), businessesController.create);

// Negocio activo de la sesión: cualquier miembro puede consultar; solo el propietario modifica.
const anyMember = requireBusiness();
const ownerOnly = requireBusiness("OWNER");

businessesRoutes.get("/current", anyMember, businessesController.getCurrent);
businessesRoutes.patch("/current", ownerOnly, validate({ body: updateBusinessSchema }), businessesController.updateCurrent);

// Imágenes de la tienda (cuerpo binario) y código QR del enlace.
businessesRoutes.post("/current/logo", ownerOnly, uploadLimiter, imageBody, businessesController.setImage("logo"));
businessesRoutes.delete("/current/logo", ownerOnly, businessesController.removeImage("logo"));
businessesRoutes.post("/current/banner", ownerOnly, uploadLimiter, imageBody, businessesController.setImage("banner"));
businessesRoutes.delete("/current/banner", ownerOnly, businessesController.removeImage("banner"));
businessesRoutes.get("/current/qr", anyMember, validate({ query: qrQuerySchema }), businessesController.qr);

businessesRoutes.get("/current/settings", anyMember, businessesController.getSettings);
businessesRoutes.patch(
  "/current/settings",
  ownerOnly,
  validate({ body: updateSettingsSchema }),
  businessesController.updateSettings,
);

businessesRoutes.get("/current/members", ownerOnly, businessesController.listMembers);
businessesRoutes.post("/current/members", ownerOnly, validate({ body: addMemberSchema }), businessesController.addMember);
businessesRoutes.patch(
  "/current/members/:membershipId",
  ownerOnly,
  validate({ params: membershipParamsSchema, body: updateMemberSchema }),
  businessesController.updateMember,
);
businessesRoutes.delete(
  "/current/members/:membershipId",
  ownerOnly,
  validate({ params: membershipParamsSchema }),
  businessesController.removeMember,
);
