import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { receiptReader } from "../src/services/receipt-reader.service.js";
import { newAgent, registerMerchant } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";
import { NEQUI_PAYLOAD, nequiReceipt } from "./helpers/receipts.js";

beforeEach(resetDatabase);
afterAll(() => receiptReader.close());

/** Negocio abierto todo el día, con Nequi (QR y número) y una salchipapa de $15.000. */
async function restaurant() {
  const merchant = await registerMerchant();
  const { agent } = merchant;
  const week = Array.from({ length: 7 }, (_, day) => ({ day, closed: false, open: "00:00", close: "23:59" }));
  await agent.patch("/api/v1/businesses/current/settings").send({ openingHours: week, paymentMethods: ["CASH", "NEQUI"], deliveryFee: 4000 }).expect(200);
  const qr = await QRCode.toBuffer(NEQUI_PAYLOAD, { type: "png", width: 600, margin: 2 });
  await agent.post("/api/v1/businesses/current/payment-accounts/NEQUI/qr").set("Content-Type", "image/png").send(qr).expect(200);
  await agent.put("/api/v1/businesses/current/payment-accounts/NEQUI").send({ accountKey: "300 123 4567", holderName: "Ana Pérez" }).expect(200);
  const product = (await agent.post("/api/v1/products").send({ name: "Salchipapa", price: 15000 }).expect(201)).body.data as { id: string };
  const slug = (await agent.get("/api/v1/businesses/current")).body.data.slug as string;

  /** El cliente pide desde la mesa 4 (con Nequi, sin pagar todavía). Devuelve el pedido y su clave. */
  const orderAtTable = async (extra: Record<string, unknown> = {}) => {
    const key = randomUUID();
    const res = await newAgent()
      .post(`/api/v1/store/${slug}/orders`)
      .send({ idempotencyKey: key, items: [{ productId: product.id, quantity: 1 }], name: "Laura Vergara", phone: "311 222 3344", paymentMethod: "NEQUI", deliveryType: "DINE_IN", tableNumber: "4", ...extra })
      .expect(201);
    return { id: res.body.data.order.id as string, number: res.body.data.order.number as number, key };
  };
  const scan = (order: { id: string; key: string }, payload: string) =>
    newAgent().post(`/api/v1/store/${slug}/orders/${order.id}/payment-scan`).set("X-Order-Key", order.key).send({ payload });
  const uploadProof = async (image: Buffer) =>
    (await newAgent().post(`/api/v1/store/${slug}/payment-proofs?total=15000`).set("Content-Type", "image/jpeg").send(image).expect(201)).body.data.id as string;
  const pay = (order: { id: string; key: string }, paymentProofId: string) =>
    newAgent().post(`/api/v1/store/${slug}/orders/${order.id}/payment-proof`).set("X-Order-Key", order.key).send({ paymentProofId, kind: "NEQUI" });
  /** Seguimiento del cliente cuando ya terminó la revisión del comprobante. */
  const checked = async (order: { id: string; key: string }) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const tracking = (await newAgent().get(`/api/v1/store/${slug}/orders/${order.id}`).set("X-Order-Key", order.key).expect(200)).body.data;
      if (tracking.paymentCheck !== "PENDING") return tracking;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("La revisión del comprobante no terminó");
  };
  const serve = async (id: string) => {
    for (const status of ["PREPARING", "READY", "DELIVERED"]) await agent.patch(`/api/v1/orders/${id}/status`).send({ status }).expect(200);
  };
  const board = async () => ((await agent.get("/api/v1/orders").expect(200)).body.data.items as { id: string }[]).map((order) => order.id);
  return { ...merchant, slug, product, orderAtTable, scan, uploadProof, pay, checked, serve, board };
}

describe("Pagar la cuenta de la mesa con el QR del local", () => {
  it("en la mesa se pide sin pagar; a domicilio con Nequi sigue pidiendo el comprobante", async () => {
    const store = await restaurant();
    const order = await store.orderAtTable();
    expect((await store.agent.get(`/api/v1/orders/${order.id}`).expect(200)).body.data).toMatchObject({ deliveryType: "DINE_IN", paidAt: null, paymentProof: null });

    const delivery = await newAgent()
      .post(`/api/v1/store/${store.slug}/orders`)
      .send({ idempotencyKey: randomUUID(), items: [{ productId: store.product.id, quantity: 2 }], name: "Laura Vergara", phone: "311 222 3344", paymentMethod: "NEQUI", deliveryType: "DELIVERY", address: "Calle 23 #18-40" })
      .expect(400);
    expect(delivery.body.error.code).toBe("PAYMENT_PROOF_REQUIRED");
  });

  it("el cliente escanea el QR del local, sube el comprobante y la cuenta queda pagada sola", async () => {
    const store = await restaurant();
    const order = await store.orderAtTable();
    await store.serve(order.id);
    // Servida y sin pagar: la mesa sigue en el panel (por cobrar).
    expect(await store.board()).toContain(order.id);

    // Sin la clave del pedido no se puede; un QR que no es del negocio se rechaza.
    expect((await store.scan({ ...order, key: randomUUID() }, NEQUI_PAYLOAD).expect(404)).body.error.code).toBe("ORDER_NOT_FOUND");
    const other = await store.scan(order, "00020101021126280012CO.COM.NEQUI0110310555778852045812530317058 02CO5911CARLOS RUIZ6304ABCD").expect(422);
    expect(other.body.error).toMatchObject({ code: "QR_NOT_FROM_STORE" });
    expect(other.body.error.message).toContain("Escanea el QR de Nequi o Bre-B del local");

    // El QR de la caja: Pedify le dice a quién y cuánto pagar.
    const scanned = (await store.scan(order, ` ${NEQUI_PAYLOAD} `).expect(200)).body.data;
    expect(scanned).toEqual({ account: { kind: "NEQUI", label: "Nequi", accountKey: "300 123 4567", holderName: "Ana Pérez" }, total: 15000 });

    // Paga en su app y sube el pantallazo: todo coincide y queda pagado, sin pasar por la caja.
    await store.pay(order, await store.uploadProof(await nequiReceipt("$ 15.000"))).expect(200);
    const tracking = await store.checked(order);
    expect(tracking).toMatchObject({ paid: true, paymentCheck: "VERIFIED", paymentProofSent: true });
    const detail = (await store.agent.get(`/api/v1/orders/${order.id}`).expect(200)).body.data;
    expect(detail.paidAt).not.toBeNull();
    expect(detail).toMatchObject({ paymentMethod: "NEQUI", paymentProof: { checkStatus: "VERIFIED" } });
    expect(await store.board()).not.toContain(order.id);

    // Ya pagada, la cuenta no se vuelve a pagar.
    expect((await store.scan(order, NEQUI_PAYLOAD).expect(409)).body.error.code).toBe("ALREADY_PAID");
  }, 60_000);

  it("si el comprobante no coincide queda por revisar, y el cliente puede subir el correcto", async () => {
    const store = await restaurant();
    const order = await store.orderAtTable();
    await store.pay(order, await store.uploadProof(await nequiReceipt("$ 12.000", { reference: "M20000001" }))).expect(200);
    expect(await store.checked(order)).toMatchObject({ paid: false, paymentCheck: "MISMATCH" });

    await store.pay(order, await store.uploadProof(await nequiReceipt("$ 15.000", { reference: "M20000002" }))).expect(200);
    expect(await store.checked(order)).toMatchObject({ paid: true, paymentCheck: "VERIFIED" });
    // El comprobante anterior se reemplazó.
    expect(await prisma.paymentProof.count({ where: { orderId: order.id } })).toBe(1);
  }, 60_000);

  it("solo para pedidos en la mesa; en efectivo se cobra en la caja con «Cobrado»", async () => {
    const store = await restaurant();
    const pickupKey = randomUUID();
    const pickup = await newAgent()
      .post(`/api/v1/store/${store.slug}/orders`)
      .send({ idempotencyKey: pickupKey, items: [{ productId: store.product.id, quantity: 2 }], name: "Laura Vergara", phone: "311 222 3344", paymentMethod: "CASH", deliveryType: "PICKUP" })
      .expect(201);
    expect((await store.scan({ id: pickup.body.data.order.id, key: pickupKey }, NEQUI_PAYLOAD).expect(409)).body.error.code).toBe("NOT_DINE_IN");

    const cash = await store.orderAtTable({ paymentMethod: "CASH" });
    await store.serve(cash.id);
    expect(await store.board()).toContain(cash.id);
    await store.agent.patch(`/api/v1/orders/${cash.id}/payment`).send({ paid: true }).expect(200);
    expect(await store.board()).not.toContain(cash.id);
  });
});
