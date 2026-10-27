import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { beforeEach, describe, expect, it } from "vitest";
import { newAgent, registerMerchant } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";
import { NEQUI_PAYLOAD } from "./helpers/receipts.js";

beforeEach(resetDatabase);

/** Negocio abierto todo el día con efectivo, Nequi (QR) y llave Bre-B, y una salchipapa de $15.000. */
async function restaurant() {
  const merchant = await registerMerchant();
  const { agent } = merchant;
  const week = Array.from({ length: 7 }, (_, day) => ({ day, closed: false, open: "00:00", close: "23:59" }));
  await agent
    .patch("/api/v1/businesses/current/settings")
    .send({ openingHours: week, paymentMethods: ["CASH", "NEQUI", "BRE_B"], deliveryFee: 4000, whatsappPhone: "300 123 4567" })
    .expect(200);
  const qr = await QRCode.toBuffer(NEQUI_PAYLOAD, { type: "png", width: 600, margin: 2 });
  await agent.post("/api/v1/businesses/current/payment-accounts/NEQUI/qr").set("Content-Type", "image/png").send(qr).expect(200);
  await agent.put("/api/v1/businesses/current/payment-accounts/BRE_B").send({ accountKey: "@sabores2024", holderName: "Sabores del Caribe" }).expect(200);
  const product = (await agent.post("/api/v1/products").send({ name: "Salchipapa", price: 15000 }).expect(201)).body.data as { id: string };
  const slug = (await agent.get("/api/v1/businesses/current")).body.data.slug as string;

  const order = (extra: Record<string, unknown>) =>
    newAgent()
      .post(`/api/v1/store/${slug}/orders`)
      .send({ idempotencyKey: randomUUID(), items: [{ productId: product.id, quantity: 1 }], name: "Laura Vergara", phone: "311 222 3344", ...extra });
  /** El cliente pide desde la mesa 4 (sin pagar todavía). */
  const orderAtTable = async (paymentMethod: string) => {
    const key = randomUUID();
    const res = await newAgent()
      .post(`/api/v1/store/${slug}/orders`)
      .send({ idempotencyKey: key, items: [{ productId: product.id, quantity: 1 }], name: "Laura Vergara", phone: "311 222 3344", paymentMethod, deliveryType: "DINE_IN", tableNumber: "4" })
      .expect(201);
    return { id: res.body.data.order.id as string, key, whatsapp: res.body.data.whatsapp as { message: string } | null };
  };
  const tracking = async (placed: { id: string; key: string }) =>
    (await newAgent().get(`/api/v1/store/${slug}/orders/${placed.id}`).set("X-Order-Key", placed.key).expect(200)).body.data;
  const serve = async (id: string) => {
    for (const status of ["PREPARING", "READY", "DELIVERED"]) await agent.patch(`/api/v1/orders/${id}/status`).send({ status }).expect(200);
  };
  const board = async () => ((await agent.get("/api/v1/orders").expect(200)).body.data.items as { id: string }[]).map((item) => item.id);
  return { ...merchant, slug, order, orderAtTable, tracking, serve, board };
}

describe("Pagar la cuenta de la mesa en el local", () => {
  it("en la mesa se pide sin pagar (efectivo, Nequi o llave Bre-B); a domicilio, la llave Bre-B se paga antes", async () => {
    const store = await restaurant();
    const payments = (await newAgent().get(`/api/v1/store/${store.slug}`).expect(200)).body.data.payments;
    expect(payments.prepay).toEqual({ NEQUI: ["NEQUI", "BRE_B"], BRE_B: ["BRE_B"] });

    for (const method of ["CASH", "NEQUI", "BRE_B"]) {
      const placed = await store.orderAtTable(method);
      expect(await store.tracking(placed)).toMatchObject({ deliveryType: "DINE_IN", tableNumber: "4", paymentMethod: method, paid: false, paymentProofSent: false });
    }
    // El mensaje de WhatsApp dice cómo va a pagar.
    expect((await store.orderAtTable("BRE_B")).whatsapp?.message).toContain("Pago: Llave Bre-B");

    const delivery = await store.order({ paymentMethod: "BRE_B", deliveryType: "DELIVERY", address: "Calle 23 #18-40" }).expect(400);
    expect(delivery.body.error.code).toBe("PAYMENT_PROOF_REQUIRED");
  });

  it("la mesa servida queda por cobrar hasta que el negocio toca «Cobrado»", async () => {
    const store = await restaurant();
    const placed = await store.orderAtTable("NEQUI");
    await store.serve(placed.id);
    expect(await store.board()).toContain(placed.id);
    expect(await store.tracking(placed)).toMatchObject({ status: "DELIVERED", paid: false });

    await store.agent.patch(`/api/v1/orders/${placed.id}/payment`).send({ paid: true }).expect(200);
    expect(await store.board()).not.toContain(placed.id);
    expect(await store.tracking(placed)).toMatchObject({ paid: true });
  });
});
