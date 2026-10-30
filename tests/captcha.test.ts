import { createHash, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error: módulo del navegador (JavaScript sin tipos); se prueba que calcule igual que el servidor.
import { sha256Hex } from "../public/js/sha256.js";
import { receiptReader } from "../src/services/receipt-reader.service.js";
import { captchaService, type CaptchaChallenge } from "../src/services/captcha.service.js";
import { newAgent, registerMerchant } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(async () => {
  await resetDatabase();
  captchaService.required = true;
});
afterEach(() => {
  captchaService.required = false;
});
afterAll(() => receiptReader.close());

const NEQUI_PAYLOAD = "00020101021126280012CO.COM.NEQUI0110300123456752045812530317058 02CO5910ANA PEREZ6009SINCELEJO6304C3D4";

/** Resuelve el reto como lo hace el navegador y arma la cabecera X-Captcha. */
function solve(challenge: CaptchaChallenge) {
  for (let number = 0; number <= challenge.maxnumber; number += 1) {
    if (createHash("sha256").update(`${challenge.salt}${number}`).digest("hex") === challenge.challenge) {
      return Buffer.from(JSON.stringify({ salt: challenge.salt, number, signature: challenge.signature })).toString("base64url");
    }
  }
  throw new Error("Reto sin solución");
}

const freshToken = async () => solve((await newAgent().get("/api/v1/captcha/challenge").expect(200)).body.data);

/** Tienda abierta con Nequi para pagar por adelantado. */
async function store() {
  const { agent } = await registerMerchant();
  const week = Array.from({ length: 7 }, (_, day) => ({ day, closed: false, open: "00:00", close: "23:59" }));
  await agent.patch("/api/v1/businesses/current/settings").send({ openingHours: week, paymentMethods: ["CASH", "NEQUI"] }).expect(200);
  const qr = await QRCode.toBuffer(NEQUI_PAYLOAD, { type: "png", width: 600, margin: 2 });
  await agent.post("/api/v1/businesses/current/payment-accounts/NEQUI/qr").set("Content-Type", "image/png").send(qr).expect(200);
  const product = (await agent.post("/api/v1/products").send({ name: "Salchipapa", price: 15000 }).expect(201)).body.data as { id: string };
  const slug = (await agent.get("/api/v1/businesses/current")).body.data.slug as string;
  const order = (captcha?: string) => {
    const req = newAgent()
      .post(`/api/v1/store/${slug}/orders`)
      .send({ idempotencyKey: randomUUID(), items: [{ productId: product.id, quantity: 1 }], name: "Laura Vergara", phone: "311 222 3344", deliveryType: "PICKUP", paymentMethod: "CASH" });
    return captcha ? req.set("X-Captcha", captcha) : req;
  };
  const image = await sharp({ create: { width: 900, height: 1900, channels: 3, background: "#f4f0ff" } }).png().toBuffer();
  const proof = (captcha?: string) => {
    const req = newAgent().post(`/api/v1/store/${slug}/payment-proofs`).set("Content-Type", "image/png");
    return (captcha ? req.set("X-Captcha", captcha) : req).send(image);
  };
  return { order, proof };
}

describe("«No soy un robot» al pagar y pedir en la tienda", () => {
  it("sin la casilla no se puede hacer un pedido ni subir un comprobante; con ella sí", async () => {
    const { order, proof } = await store();
    expect((await order().expect(400)).body.error).toMatchObject({ code: "CAPTCHA_REQUIRED", message: "Marca «No soy un robot» antes de continuar." });
    expect((await proof().expect(400)).body.error.code).toBe("CAPTCHA_REQUIRED");

    await order(await freshToken()).expect(201);
    await proof(await freshToken()).expect(201);
  });

  it("cada verificación sirve una sola vez, y no se acepta una firma falsa, otro número ni una vencida", async () => {
    const { order } = await store();
    const token = await freshToken();
    await order(token).expect(201);
    expect((await order(token).expect(400)).body.error.code).toBe("CAPTCHA_INVALID");

    const challenge = (await newAgent().get("/api/v1/captcha/challenge").expect(200)).body.data as CaptchaChallenge;
    expect(challenge).toMatchObject({ algorithm: "SHA-256", maxnumber: 100_000 });
    const solved = JSON.parse(Buffer.from(solve(challenge), "base64url").toString("utf8")) as { salt: string; number: number; signature: string };
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    await order(encode({ ...solved, signature: "0".repeat(64) })).expect(400);
    await order(encode({ ...solved, number: solved.number + 1 })).expect(400);
    await order("no-es-un-token").expect(400);

    const old = captchaService.challenge(Date.now() - 11 * 60_000);
    expect(captchaService.verify(solve(old))).toBe("invalid");
    expect(captchaService.verify(solve(captchaService.challenge()))).toBe("ok");
  });

  it("el SHA-256 del navegador da lo mismo que el del servidor", () => {
    for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), `${"9f".repeat(12)}.1798500000000${123456}`, "x".repeat(200)]) {
      expect(sha256Hex(text)).toBe(createHash("sha256").update(text).digest("hex"));
    }
  });
});
