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
    expect(res.body.data).toMatchObject({ status: "ok", version: expect.any(String), database: { status: "ok", latencyMs: expect.any(Number) } });
  });

  it("las métricas Prometheus exigen el token", async () => {
    await request(app).get("/metrics").expect(401);
    await request(app).get("/metrics").set("Authorization", "Bearer token-equivocado-de-prueba").expect(401);
    const res = await request(app).get("/metrics").set("Authorization", "Bearer token-de-metricas-de-prueba").expect(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain('pedifyai_http_requests_total{method="GET",route="/api/v1/health",status="200"}');
    expect(res.text).toContain("pedifyai_orders_created_total");
  });
});
