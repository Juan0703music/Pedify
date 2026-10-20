import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { login, newAgent, PASSWORD, registerMerchant, uniqueEmail } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(resetDatabase);

// Código de cobro con el formato EMVCo que usan Bre-B y Nequi (datos de ejemplo).
const BRE_B_PAYLOAD = "00020101021126360014CO.COM.BREB.LLA0114@sabores2024520458125303170540550005802CO5918SABORES DEL CARIBE6009SINCELEJO6304A1B2";
const NEQUI_PAYLOAD = "00020101021126280012CO.COM.NEQUI0110300123456752045812530317058 02CO5910ANA PEREZ6009SINCELEJO6304C3D4";

/** Pantallazo de celular con el QR en el centro, como el que descarga la app del banco. */
async function screenshot(payload: string) {
  const qr = await QRCode.toBuffer(payload, { type: "png", width: 640, margin: 2 });
  return sharp({ create: { width: 1080, height: 2280, channels: 3, background: "#da0081" } })
    .composite([{ input: qr, top: 700, left: 220 }])
    .png()
    .toBuffer();
}

const uploadQr = (agent: ReturnType<typeof newAgent>, kind: string, image: Buffer) =>
  agent.post(`/api/v1/businesses/current/payment-accounts/${kind}/qr`).set("Content-Type", "image/png").send(image);

describe("Cuentas para cobrar con QR (Nequi, Bre-B, Daviplata)", () => {
  it("lee el código del pantallazo, guarda la llave y lo devuelve dibujado de nuevo", async () => {
    const { agent, businessId } = await registerMerchant();
    expect((await agent.get("/api/v1/businesses/current/payment-accounts").expect(200)).body.data).toEqual([]);

    const uploaded = (await uploadQr(agent, "BRE_B", await screenshot(BRE_B_PAYLOAD)).expect(200)).body.data;
    expect(uploaded).toMatchObject({ kind: "BRE_B", label: "Bre-B", accountKey: null, holderName: null });
    expect(uploaded.qrSvg).toContain("<svg");
    expect(uploaded.qrImageUrl).toMatch(new RegExp(`^/uploads/businesses/${businessId}/payments/[\\w-]+\\.webp$`));
    expect(uploaded).not.toHaveProperty("qrPayload");
    expect(uploaded).not.toHaveProperty("qrImageKey");

    const saved = await agent
      .put("/api/v1/businesses/current/payment-accounts/BRE_B")
      .send({ accountKey: " @sabores2024 ", holderName: "Sabores del Caribe" })
      .expect(200);
    expect(saved.body.data).toMatchObject({ accountKey: "@sabores2024", holderName: "Sabores del Caribe", qrSvg: uploaded.qrSvg });

    // Solo llave, sin QR: también sirve (el domiciliario la dicta o la muestra).
    await agent.put("/api/v1/businesses/current/payment-accounts/NEQUI").send({ accountKey: "300 123 4567", holderName: "Ana Pérez" }).expect(200);
    const list = (await agent.get("/api/v1/businesses/current/payment-accounts").expect(200)).body.data;
    expect(list.map((account: { kind: string }) => account.kind)).toEqual(["NEQUI", "BRE_B"]);
    expect(list[0]).toMatchObject({ accountKey: "300 123 4567", qrSvg: null, qrImageUrl: null });
  });

  it("al cambiar o quitar el QR borra la imagen anterior", async () => {
    const { agent } = await registerMerchant();
    const fileOf = (url: string) => path.join(process.env.UPLOADS_DIR!, url.replace(/^\/uploads\//, ""));
    const first = (await uploadQr(agent, "NEQUI", await screenshot(NEQUI_PAYLOAD)).expect(200)).body.data;
    const second = (await uploadQr(agent, "NEQUI", await screenshot(BRE_B_PAYLOAD)).expect(200)).body.data;
    expect(existsSync(fileOf(first.qrImageUrl))).toBe(false);
    expect(existsSync(fileOf(second.qrImageUrl))).toBe(true);
    expect(second.qrSvg).not.toBe(first.qrSvg);

    await agent.delete("/api/v1/businesses/current/payment-accounts/NEQUI").expect(204);
    expect(existsSync(fileOf(second.qrImageUrl))).toBe(false);
    expect((await agent.get("/api/v1/businesses/current/payment-accounts").expect(200)).body.data).toEqual([]);
    expect((await agent.delete("/api/v1/businesses/current/payment-accounts/NEQUI").expect(404)).body.error.code).toBe("PAYMENT_ACCOUNT_NOT_FOUND");
  });

  it("rechaza imágenes sin QR, cuentas desconocidas y datos inválidos", async () => {
    const { agent } = await registerMerchant();
    const blank = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#ffffff" } }).png().toBuffer();
    expect((await uploadQr(agent, "NEQUI", blank).expect(422)).body.error.code).toBe("QR_NOT_FOUND");
    await uploadQr(agent, "PAYPAL", await screenshot(NEQUI_PAYLOAD)).expect(400);
    await agent.put("/api/v1/businesses/current/payment-accounts/NEQUI").send({ accountKey: "30" }).expect(400);
    await agent.put("/api/v1/businesses/current/payment-accounts/NEQUI").send({ accountKey: "x".repeat(81) }).expect(400);
    await agent.put("/api/v1/businesses/current/payment-accounts/NEQUI").send({ holderName: "A" }).expect(400);
    expect((await agent.get("/api/v1/businesses/current/payment-accounts").expect(200)).body.data).toEqual([]);
  });

  it("solo el propietario las configura; cada negocio ve las suyas", async () => {
    const { agent: owner } = await registerMerchant();
    await uploadQr(owner, "NEQUI", await screenshot(NEQUI_PAYLOAD)).expect(200);
    const email = uniqueEmail("empleado");
    await owner.post("/api/v1/businesses/current/members").send({ name: "Carlos Mesa", email, password: PASSWORD }).expect(201);
    const employee = await login(email);
    await employee.get("/api/v1/businesses/current/payment-accounts").expect(403);
    await employee.put("/api/v1/businesses/current/payment-accounts/NEQUI").send({ accountKey: "3009998877" }).expect(403);
    await uploadQr(employee, "NEQUI", await screenshot(BRE_B_PAYLOAD)).expect(403);
    await employee.delete("/api/v1/businesses/current/payment-accounts/NEQUI").expect(403);
    await newAgent().get("/api/v1/businesses/current/payment-accounts").expect(401);

    const other = await registerMerchant({ businessName: "Otro", businessPhone: "300 999 8877" });
    expect((await other.agent.get("/api/v1/businesses/current/payment-accounts").expect(200)).body.data).toEqual([]);
  });

  it("el domiciliario ve los QR del negocio y el sugerido según cómo paga el cliente", async () => {
    const { agent } = await registerMerchant();
    const week = Array.from({ length: 7 }, (_, day) => ({ day, closed: false, open: "00:00", close: "23:59" }));
    await agent.patch("/api/v1/businesses/current/settings").send({ openingHours: week, paymentMethods: ["CASH", "BANK_TRANSFER"] }).expect(200);
    await uploadQr(agent, "BRE_B", await screenshot(BRE_B_PAYLOAD)).expect(200);
    await agent.put("/api/v1/businesses/current/payment-accounts/BRE_B").send({ accountKey: "@sabores2024", holderName: "Sabores del Caribe" }).expect(200);
    await agent.put("/api/v1/businesses/current/payment-accounts/NEQUI").send({ accountKey: "3001234567" }).expect(200);

    const product = (await agent.post("/api/v1/products").send({ name: "Salchipapa", price: 15000 }).expect(201)).body.data;
    const slug = (await agent.get("/api/v1/businesses/current")).body.data.slug as string;
    const order = async (paymentMethod: string) =>
      (
        await newAgent()
          .post(`/api/v1/store/${slug}/orders`)
          .send({
            idempotencyKey: randomUUID(),
            items: [{ productId: product.id, quantity: 1 }],
            name: "Laura Vergara",
            phone: "311 222 3344",
            deliveryType: "DELIVERY",
            address: "Calle 23 #18-40",
            paymentMethod,
          })
          .expect(201)
      ).body.data.order as { id: string };
    const riderView = async (orderId: string) => {
      await agent.patch(`/api/v1/orders/${orderId}/status`).send({ status: "PREPARING" }).expect(200);
      const url = (await agent.post(`/api/v1/orders/${orderId}/courier-link`).expect(201)).body.data.url as string;
      return (await newAgent().get("/api/v1/courier").set("X-Courier-Key", new URL(url).hash.slice(1)).expect(200)).body.data;
    };

    const transfer = await riderView((await order("BANK_TRANSFER")).id);
    expect(transfer.suggestedAccount).toBe("BRE_B");
    expect(transfer.paymentAccounts).toEqual([
      expect.objectContaining({ kind: "NEQUI", accountKey: "3001234567", qrSvg: null }),
      expect.objectContaining({ kind: "BRE_B", accountKey: "@sabores2024", holderName: "Sabores del Caribe", qrSvg: expect.stringContaining("<svg") }),
    ]);
    expect(JSON.stringify(transfer)).not.toContain("qrImageKey");

    const cash = await riderView((await order("CASH")).id);
    expect(cash.suggestedAccount).toBeNull();
    expect(cash.paymentAccounts).toHaveLength(2);
  });
});
