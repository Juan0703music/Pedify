import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { app, newAgent, PASSWORD, registerMerchant, uniqueEmail } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(resetDatabase);

async function admin() {
  const merchant = await registerMerchant({ businessName: "Pedify Soporte" });
  await prisma.user.update({ where: { id: merchant.profile.user.id }, data: { isPlatformAdmin: true } });
  return merchant;
}

const LEGAL = { legalName: "Ana <Pérez> SAS", idType: "NIT", idNumber: "900123456-7", address: "Calle 20 #15-30", city: "Sincelejo, Sucre", email: "Datos@Pedify.co" };

describe("Política de datos y Términos y condiciones con los datos de Pedify", () => {
  it("mientras no se llenen, las páginas dicen «pendiente»; el administrador los llena y aparecen", async () => {
    for (const page of ["/privacidad", "/terminos"]) {
      const html = (await request(app).get(page).expect(200)).text;
      expect(html).toContain('<span class="legal-pending">[pendiente]</span>');
      expect(html).toContain("Faltan los datos de Pedify");
      expect(html).not.toContain("{{legal.");
    }

    const merchant = await registerMerchant();
    await merchant.agent.put("/api/v1/admin/legal").send(LEGAL).expect(403);
    const { agent } = await admin();
    expect((await agent.get("/api/v1/admin/legal").expect(200)).body.data).toBeNull();
    const invalid = await agent.put("/api/v1/admin/legal").send({ ...LEGAL, idNumber: "12 34 ✗", email: "no" }).expect(400);
    expect(Object.keys(invalid.body.error.fields)).toEqual(expect.arrayContaining(["idNumber", "email"]));

    const saved = (await agent.put("/api/v1/admin/legal").send({ ...LEGAL, phone: "300 123 4567" }).expect(200)).body.data;
    expect(saved).toMatchObject({ legalName: "Ana <Pérez> SAS", idType: "NIT", idNumber: "900123456-7", email: "datos@pedify.co", phone: "573001234567" });

    const privacy = (await request(app).get("/privacidad").expect(200)).text;
    expect(privacy).toContain("<strong>Ana &lt;Pérez&gt; SAS</strong>, NIT 900123456-7, con domicilio en Calle 20 #15-30, Sincelejo, Sucre");
    expect(privacy).toContain('<a href="mailto:datos@pedify.co">datos@pedify.co</a>');
    expect(privacy).not.toContain("pendiente");
    expect(privacy).not.toContain("Faltan los datos de Pedify");
    const terms = (await request(app).get("/terminos").expect(200)).text;
    expect(terms).toContain("Pedify es un servicio de <strong>Ana &lt;Pérez&gt; SAS</strong>, NIT 900123456-7");
    expect(terms).toContain("no\n            vende los productos ni es parte de la compraventa");
  });
});

describe("Registro: Términos y condiciones y documento de quien vende", () => {
  const base = { name: "Luis Gómez", email: "", password: PASSWORD, businessName: "Pizzería Napoli", businessPhone: "3109876543", acceptPrivacy: true };

  it("exige aceptar los términos y dar la cédula o el NIT; guarda la fecha de aceptación", async () => {
    const missing = await newAgent().post("/api/v1/auth/register").send({ ...base, email: uniqueEmail() }).expect(400);
    expect(Object.keys(missing.body.error.fields)).toEqual(expect.arrayContaining(["acceptTerms", "idType", "idNumber"]));

    const res = await newAgent()
      .post("/api/v1/auth/register")
      .send({ ...base, email: uniqueEmail(), acceptTerms: true, idType: "CC", idNumber: " 1102 345 678 " })
      .expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: res.body.data.user.id } });
    expect(user.termsAcceptedAt).toBeInstanceOf(Date);
    const business = await prisma.business.findUniqueOrThrow({ where: { id: res.body.data.activeBusinessId } });
    // Con cédula vende la persona; con NIT, el negocio (la razón social se ajusta en Configuración).
    expect(business).toMatchObject({ legalName: "Luis Gómez", idType: "CC", idNumber: "1102345678" });

    const company = await newAgent()
      .post("/api/v1/auth/register")
      .send({ ...base, email: uniqueEmail(), acceptTerms: true, idType: "NIT", idNumber: "900123456-7" })
      .expect(201);
    expect(await prisma.business.findUniqueOrThrow({ where: { id: company.body.data.activeBusinessId } })).toMatchObject({ legalName: "Pizzería Napoli", idType: "NIT" });
  });

  it("el negocio edita quién vende y su correo, y la tienda los muestra", async () => {
    const { agent } = await registerMerchant({ businessName: "Café El Puente" });
    await agent.patch("/api/v1/businesses/current").send({ contactEmail: "no-es-correo" }).expect(400);
    const updated = (
      await agent
        .patch("/api/v1/businesses/current")
        .send({ legalName: "Café El Puente S.A.S.", idType: "NIT", idNumber: "901234567-1", contactEmail: "Hola@CafeElPuente.co" })
        .expect(200)
    ).body.data;
    expect(updated).toMatchObject({ legalName: "Café El Puente S.A.S.", idType: "NIT", idNumber: "901234567-1", contactEmail: "hola@cafeelpuente.co" });

    const slug = updated.slug as string;
    const store = (await newAgent().get(`/api/v1/store/${slug}`).expect(200)).body.data;
    expect(store.business.seller).toEqual({ legalName: "Café El Puente S.A.S.", idType: "NIT", idNumber: "901234567-1", email: "hola@cafeelpuente.co" });

    // Vacíos se borran.
    await agent.patch("/api/v1/businesses/current").send({ contactEmail: "", idType: "", idNumber: "" }).expect(200);
    expect((await newAgent().get(`/api/v1/store/${slug}`).expect(200)).body.data.business.seller).toMatchObject({ idType: null, idNumber: null, email: null });
  });
});
