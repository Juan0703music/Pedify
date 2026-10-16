import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { app, login, newAgent, PASSWORD, registerMerchant, sessionCookieFrom, uniqueEmail } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";
import request from "supertest";

beforeEach(resetDatabase);

describe("Registro de comerciante", () => {
  it("crea la cuenta, el negocio con su slug, la membresía de propietario y la configuración inicial", async () => {
    const { profile, businessId } = await registerMerchant({ businessName: "Sabores del Caribe" });

    expect(profile.user).toMatchObject({ name: "Ana Pérez" });
    expect(profile.businesses).toEqual([
      expect.objectContaining({ id: businessId, name: "Sabores del Caribe", slug: "sabores-del-caribe", role: "OWNER" }),
    ]);

    const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { businessId } });
    expect(settings.whatsappPhone).toBe("573001234567");
    expect(settings.openingHours).toHaveLength(7);
    expect(settings.paymentMethods).toEqual(["CASH"]);
  });

  it("entrega una cookie de sesión httpOnly y SameSite=Lax", async () => {
    const res = await newAgent()
      .post("/api/v1/auth/register")
      .send({
        name: "Luis",
        email: uniqueEmail(),
        password: PASSWORD,
        businessName: "Pizzería Napoli",
        businessPhone: "3109876543",
        acceptPrivacy: true,
      })
      .expect(201);

    const cookie = ([] as string[]).concat(res.headers["set-cookie"] ?? []).join(";");
    expect(cookie).toMatch(/pedify_sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("guarda la contraseña con Argon2id y nunca la devuelve", async () => {
    const { profile, input } = await registerMerchant();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: profile.user.id } });

    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(input.password);
    expect(JSON.stringify(profile)).not.toContain("passwordHash");
  });

  it("normaliza el correo y no permite registrarlo dos veces", async () => {
    await registerMerchant({ email: "Ana@Ejemplo.com" });
    const res = await newAgent()
      .post("/api/v1/auth/register")
      .send({ name: "Otra", email: "ana@ejemplo.com", password: PASSWORD, businessName: "Otro", businessPhone: "3001112233", acceptPrivacy: true })
      .expect(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("valida los datos y devuelve los errores por campo", async () => {
    const res = await newAgent()
      .post("/api/v1/auth/register")
      .send({ name: "A", email: "no-es-correo", password: "corta", businessName: "", businessPhone: "123" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(res.body.error.fields)).toEqual(
      expect.arrayContaining(["name", "email", "password", "businessName", "businessPhone", "acceptPrivacy"]),
    );
  });

  it("registra la autorización de tratamiento de datos (Ley 1581)", async () => {
    const { profile } = await registerMerchant();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: profile.user.id } });
    expect(user.privacyAcceptedAt).toBeInstanceOf(Date);
  });

  it("genera slugs únicos para negocios con el mismo nombre", async () => {
    const first = await registerMerchant({ businessName: "Salchipapas Don José" });
    const second = await registerMerchant({ businessName: "Salchipapas Don José" });

    expect(first.profile.businesses[0]?.slug).toBe("salchipapas-don-jose");
    expect(second.profile.businesses[0]?.slug).toBe("salchipapas-don-jose-2");
  });
});

describe("Inicio de sesión", () => {
  it("responde el mismo error para contraseña incorrecta y correo inexistente", async () => {
    const { input } = await registerMerchant();

    const wrongPassword = await newAgent().post("/api/v1/auth/login").send({ email: input.email, password: "otra-clave" });
    const unknownEmail = await newAgent().post("/api/v1/auth/login").send({ email: "nadie@ejemplo.com", password: PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("inicia sesión y deja activo el negocio del comerciante", async () => {
    const { input, businessId } = await registerMerchant();
    const agent = await login(input.email.toUpperCase());

    const me = await agent.get("/api/v1/auth/me").expect(200);
    expect(me.body.data.user.email).toBe(input.email);
    expect(me.body.data.activeBusinessId).toBe(businessId);
  });
});

describe("Sesiones", () => {
  it("rechaza las rutas protegidas sin sesión", async () => {
    await request(app).get("/api/v1/auth/me").expect(401);
    await request(app).get("/api/v1/businesses/current").expect(401);
  });

  it("guarda en la base solo el hash SHA-256 del token", async () => {
    const res = await newAgent()
      .post("/api/v1/auth/register")
      .send({ name: "Eva", email: uniqueEmail(), password: PASSWORD, businessName: "Repostería Eva", businessPhone: "3201234567", acceptPrivacy: true })
      .expect(201);
    const token = sessionCookieFrom(res);
    expect(token).toBeTruthy();

    const sessions = await prisma.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tokenHash).not.toBe(token);
    expect(sessions[0]?.tokenHash).toBe(createHash("sha256").update(token!).digest("hex"));
  });

  it("al cerrar sesión el token queda revocado aunque se reutilice", async () => {
    const res = await newAgent()
      .post("/api/v1/auth/register")
      .send({ name: "Eva", email: uniqueEmail(), password: PASSWORD, businessName: "Repostería Eva", businessPhone: "3201234567", acceptPrivacy: true });
    const token = sessionCookieFrom(res)!;
    const cookie = `pedify_sid=${token}`;

    await request(app).get("/api/v1/auth/me").set("Cookie", cookie).expect(200);
    await request(app).post("/api/v1/auth/logout").set("Cookie", cookie).expect(204);
    await request(app).get("/api/v1/auth/me").set("Cookie", cookie).expect(401);
  });

  it("cerrar sesión en todos los dispositivos revoca las demás sesiones", async () => {
    const { agent: laptop, input } = await registerMerchant();
    const phone = await login(input.email);

    await phone.get("/api/v1/auth/me").expect(200);
    await laptop.post("/api/v1/auth/logout-all").expect(204);
    await phone.get("/api/v1/auth/me").expect(401);
    await laptop.get("/api/v1/auth/me").expect(401);
  });

  it("una sesión vencida no da acceso", async () => {
    const { agent } = await registerMerchant();
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await agent.get("/api/v1/auth/me").expect(401);
    expect(res.body.error.code).toBe("SESSION_EXPIRED");
  });

  it("cambiar la contraseña cierra las otras sesiones y la anterior deja de funcionar", async () => {
    const { agent, input } = await registerMerchant();
    const otherDevice = await login(input.email);

    await agent
      .patch("/api/v1/auth/password")
      .send({ currentPassword: "incorrecta", newPassword: "nueva-clave-456" })
      .expect(403);
    await agent
      .patch("/api/v1/auth/password")
      .send({ currentPassword: PASSWORD, newPassword: "nueva-clave-456" })
      .expect(200);

    await agent.get("/api/v1/auth/me").expect(200);
    await otherDevice.get("/api/v1/auth/me").expect(401);
    await newAgent().post("/api/v1/auth/login").send({ email: input.email, password: PASSWORD }).expect(401);
    await login(input.email, "nueva-clave-456");
  });

  it("permite actualizar el nombre del perfil", async () => {
    const { agent } = await registerMerchant();
    const res = await agent.patch("/api/v1/auth/me").send({ name: "Ana María Pérez" }).expect(200);
    expect(res.body.data.user.name).toBe("Ana María Pérez");
  });
});

describe("Protección contra peticiones de otros sitios (CSRF)", () => {
  it("rechaza peticiones que modifican datos desde otro origen", async () => {
    const { agent } = await registerMerchant();
    const res = await agent.post("/api/v1/auth/logout").set("Origin", "https://sitio-malicioso.com").expect(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    await agent.get("/api/v1/auth/me").expect(200);
  });

  it("rechaza peticiones marcadas por el navegador como cross-site", async () => {
    const { agent } = await registerMerchant();
    await agent.patch("/api/v1/auth/me").set("Sec-Fetch-Site", "cross-site").send({ name: "Hackeado" }).expect(403);
  });

  it("acepta el origen de la propia aplicación", async () => {
    const { input } = await registerMerchant();
    await newAgent()
      .post("/api/v1/auth/login")
      .set("Origin", "http://localhost:3000")
      .send({ email: input.email, password: PASSWORD })
      .expect(200);
  });
});

describe("API", () => {
  it("responde el estado de salud con la base de datos", async () => {
    const res = await request(app).get("/api/v1/health").expect(200);
    expect(res.body.data.status).toBe("ok");
  });

  it("responde 404 en JSON para rutas inexistentes", async () => {
    const res = await request(app).get("/api/v1/no-existe").expect(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("responde 400 cuando el JSON está mal formado", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send("{malo")
      .expect(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it("envía cabeceras de seguridad (Helmet)", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
