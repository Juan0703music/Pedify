import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { pushService } from "../src/modules/push/push.service.js";
import { receiptReader } from "../src/services/receipt-reader.service.js";
import { registerMerchant } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";
import { NEQUI_PAYLOAD, nequiReceipt } from "./helpers/receipts.js";

type Sent = { endpoint: string; payload: { title: string; body: string; url: string; tag: string } };
let sent: Sent[] = [];
const realTransport = pushService.transport;

beforeEach(async () => {
  await resetDatabase();
  sent = [];
  pushService.transport = async (subscription, payload) => {
    sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
  };
});
afterEach(() => {
  pushService.transport = realTransport;
});
afterAll(() => receiptReader.close());

const device = (name: string = randomUUID()) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
  keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
});

/** Administrador de Pedify con su cuenta Nequi para recibir los pagos de los planes. */
async function admin() {
  const merchant = await registerMerchant({ name: "Juan Pedify", businessName: "Pedify Soporte" });
  await prisma.user.update({ where: { id: merchant.profile.user.id }, data: { isPlatformAdmin: true } });
  const qr = await QRCode.toBuffer(NEQUI_PAYLOAD, { type: "png", width: 600, margin: 2 });
  await merchant.agent.post("/api/v1/admin/payment-accounts/NEQUI/qr").set("Content-Type", "image/png").send(qr).expect(200);
  await merchant.agent.put("/api/v1/admin/payment-accounts/NEQUI").send({ accountKey: "300 123 4567", holderName: "Ana Pérez" }).expect(200);
  return merchant;
}

/** Espera a que lleguen `count` avisos (se envían después de leer el comprobante). */
async function waitForPushes(count: number) {
  for (let attempt = 0; attempt < 80 && sent.length < count; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 250));
  return sent;
}

describe("Avisos al celular de los administradores de Pedify", () => {
  it("el administrador activa los avisos en su celular (aparte de los del negocio); un comerciante no puede", async () => {
    const merchant = await registerMerchant();
    await merchant.agent.get("/api/v1/admin/push").expect(403);
    await merchant.agent.post("/api/v1/admin/push/subscriptions").send(device()).expect(403);

    const { agent } = await admin();
    expect((await agent.get("/api/v1/admin/push").expect(200)).body.data).toEqual({ enabled: true, publicKey: process.env.VAPID_PUBLIC_KEY, devices: 0 });
    await agent.post("/api/v1/admin/push/subscriptions").send({ endpoint: "https://evil.example.com/x", keys: device().keys }).expect(400);

    // El mismo celular recibe los pedidos de su negocio y los pagos de Pedify.
    const phone = device("celular-de-juan");
    expect((await agent.post("/api/v1/admin/push/subscriptions").send(phone).expect(201)).body.data).toEqual({ devices: 1 });
    await agent.post("/api/v1/admin/push/subscriptions").send(phone).expect(201);
    await agent.post("/api/v1/push/subscriptions").send(phone).expect(201);
    expect(await prisma.adminPushSubscription.count()).toBe(1);
    expect(await prisma.pushSubscription.count()).toBe(1);

    expect((await agent.post("/api/v1/admin/push/test").expect(200)).body.data).toEqual({ sent: 1, devices: 1 });
    expect(sent[0]?.payload).toMatchObject({ title: "Pedify: avisos de pagos activados", url: "/admin#pagos" });

    await agent.delete("/api/v1/admin/push/subscriptions").send({ endpoint: phone.endpoint }).expect(204);
    expect(await prisma.adminPushSubscription.count()).toBe(0);
    expect(await prisma.pushSubscription.count()).toBe(1);

    // Cerrar la sesión en todos los dispositivos también apaga los avisos de pagos.
    await agent.post("/api/v1/admin/push/subscriptions").send(phone).expect(201);
    await agent.post("/api/v1/auth/logout-all").expect(204);
    expect(await prisma.adminPushSubscription.count()).toBe(0);
  });

  it("le llega un aviso cuando un negocio sube el comprobante de su plan; si deja de ser administrador, ya no", async () => {
    const pedify = await admin();
    await pedify.agent.post("/api/v1/admin/push/subscriptions").send(device("celular-de-juan")).expect(201);

    const cafe = await registerMerchant({ businessName: "Café El Puente" });
    await cafe.agent.post("/api/v1/subscription/transfers?plan=NEGOCIO&months=1&method=NEQUI").set("Content-Type", "image/jpeg").send(await nequiReceipt("$ 399.900")).expect(201);
    const [notice] = await waitForPushes(1);
    expect(notice).toMatchObject({
      endpoint: "https://fcm.googleapis.com/fcm/send/celular-de-juan",
      payload: { title: "Pago por revisar · $399.900", body: "Café El Puente · plan Negocio 1 mes por Nequi. Todo coincide.", url: "/admin#pagos" },
    });

    await prisma.user.update({ where: { id: pedify.profile.user.id }, data: { isPlatformAdmin: false } });
    const reino = await registerMerchant({ businessName: "El Reino de la Salchipapa" });
    await reino.agent.post("/api/v1/subscription/transfers?plan=NEGOCIO&months=1&method=NEQUI").set("Content-Type", "image/jpeg").send(await nequiReceipt("$ 399.900", { reference: "M20000001" })).expect(201);
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if ((await prisma.planTransfer.count({ where: { checkStatus: { not: "PENDING" } } })) === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sent).toHaveLength(1);
  });
});
