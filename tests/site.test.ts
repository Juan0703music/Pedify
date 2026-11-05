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

  it("el mapa del sitio tiene las páginas públicas y las tiendas activas (no las suspendidas)", async () => {
    const open = await registerMerchant({ businessName: "Café El Puente" });
    const closed = await registerMerchant({ businessName: "Tienda Cerrada" });
    await prisma.business.update({ where: { id: closed.businessId }, data: { status: "SUSPENDED" } });

    const xml = (await request(app).get("/sitemap.xml").expect(200).expect("Content-Type", /application\/xml/)).text;
    for (const path of ["/", "/registro", "/terminos", "/privacidad", "/tienda/cafe-el-puente"]) expect(xml).toContain(`<loc>${SITE}${path}</loc>`);
    expect(xml).toMatch(/<loc>[^<]+\/tienda\/cafe-el-puente<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    expect(xml).not.toContain("tienda-cerrada");
    expect(open.businessId).toBeTruthy();

    const robots = (await request(app).get("/robots.txt").expect(200)).text;
    expect(robots).toContain("Disallow: /admin");
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });
});
