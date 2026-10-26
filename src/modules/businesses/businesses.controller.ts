import type { Request, Response } from "express";
import QRCode from "qrcode";
import { env } from "../../config/env.js";
import { getAuth } from "../../middlewares/authenticate.js";
import { getTenant } from "../../middlewares/authorize.js";
import { authService } from "../auth/auth.service.js";
import { businessesService, type BusinessImage } from "./businesses.service.js";
import type {
  AddMemberInput,
  QrQuery,
  CreateBusinessInput,
  MembershipParams,
  UpdateBusinessInput,
  UpdateMemberInput,
  UpdateSettingsInput,
} from "./businesses.schemas.js";

/** Enlace público de la tienda: <APP_URL>/tienda/<slug>. */
export const storeUrl = (slug: string) => new URL(`/tienda/${slug}`, env.APP_URL).toString();

const withStoreUrl = <T extends { slug: string }>(business: T) => ({ ...business, storeUrl: storeUrl(business.slug) });

export const businessesController = {
  async listMine(req: Request, res: Response) {
    res.json({ data: await businessesService.listMine(getAuth(req).userId) });
  },

  /** Crea otro negocio para el usuario y lo deja como negocio activo de la sesión. */
  async create(req: Request, res: Response) {
    const auth = getAuth(req);
    const business = await businessesService.createAdditional(auth.userId, req.body as CreateBusinessInput);
    await authService.switchBusiness(auth, business.id);
    res.status(201).json({ data: withStoreUrl(business) });
  },

  async getCurrent(req: Request, res: Response) {
    const business = await businessesService.getCurrent(getTenant(req));
    res.json({ data: withStoreUrl(business) });
  },

  async updateCurrent(req: Request, res: Response) {
    const business = await businessesService.updateCurrent(getTenant(req), req.body as UpdateBusinessInput);
    res.json({ data: withStoreUrl(business) });
  },

  /** Logo o portada: cuerpo binario de la imagen (ver middlewares/upload.ts). */
  setImage(kind: BusinessImage) {
    return async (req: Request, res: Response) => {
      const business = await businessesService.setImage(getTenant(req), kind, req.body as Buffer);
      res.json({ data: withStoreUrl(business) });
    };
  },

  removeImage(kind: BusinessImage) {
    return async (req: Request, res: Response) => {
      const business = await businessesService.removeImage(getTenant(req), kind);
      res.json({ data: withStoreUrl(business) });
    };
  },

  /**
   * Código QR del enlace de la tienda (para imprimir en el mostrador, mesas o volantes). Con `mesa`,
   * el de esa mesa (?mesa=4: la tienda abre para pedir y comer ahí); con `local`, el general del local.
   */
  async qr(req: Request, res: Response) {
    const { format, download, mesa, local } = req.query as unknown as QrQuery;
    const business = await businessesService.getCurrent(getTenant(req));
    const url = mesa ? `${storeUrl(business.slug)}?mesa=${encodeURIComponent(mesa)}` : local ? `${storeUrl(business.slug)}?local=1` : storeUrl(business.slug);
    const color = { dark: "#17161cff", light: "#ffffffff" };

    res.set("Cache-Control", "private, no-cache");
    if (download) res.attachment(`qr-${business.slug}${mesa ? `-mesa-${mesa.replace(/[^\w-]/g, "")}` : local ? "-local" : ""}.${format}`);
    if (format === "png") {
      res.type("png").send(await QRCode.toBuffer(url, { type: "png", width: 1024, margin: 2, errorCorrectionLevel: "M", color }));
    } else {
      res.type("svg").send(await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color }));
    }
  },

  async getSettings(req: Request, res: Response) {
    res.json({ data: await businessesService.getSettings(getTenant(req)) });
  },

  async updateSettings(req: Request, res: Response) {
    res.json({ data: await businessesService.updateSettings(getTenant(req), req.body as UpdateSettingsInput) });
  },

  async listMembers(req: Request, res: Response) {
    res.json({ data: await businessesService.listMembers(getTenant(req)) });
  },

  async addMember(req: Request, res: Response) {
    res.status(201).json({ data: await businessesService.addMember(getTenant(req), req.body as AddMemberInput) });
  },

  async updateMember(req: Request, res: Response) {
    const { membershipId } = req.params as MembershipParams;
    res.json({ data: await businessesService.updateMember(getTenant(req), membershipId, req.body as UpdateMemberInput) });
  },

  async removeMember(req: Request, res: Response) {
    const { membershipId } = req.params as MembershipParams;
    await businessesService.removeMember(getTenant(req), membershipId);
    res.status(204).end();
  },
};
