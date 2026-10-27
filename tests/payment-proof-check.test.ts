import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { receiptReader } from "../src/services/receipt-reader.service.js";
import { newAgent, registerMerchant } from "./helpers/app.js";
import { NEQUI_PAYLOAD, nequiReceipt } from "./helpers/receipts.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(resetDatabase);
afterAll(() => receiptReader.close());

async function prepaidStore() {
  const merchant = await registerMerchant();
  const { agent } = merchant;
  const week = Array.from({ length: 7 }, (_, day) => ({ day, closed: false, open: "00:00", close: "23:59" }));
  await agent.patch("/api/v1/businesses/current/settings").send({ openingHours: week, paymentMethods: ["CASH", "NEQUI"], deliveryFee: 4000 }).expect(200);
  const qr = await QRCode.toBuffer(NEQUI_PAYLOAD, { type: "png", width: 600, margin: 2 });
  await agent.post("/api/v1/businesses/current/payment-accounts/NEQUI/qr").set("Content-Type", "image/png").send(qr).expect(200);
  await agent.put("/api/v1/businesses/current/payment-accounts/NEQUI").send({ accountKey: "300 123 4567", holderName: "Ana Pérez" }).expect(200);
  const product = (await agent.post("/api/v1/products").send({ name: "Salchipapa", price: 15000 }).expect(201)).body.data as { id: string };
  const slug = (await agent.get("/api/v1/businesses/current")).body.data.slug as string;

  // 2 salchipapas ($30.000) + domicilio ($4.000) = $34.000.
  const upload = (image: Buffer) => newAgent().post(`/api/v1/store/${slug}/payment-proofs?total=34000`).set("Content-Type", "image/jpeg").send(image).expect(201);
  const order = async (paymentProofId: string) =>
    (
      await newAgent()
        .post(`/api/v1/store/${slug}/orders`)
        .send({
          idempotencyKey: randomUUID(),
          items: [{ productId: product.id, quantity: 2 }],
          name: "Laura Vergara",
          phone: "311 222 3344",
          deliveryType: "DELIVERY",
          address: "Calle 23 #18-40",
          paymentMethod: "NEQUI",
          paymentProofId,
        })
        .expect(201)
    ).body.data.order as { id: string; number: number; total: number };
  /** Detalle del pedido en el panel cuando ya terminó la verificación. */
  const verified = async (orderId: string) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const detail = (await agent.get(`/api/v1/orders/${orderId}`).expect(200)).body.data;
      if (detail.paymentProof.checkStatus !== "PENDING") return detail;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("La verificación del comprobante no terminó");
  };
  return { ...merchant, upload, order, verified };
}

describe("Verificación automática del comprobante de pago", () => {
  it("lee el comprobante al subirlo, lo verifica con el pedido y detecta el mismo pantallazo en otro pedido", async () => {
    const store = await prepaidStore();
    const image = await nequiReceipt("$ 34.000");

    // Al subirlo, el cliente ya sabe si el valor coincide con lo que va a pagar.
    const uploaded = (await store.upload(image)).body.data;
    expect(uploaded.reading).toEqual({ amount: 34_000, matchesTotal: true });

    const first = await store.order(uploaded.id);
    expect(first.total).toBe(34_000);
    const detail = await store.verified(first.id);
    expect(detail.paymentProof.checkStatus).toBe("VERIFIED");
    expect(detail.paymentProof.checks.map((check: { key: string; ok: boolean }) => [check.key, check.ok])).toEqual([
      ["receipt", true],
      ["amount", true],
      ["recipient", true],
      ["date", true],
      ["unique", true],
    ]);
    // La lista del panel trae el resultado para la tarjeta del pedido.
    const list = (await store.agent.get("/api/v1/orders").expect(200)).body.data.items;
    expect(list[0].paymentProof).toMatchObject({ checkStatus: "VERIFIED" });

    // El mismo pantallazo en un segundo pedido: no coincide.
    const again = (await store.upload(image)).body.data;
    const second = await store.order(again.id);
    const repeated = await store.verified(second.id);
    expect(repeated.paymentProof.checkStatus).toBe("MISMATCH");
    expect(repeated.paymentProof.checks.find((check: { key: string }) => check.key === "unique").detail).toBe(`Es el mismo pantallazo del pedido #${first.number}.`);
  }, 60_000);

  it("avisa al cliente y al negocio cuando el valor o la cuenta no coinciden", async () => {
    const store = await prepaidStore();
    const wrong = (await store.upload(await nequiReceipt("$ 30.000", { to: "CARLOS RUIZ", phone: "310 555 7788", reference: "M20000001" }))).body.data;
    expect(wrong.reading).toEqual({ amount: 30_000, matchesTotal: false });

    const order = await store.order(wrong.id);
    const detail = await store.verified(order.id);
    expect(detail.paymentProof.checkStatus).toBe("MISMATCH");
    const failed = detail.paymentProof.checks.filter((check: { ok: boolean }) => check.ok === false).map((check: { detail: string }) => check.detail);
    expect(failed).toEqual(["Dice $30.000 y el pedido es de $34.000.", "El pago fue a 310•••7788, que no es una de tus cuentas."]);
  }, 60_000);
});
