import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { readQr } from "../src/modules/payment-accounts/payment-accounts.service.js";
import { login, newAgent, PASSWORD, registerMerchant, uniqueEmail } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(resetDatabase);

const NEQUI_PAYLOAD = "00020101021126280012CO.COM.NEQUI0110300123456752045812530317058 02CO5910ANA PEREZ6009SINCELEJO6304C3D4";

/** Pantallazo del comprobante que muestra la app al pagar. */
const receipt = () => sharp({ create: { width: 900, height: 1900, channels: 3, background: "#f4f0ff" } }).png().toBuffer();

const fileOf = (key: string) => path.join(process.env.UPLOADS_DIR!, key);

/** Negocio abierto con Nequi, Daviplata y transferencia; Nequi con QR y Bre-B solo con llave. */
async function prepaidStore({ accounts = true } = {}) {
  const merchant = await registerMerchant();
  const { agent } = merchant;
  const week = Array.from({ length: 7 }, (_, day) => ({ day, closed: false, open: "00:00", close: "23:59" }));
  await agent
    .patch("/api/v1/businesses/current/settings")
    .send({ openingHours: week, paymentMethods: ["CASH", "NEQUI", "DAVIPLATA", "BANK_TRANSFER"], deliveryFee: 4000 })
    .expect(200);
  if (accounts) {
    const qr = await QRCode.toBuffer(NEQUI_PAYLOAD, { type: "png", width: 600, margin: 2 });
    await agent.post("/api/v1/businesses/current/payment-accounts/NEQUI/qr").set("Content-Type", "image/png").send(qr).expect(200);
    await agent.put("/api/v1/businesses/current/payment-accounts/NEQUI").send({ accountKey: "300 123 4567", holderName: "Ana Pérez" }).expect(200);
    await agent.put("/api/v1/businesses/current/payment-accounts/BRE_B").send({ accountKey: "@sabores2024", holderName: "Sabores del Caribe" }).expect(200);
  }
  const product = (await agent.post("/api/v1/products").send({ name: "Salchipapa", price: 15000 }).expect(201)).body.data as { id: string };
  const slug = (await agent.get("/api/v1/businesses/current")).body.data.slug as string;

  const receiptImage = await receipt();
  const uploadProof = (image = receiptImage) => newAgent().post(`/api/v1/store/${slug}/payment-proofs`).set("Content-Type", "image/png").send(image);
  const placeOrder = (extra: Record<string, unknown> = {}) =>
    newAgent()
      .post(`/api/v1/store/${slug}/orders`)
      .send({
        idempotencyKey: randomUUID(),
        items: [{ productId: product.id, quantity: 2 }],
        name: "Laura Vergara",
        phone: "311 222 3344",
        deliveryType: "DELIVERY",
        address: "Calle 23 #18-40",
        paymentMethod: "NEQUI",
        ...extra,
      });
  return { ...merchant, slug, product, uploadProof, placeOrder };
}

describe("Pago por adelantado con QR y comprobante", () => {
  it("la tienda muestra, por cada método, las cuentas para pagar antes de pedir", async () => {
    const { slug } = await prepaidStore();
    const { payments } = (await newAgent().get(`/api/v1/store/${slug}`).expect(200)).body.data;
    // La llave Bre-B se paga desde cualquier banco: sirve para Nequi, Daviplata y transferencia.
    expect(payments.prepay).toEqual({ NEQUI: ["NEQUI", "BRE_B"], DAVIPLATA: ["BRE_B"], BANK_TRANSFER: ["BRE_B"] });
    expect(payments.accounts).toEqual([
      { kind: "NEQUI", label: "Nequi", accountKey: "300 123 4567", holderName: "Ana Pérez", qrSvg: expect.stringContaining("<svg") },
      { kind: "BRE_B", label: "Bre-B", accountKey: "@sabores2024", holderName: "Sabores del Caribe", qrSvg: null },
    ]);

    // El QR en PNG, para guardarlo y subirlo en la app cuando se pide desde el mismo celular.
    const png = await newAgent().get(`/api/v1/store/${slug}/payment-qr/NEQUI.png`).buffer(true).expect(200);
    expect(png.headers["content-type"]).toBe("image/png");
    expect(png.headers["content-disposition"]).toContain(`qr-nequi-${slug}.png`);
    expect(await readQr(png.body as Buffer)).toBe(NEQUI_PAYLOAD);
    await newAgent().get(`/api/v1/store/${slug}/payment-qr/BRE_B.png`).expect(404); // Bre-B sin QR
    await newAgent().get(`/api/v1/store/${slug}/payment-qr/PAYPAL.png`).expect(400);

    const plain = await prepaidStore({ accounts: false });
    expect((await newAgent().get(`/api/v1/store/${plain.slug}`).expect(200)).body.data.payments).toEqual({ prepay: {}, accounts: [] });
  });

  it("con Nequi el pedido exige el comprobante; queda unido al pedido y no se puede reutilizar", async () => {
    const { agent, uploadProof, placeOrder } = await prepaidStore();

    const missing = await placeOrder().expect(400);
    expect(missing.body.error).toMatchObject({ code: "PAYMENT_PROOF_REQUIRED", details: { fields: { paymentProof: expect.any(String) } } });

    const proof = (await uploadProof().expect(201)).body.data;
    expect(proof).toEqual({ id: expect.any(String), createdAt: expect.any(String) });
    const created = (await placeOrder({ paymentProofId: proof.id }).expect(201)).body.data.order;
    expect(created.paymentProof).toEqual({ createdAt: proof.createdAt });

    const reused = await placeOrder({ paymentProofId: proof.id, paymentMethod: "BANK_TRANSFER" }).expect(400);
    expect(reused.body.error.code).toBe("PAYMENT_PROOF_INVALID");
    await placeOrder({ paymentProofId: randomUUID() }).expect(400);

    // Efectivo y datáfono se pagan al recibir, sin comprobante.
    expect((await placeOrder({ paymentMethod: "CASH" }).expect(201)).body.data.order.paymentProof).toBeNull();

    const list = (await agent.get("/api/v1/orders").expect(200)).body.data.items;
    expect(list.find((order: { id: string }) => order.id === created.id).paymentProof).toEqual({ createdAt: proof.createdAt });
  });

  it("sin cuentas configuradas, Nequi se sigue pagando al recibir y no se aceptan comprobantes", async () => {
    const { uploadProof, placeOrder } = await prepaidStore({ accounts: false });
    expect((await uploadProof().expect(409)).body.error.code).toBe("PREPAY_NOT_AVAILABLE");
    await placeOrder().expect(201);
  });

  it("el comprobante es privado: solo el equipo del negocio lo ve, por la API", async () => {
    const { agent, slug, uploadProof, placeOrder } = await prepaidStore();
    const proof = (await uploadProof().expect(201)).body.data;
    const order = (await placeOrder({ paymentProofId: proof.id }).expect(201)).body.data.order;

    const image = await agent.get(`/api/v1/orders/${order.id}/payment-proof`).buffer(true).expect(200);
    expect(image.headers["content-type"]).toBe("image/webp");
    expect(image.headers["cache-control"]).toBe("private, no-store");
    expect((await sharp(image.body as Buffer).metadata()).format).toBe("webp");

    const { imageKey } = await prisma.paymentProof.findUniqueOrThrow({ where: { id: proof.id } });
    expect(imageKey).toMatch(/^private\//);
    await newAgent().get(`/uploads/${imageKey}`).expect(404);
    await newAgent().get(`/api/v1/orders/${order.id}/payment-proof`).expect(401);

    const email = uniqueEmail("empleado");
    await agent.post("/api/v1/businesses/current/members").send({ name: "Carlos Mesa", email, password: PASSWORD }).expect(201);
    await (await login(email)).get(`/api/v1/orders/${order.id}/payment-proof`).expect(200);
    const other = await registerMerchant({ businessName: "Otro", businessPhone: "300 999 8877" });
    await other.agent.get(`/api/v1/orders/${order.id}/payment-proof`).expect(404);
    const cash = (await placeOrder({ paymentMethod: "CASH" }).expect(201)).body.data.order;
    expect((await agent.get(`/api/v1/orders/${cash.id}/payment-proof`).expect(404)).body.error.code).toBe("PAYMENT_PROOF_NOT_FOUND");

    // El cliente ve que su comprobante llegó y, cuando el negocio lo revisa, que el pago quedó confirmado.
    const key = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).idempotencyKey;
    const track = async () => (await newAgent().get(`/api/v1/store/${slug}/orders/${order.id}`).set("X-Order-Key", key!).expect(200)).body.data;
    expect(await track()).toMatchObject({ paymentProofSent: true, paid: false });
    await agent.patch(`/api/v1/orders/${order.id}/payment`).send({ paid: true }).expect(200);
    expect(await track()).toMatchObject({ paymentProofSent: true, paid: true });
  });

  it("rechaza archivos que no son imágenes y comprobantes de otro negocio o vencidos", async () => {
    const a = await prepaidStore();
    const b = await prepaidStore();
    expect((await a.uploadProof(Buffer.from("no soy una imagen")).expect(415)).body.error.code).toBe("UNSUPPORTED_IMAGE");

    const fromB = (await b.uploadProof().expect(201)).body.data;
    expect((await a.placeOrder({ paymentProofId: fromB.id }).expect(400)).body.error.code).toBe("PAYMENT_PROOF_INVALID");

    const old = (await a.uploadProof().expect(201)).body.data;
    await prisma.paymentProof.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    expect((await a.placeOrder({ paymentProofId: old.id }).expect(400)).body.error.code).toBe("PAYMENT_PROOF_INVALID");

    // Al subir otro, los que nunca se usaron y ya vencieron se borran (registro y archivo).
    const { imageKey } = await prisma.paymentProof.findUniqueOrThrow({ where: { id: old.id } });
    expect(existsSync(fileOf(imageKey))).toBe(true);
    await a.uploadProof().expect(201);
    await expect.poll(() => prisma.paymentProof.count({ where: { id: old.id } })).toBe(0);
    await expect.poll(() => existsSync(fileOf(imageKey))).toBe(false);
  });

  it("al suprimir los datos de un cliente se borran sus comprobantes", async () => {
    const { agent, uploadProof, placeOrder } = await prepaidStore();
    const proof = (await uploadProof().expect(201)).body.data;
    const order = (await placeOrder({ paymentProofId: proof.id }).expect(201)).body.data.order;
    const { imageKey } = await prisma.paymentProof.findUniqueOrThrow({ where: { id: proof.id } });
    const { customerId } = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

    await agent.delete(`/api/v1/customers/${customerId}`).expect(204);
    expect(await prisma.paymentProof.count()).toBe(0);
    expect(existsSync(fileOf(imageKey))).toBe(false);
    expect((await agent.get(`/api/v1/orders/${order.id}`).expect(200)).body.data.paymentProof).toBeNull();
  });
});
