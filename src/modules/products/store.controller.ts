import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env.js";
import { escapeHtml } from "../../utils/html.js";
import { markEnvironment, readPage } from "../../utils/pages.js";
import { storeUrl } from "../businesses/businesses.controller.js";
import type { StoreParams } from "./store.routes.js";
import { storeService } from "./store.service.js";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const storeController = {
  /** GET /api/v1/store/:slug — catálogo público. Caché corta: un producto agotado se refleja en segundos. */
  async show(req: Request, res: Response) {
    const { slug } = req.params as StoreParams;
    res.set("Cache-Control", "public, max-age=15");
    res.json({ data: await storeService.getStore(slug) });
  },

  /**
   * GET /tienda/:slug — página de la tienda. Inserta el nombre, la descripción y la imagen del negocio
   * en las etiquetas Open Graph para que el enlace se vea bien al compartirlo por WhatsApp o Facebook.
   */
  async page(req: Request, res: Response, next: NextFunction) {
    const slug = String(req.params.slug ?? "");
    const normalized = slug.toLowerCase();
    if (slug !== normalized) return res.redirect(301, `/tienda/${encodeURIComponent(normalized)}`);
    if (slug.length > 60 || !SLUG_PATTERN.test(slug)) return next();

    const business = await storeService.findForPage(slug);
    if (!business) return next();

    const description =
      business.description ?? `Mira el menú de ${business.name}${business.city ? ` en ${business.city}` : ""} y pide en línea.`;
    const image = business.bannerUrl ?? business.logoUrl;
    const url = storeUrl(slug);
    const meta = [
      `<meta name="description" content="${escapeHtml(description)}" />`,
      `<link rel="canonical" href="${escapeHtml(url)}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="PedifyAI" />`,
      `<meta property="og:locale" content="es_CO" />`,
      `<meta property="og:title" content="${escapeHtml(business.name)}" />`,
      `<meta property="og:description" content="${escapeHtml(description)}" />`,
      `<meta property="og:url" content="${escapeHtml(url)}" />`,
      image ? `<meta property="og:image" content="${escapeHtml(new URL(image, env.APP_URL).toString())}" />` : "",
      `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`,
    ]
      .filter(Boolean)
      .join("\n    ");

    const html = (await readPage("pages/store/index.html"))
      .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(`${business.name} · Menú`)}</title>`)
      .replace("<!--store-meta-->", meta);

    res.set("Cache-Control", "public, max-age=60");
    res.type("html").send(markEnvironment(html));
  },
};
