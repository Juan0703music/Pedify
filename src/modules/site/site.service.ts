import { prisma } from "../../config/database.js";
import { env, isStaging } from "../../config/env.js";
import { publicAppUrl } from "../../config/public-url.js";
import { escapeHtml } from "../../utils/html.js";
import { markEnvironment, readPage } from "../../utils/pages.js";
import { PLANS } from "../subscriptions/plans.js";

/**
 * Lo que leen Google y las redes en las páginas públicas: la portada con su dirección oficial
 * (canónica), la imagen para compartir, la descripción de Pedify como programa con los precios de los
 * planes (datos estructurados de schema.org) y la verificación de Search Console; el mapa del sitio con
 * las páginas públicas y las tiendas; y robots.txt, que deja fuera el panel y la API.
 */
const PUBLIC_PATHS = ["/", "/como-funciona", "/funciones", "/planes", "/app", "/registro", "/soporte", "/terminos", "/privacidad"];

/** Páginas públicas de Pedify con el menú compartido: dirección → [archivo, sección del menú]. */
export const SITE_PAGES: Record<string, [file: string, nav: string]> = {
  "/": ["index.html", "inicio"],
  "/como-funciona": ["pages/site/how.html", "como-funciona"],
  "/funciones": ["pages/site/features.html", "funciones"],
  "/planes": ["pages/site/plans.html", "planes"],
  "/app": ["pages/app/index.html", "app"],
};
/** Límite de direcciones de un mapa del sitio (protocolo sitemaps.org). */
const SITEMAP_LIMIT = 50_000;

const escapeXml = (value: string) => value.replace(/[<>&'"]/g, (char) => `&#${char.charCodeAt(0)};`);

/** Descripción de Pedify y de sus planes para los buscadores (JSON-LD). */
function structuredData(site: string) {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${site}/#pedify`, name: "Pedify", url: `${site}/`, logo: `${site}/assets/icons/icon-512.png` },
      {
        "@type": "SoftwareApplication",
        name: "Pedify",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web, Android, iOS, Windows, macOS",
        inLanguage: "es-CO",
        url: `${site}/`,
        image: `${site}/assets/images/og-pedify.jpg`,
        description:
          "Tienda en línea, menú digital con QR y panel de pedidos para negocios de comida rápida en Colombia. Sin comisión por pedido: un plan fijo al mes.",
        publisher: { "@id": `${site}/#pedify` },
        offers: Object.values(PLANS).map((plan) => ({
          "@type": "Offer",
          name: `Plan ${plan.name}`,
          price: plan.priceMonthly,
          priceCurrency: "COP",
          url: `${site}/registro?plan=${plan.code}`,
        })),
      },
    ],
  };
  // Dentro de <script>: «<» escapado para que ningún texto cierre la etiqueta.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export const siteService = {
  /**
   * Una página pública con el menú (la sección abierta marcada), el cierre y el pie compartidos
   * (public/partials), la dirección pública y, en la portada, los datos estructurados y la
   * verificación de Google.
   */
  async page(file: string, nav: string): Promise<string> {
    const site = publicAppUrl();
    const [html, header, cta, footer] = await Promise.all([
      readPage(file),
      readPage("partials/site-header.html"),
      readPage("partials/site-cta.html"),
      readPage("partials/site-footer.html"),
    ]);
    const filled = html
      .replace("{{site.header}}", header.replaceAll(`data-nav="${nav}"`, `data-nav="${nav}" aria-current="page"`))
      .replace("{{site.cta}}", cta)
      .replace("{{site.footer}}", footer)
      .replaceAll("{{site.url}}", escapeHtml(site))
      .replace("{{site.jsonld}}", structuredData(site))
      .replace(
        "{{site.verification}}",
        env.GOOGLE_SITE_VERIFICATION ? `<meta name="google-site-verification" content="${escapeHtml(env.GOOGLE_SITE_VERIFICATION)}" />` : "",
      );
    return markEnvironment(filled);
  },

  /** Mapa del sitio: las páginas públicas y la tienda de cada negocio activo. */
  async sitemap(): Promise<string> {
    const site = publicAppUrl();
    const stores = await prisma.business.findMany({
      where: { status: "ACTIVE", settings: { isNot: null } },
      select: { slug: true, updatedAt: true },
      orderBy: { createdAt: "asc" },
      take: SITEMAP_LIMIT - PUBLIC_PATHS.length,
    });
    const urls = [
      ...PUBLIC_PATHS.map((path) => `  <url><loc>${escapeXml(`${site}${path}`)}</loc></url>`),
      ...stores.map(
        (store) => `  <url><loc>${escapeXml(`${site}/tienda/${store.slug}`)}</loc><lastmod>${store.updatedAt.toISOString().slice(0, 10)}</lastmod></url>`,
      ),
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  },

  /** robots.txt: en pruebas no se indexa nada; en producción, todo menos el panel y la API, con el mapa del sitio. */
  robots(): string {
    if (isStaging) return "User-agent: *\nDisallow: /\n";
    return ["User-agent: *", "Disallow: /panel", "Disallow: /admin", "Disallow: /api/", "Disallow: /restablecer", "", `Sitemap: ${publicAppUrl()}/sitemap.xml`, ""].join("\n");
  },
};
