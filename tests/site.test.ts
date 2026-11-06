import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { PLANS } from "../src/modules/subscriptions/plans.js";
import { app, registerMerchant } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(resetDatabase);

const SITE = new URL(process.env.APP_URL!).origin;

describe("Lo que leen Google y las redes", () => {
  it("la portada tiene su dirección oficial, la imagen para compartir y los planes con sus precios", async () => {
    const html = (await request(app).get("/").expect(200)).text;
    expect(html).not.toContain("{{");
    expect(html).toContain(`<link rel="canonical" href="${SITE}/" />`);
    expect(html).toContain(`<meta property="og:image" content="${SITE}/assets/images/og-pedify.jpg" />`);
    expect(html).not.toContain("google-site-verification");
    expect(html).not.toContain("Daviplata o transferencia.");

    const data = JSON.parse(/<script type="application\/ld\+json">(.+?)<\/script>/.exec(html)![1]!) as {
      "@graph": { "@type": string; offers?: { name: string; price: number; priceCurrency: string }[] }[];
    };
    const software = data["@graph"].find((node) => node["@type"] === "SoftwareApplication")!;
    expect(software.offers).toEqual(
      Object.values(PLANS).map((plan) => expect.objectContaining({ name: `Plan ${plan.name}`, price: plan.priceMonthly, priceCurrency: "COP" })),
    );
    await request(app).get("/index.html").expect(301).expect("Location", "/");
    await request(app).get("/assets/images/og-pedify.jpg").expect(200).expect("Content-Type", "image/jpeg");
  });

  it("cada sección es su propia página, con el mismo menú (la abierta, marcada), el cierre y el pie", async () => {
    const pages: [string, string, string][] = [
      ["/", "inicio", "Tu tienda en"],
      ["/como-funciona", "como-funciona", "Del"],
      ["/funciones", "funciones", "abre el apetito"],
      ["/planes", "planes", "Planes claros"],
      ["/app", "app", "Pedify en tu celular"],
    ];
    for (const [path, nav, heading] of pages) {
      const html = (await request(app).get(path).expect(200)).text;
      expect(html, path).not.toContain("{{");
      expect(html, path).toContain(`<link rel="canonical" href="${SITE}${path}" />`);
      // Marcada en el menú del computador y en el del celular; ninguna otra.
      expect(html.match(/aria-current="page"/g), path).toHaveLength(2);
      expect(html, path).toContain(`data-nav="${nav}" aria-current="page"`);
      expect(html, path).toMatch(new RegExp(`<h1[^>]*>[\\s\\S]*?${heading}`));
      // La app tiene su propio cierre («Crear mi tienda gratis»); las demás, el compartido.
      if (path !== "/app") expect(html, path).toContain("Abre tu tienda");
      expect(html, path).toContain('href="/soporte"');
      expect(html, path).not.toContain('href="#planes"');
    }
    // Los planes ya no están en la portada: tienen su página.
    expect((await request(app).get("/").expect(200)).text).not.toContain('id="planes"');
  });

  it("el mapa del sitio tiene las páginas públicas y las tiendas activas (no las suspendidas)", async () => {
    const open = await registerMerchant({ businessName: "Café El Puente" });
    const closed = await registerMerchant({ businessName: "Tienda Cerrada" });
    await prisma.business.update({ where: { id: closed.businessId }, data: { status: "SUSPENDED" } });

    const xml = (await request(app).get("/sitemap.xml").expect(200).expect("Content-Type", /application\/xml/)).text;
    for (const path of ["/", "/como-funciona", "/funciones", "/planes", "/app", "/registro", "/soporte", "/terminos", "/privacidad", "/tienda/cafe-el-puente"]) {
      expect(xml).toContain(`<loc>${SITE}${path}</loc>`);
    }
    expect(xml).toMatch(/<loc>[^<]+\/tienda\/cafe-el-puente<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    expect(xml).not.toContain("tienda-cerrada");
    expect(open.businessId).toBeTruthy();

    const robots = (await request(app).get("/robots.txt").expect(200)).text;
    expect(robots).toContain("Disallow: /admin");
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });
});
