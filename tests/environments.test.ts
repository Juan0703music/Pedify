import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

// La app de este archivo arranca como entorno de pruebas (APP_ENV=staging): la variable se define
// antes de importar la configuración (por eso los imports son dinámicos).
process.env.APP_ENV = "staging";
const { env } = await import("../src/config/env.js");
const { productionWarnings } = await import("../src/config/readiness.js");
const { app, newAgent, registerMerchant } = await import("./helpers/app.js");
const { mailer } = await import("../src/services/mail.service.js");
const { resetDatabase } = await import("./helpers/db.js");
// La configuración ya se leyó: no dejar la variable para los demás archivos de pruebas.
delete process.env.APP_ENV;

beforeEach(async () => {
  await resetDatabase();
  mailer.outbox.length = 0;
});

describe("Entorno de pruebas (APP_ENV=staging)", () => {
  it("los buscadores no lo indexan", async () => {
    const robots = await request(app).get("/robots.txt").expect(200);
    expect(robots.text).toBe("User-agent: *\nDisallow: /\n");
    for (const path of ["/", "/api/v1/health", "/css/app.css"]) {
      const res = await request(app).get(path);
      expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    }
  });

  it("cada página lo dice en el título y con una franja visible", async () => {
    for (const path of ["/", "/login", "/privacidad", "/no-existe"]) {
      const res = await request(app).get(path);
      expect(res.text).toMatch(/<title>\[Pruebas\] /);
      expect(res.text).toContain('<div class="staging-flag" role="note">Entorno de pruebas</div>');
    }
    const panel = await request(app).get("/panel").set("Cookie", "pedify_sid=cualquiera").expect(200);
    expect(panel.headers["cache-control"]).toBe("no-store");
    expect(panel.text).toContain("staging-flag");
  });

  it("también la tienda pública, después de poner el nombre del negocio", async () => {
    await registerMerchant();
    const res = await request(app).get("/tienda/sabores-del-caribe").expect(200);
    expect(res.text).toContain("<title>[Pruebas] Sabores del Caribe · Menú</title>");
    expect(res.text).toContain("staging-flag");
  });

  it("los correos llevan [Pruebas] en el asunto", async () => {
    const { input } = await registerMerchant();
    await newAgent().post("/api/v1/auth/forgot-password").send({ email: input.email }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mailer.outbox[0]?.subject).toBe("[Pruebas] Restablece tu contraseña de PedifyAI");
  });
});

describe("Configuración pendiente para producción", () => {
  const complete = {
    ...env,
    APP_URL: "https://pedifyai.com",
    COOKIE_SECURE: true,
    TRUST_PROXY: 1,
    STORAGE_DRIVER: "s3" as const,
    SMTP_URL: "smtps://usuario:clave@smtp.ejemplo.com:465",
    SUPPORT_WHATSAPP: "573001234567",
    METRICS_TOKEN: "token-de-metricas-largo",
  };

  it("no avisa nada con todo configurado", () => {
    expect(productionWarnings(complete)).toEqual([]);
  });

  it("avisa cada cosa que falta", () => {
    const warnings = productionWarnings({
      ...complete,
      APP_URL: "http://pedifyai.com",
      COOKIE_SECURE: false,
      STORAGE_DRIVER: "local",
      SMTP_URL: undefined,
      SUPPORT_WHATSAPP: undefined,
      METRICS_TOKEN: undefined,
    });
    expect(warnings).toHaveLength(6);
    expect(warnings.join(" ")).toContain("HTTPS");
    expect(warnings.join(" ")).toContain("SMTP_URL");
  });

  it("detecta el proxy sin TRUST_PROXY (todos compartirían el límite de solicitudes)", () => {
    expect(productionWarnings({ ...complete, TRUST_PROXY: 0 })).toEqual([expect.stringContaining("TRUST_PROXY=1")]);
  });
});
