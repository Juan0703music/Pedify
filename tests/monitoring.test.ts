import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./helpers/app.js";

describe("Monitoreo", () => {
  it("cada respuesta lleva un identificador de petición (y respeta uno válido que venga del proxy)", async () => {
    const generated = await request(app).get("/api/v1/health").expect(200);
    expect(generated.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    const forwarded = await request(app).get("/api/v1/health").set("X-Request-Id", "proxy-12345678").expect(200);
    expect(forwarded.headers["x-request-id"]).toBe("proxy-12345678");
    const unsafe = await request(app).get("/api/v1/health").set("X-Request-Id", "<script>").expect(200);
    expect(unsafe.headers["x-request-id"]).not.toBe("<script>");
  });

  it("la salud informa la base de datos, la versión y el tiempo en línea", async () => {
    const res = await request(app).get("/api/v1/health").expect(200);
    expect(res.body.data).toMatchObject({
      status: "ok",
      version: expect.any(String),
      environment: "test",
      database: { status: "ok", latencyMs: expect.any(Number) },
    });
  });

  it("en producción robots.txt deja indexar las tiendas pero no el panel, y no hay franja de pruebas", async () => {
    const robots = await request(app).get("/robots.txt").expect(200);
    expect(robots.text).toContain("Disallow: /panel");
    expect(robots.text).toContain("Disallow: /api/");
    expect(robots.text).not.toMatch(/^Disallow: \/$/m);
    const landing = await request(app).get("/").expect(200);
    expect(landing.headers["x-robots-tag"]).toBeUndefined();
    expect(landing.text).not.toContain("staging-flag");
    expect(landing.text).not.toContain("[Pruebas]");
  });

  it("las métricas Prometheus exigen el token", async () => {
    await request(app).get("/metrics").expect(401);
    await request(app).get("/metrics").set("Authorization", "Bearer token-equivocado-de-prueba").expect(401);
    const res = await request(app).get("/metrics").set("Authorization", "Bearer token-de-metricas-de-prueba").expect(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain('pedifyai_http_requests_total{method="GET",route="/api/v1/health",status="200"}');
    expect(res.text).toContain("pedifyai_orders_created_total");
  });

  it("recibe los errores de JavaScript de los navegadores y valida el reporte", async () => {
    const report = { message: "TypeError: x is not a function", source: "https://pedify.co/js/cart.js", line: 12, column: 4, page: "/tienda/sabores" };
    await request(app).post("/api/v1/client-errors").send(report).expect(204);
    await request(app).post("/api/v1/client-errors").send({ ...report, message: "" }).expect(400);
    await request(app).post("/api/v1/client-errors").send({ ...report, message: "x".repeat(501) }).expect(400);
    // Todas las páginas cargan el reporte antes que sus módulos.
    const store = await request(app).get("/").expect(200);
    expect(store.text.indexOf("/js/error-report.js")).toBeGreaterThan(-1);
    expect(store.text.indexOf("/js/error-report.js")).toBeLessThan(store.text.indexOf('type="module"'));
  });
});
