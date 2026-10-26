import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readQr } from "../src/modules/payment-accounts/payment-accounts.service.js";
import { clock } from "../src/utils/clock.js";
import { newAgent, registerMerchant } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

/** Martes 7:00 p. m. en Colombia: dentro del horario por defecto (11:00–22:00). */
const TUESDAY_EVENING = new Date("2026-10-13T19:00:00-05:00");

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(clock, "now").mockReturnValue(TUESDAY_EVENING);
});

afterEach(() => vi.restoreAllMocks());

async function setupStore() {
  const merchant = await registerMerchant();
  const { agent } = merchant;
  // Domicilio de $4.000 y pedido mínimo de $20.000 (en la mesa no aplican).
  await agent.patch("/api/v1/businesses/current/settings").send({ deliveryFee: 4000, minimumOrder: 20000 }).expect(200);
  const product = (await agent.post("/api/v1/products").send({ name: "Salchipapa", price: 15000 }).expect(201)).body.data as { id: string };
  const business = (await agent.get("/api/v1/businesses/current")).body.data as { slug: string; storeUrl: string };
  const order = (extra: Record<string, unknown>) =>
    newAgent()
      .post(`/api/v1/store/${business.slug}/orders`)
      .send({ idempotencyKey: randomUUID(), items: [{ productId: product.id, quantity: 1 }], name: "Laura Vergara", phone: "311 222 3344", paymentMethod: "CASH", ...extra });
  return { ...merchant, ...business, order };
}

describe("Pedidos desde la mesa (comer en el local)", () => {
  it("el cliente pide desde su mesa: sin domicilio ni pedido mínimo, y el negocio ve la mesa", async () => {
    const { agent, slug, order } = await setupStore();
    expect((await newAgent().get(`/api/v1/store/${slug}`).expect(200)).body.data.settings.dineInEnabled).toBe(true);

    const res = await order({ deliveryType: "DINE_IN", tableNumber: " 4 ", address: "Calle falsa 123" }).expect(201);
    expect(res.body.data.order).toMatchObject({ deliveryType: "DINE_IN", tableNumber: "4", deliveryAddress: null, deliveryFee: 0, total: 15000 });

    // Para domicilio sí aplican el valor del domicilio y el pedido mínimo.
    expect((await order({ deliveryType: "DELIVERY", address: "Calle 20 #15-30" }).expect(400)).body.error.code).toBe("MINIMUM_ORDER");

    const id = res.body.data.order.id as string;
    const detail = (await agent.get(`/api/v1/orders/${id}`).expect(200)).body.data;
    expect(detail).toMatchObject({ deliveryType: "DINE_IN", tableNumber: "4" });
    // Se atiende como para recoger: listo → servido, sin domiciliario.
    await agent.patch(`/api/v1/orders/${id}/status`).send({ status: "PREPARING" }).expect(200);
    await agent.patch(`/api/v1/orders/${id}/status`).send({ status: "READY" }).expect(200);
    expect((await agent.post(`/api/v1/orders/${id}/courier-link`).expect(409)).body.error.code).toBe("NOT_DELIVERY");
    expect((await agent.patch(`/api/v1/orders/${id}/status`).send({ status: "OUT_FOR_DELIVERY" }).expect(400)).body.error.code).toBe("INVALID_TRANSITION");
    await agent.patch(`/api/v1/orders/${id}/status`).send({ status: "DELIVERED" }).expect(200);

    // Las analíticas de hoy usan la fecha real del pedido (la base de datos la pone al crearlo).
    vi.restoreAllMocks();
    const summary = (await agent.get("/api/v1/analytics/summary").expect(200)).body.data;
    expect(summary.delivery).toEqual({ delivery: 0, pickup: 0, dineIn: 1 });
  });

  it("sin mesa también se puede (QR general del local) y el negocio puede apagarlo", async () => {
    const { agent, order } = await setupStore();
    const res = await order({ deliveryType: "DINE_IN" }).expect(201);
    expect(res.body.data.order).toMatchObject({ deliveryType: "DINE_IN", tableNumber: null });
    // El mensaje de WhatsApp dice que es para comer en el local.
    expect(res.body.data.whatsapp?.message ?? "").not.toContain("Domicilio:");

    await agent.patch("/api/v1/businesses/current/settings").send({ dineInEnabled: false }).expect(200);
    const off = await order({ deliveryType: "DINE_IN", tableNumber: "2" }).expect(400);
    expect(off.body.error).toMatchObject({ code: "DINE_IN_UNAVAILABLE", message: "Este negocio no recibe pedidos para comer en el local." });
  });

  it("el QR de cada mesa abre la tienda con la mesa; el general, con «local»", async () => {
    const { agent, storeUrl } = await setupStore();
    const qrOf = async (query: string) => readQr((await agent.get(`/api/v1/businesses/current/qr?format=png&${query}`).buffer(true).expect(200)).body as Buffer);
    expect(await qrOf("mesa=4")).toBe(`${storeUrl}?mesa=4`);
    expect(await qrOf("mesa=Terraza%202")).toBe(`${storeUrl}?mesa=Terraza%202`);
    expect(await qrOf("local=1")).toBe(`${storeUrl}?local=1`);
    expect(await qrOf("")).toBe(storeUrl);
    const download = await agent.get("/api/v1/businesses/current/qr?format=png&mesa=4&download=1").expect(200);
    expect(download.headers["content-disposition"]).toContain("-mesa-4.png");
  });
});
