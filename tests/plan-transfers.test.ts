import QRCode from "qrcode";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { mailer } from "../src/services/mail.service.js";
import { receiptReader } from "../src/services/receipt-reader.service.js";
import { newAgent, registerMerchant } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";
import { NEQUI_PAYLOAD, nequiReceipt } from "./helpers/receipts.js";

beforeEach(async () => {
  await resetDatabase();
  mailer.outbox.length = 0;
});
afterAll(() => receiptReader.close());

type Agent = ReturnType<typeof newAgent>;
const NEGOCIO_MONTH = 399_900;

/** Administrador de Pedify con sus cuentas de cobro: Nequi (QR y número) y llave Bre-B. */
async function pedifyWithAccounts() {
  const admin = await registerMerchant({ name: "Juan Pedify", businessName: "Pedify Soporte" });
  await prisma.user.update({ where: { id: admin.profile.user.id }, data: { isPlatformAdmin: true } });
  const qr = await QRCode.toBuffer(NEQUI_PAYLOAD, { type: "png", width: 600, margin: 2 });
  const nequi = await admin.agent.post("/api/v1/admin/payment-accounts/NEQUI/qr").set("Content-Type", "image/png").send(qr).expect(200);
  expect(nequi.body.data.qrSvg).toContain("<svg");
  await admin.agent.put("/api/v1/admin/payment-accounts/NEQUI").send({ accountKey: "300 123 4567", holderName: "Ana Pérez" }).expect(200);
  await admin.agent.put("/api/v1/admin/payment-accounts/BRE_B").send({ accountKey: "@pedify", holderName: "Ana Pérez" }).expect(200);
  return admin;
}

const pay = (agent: Agent, image: Buffer, query = "plan=NEGOCIO&months=1&method=NEQUI") =>
  agent.post(`/api/v1/subscription/transfers?${query}`).set("Content-Type", "image/jpeg").send(image);

type Reviewed = Record<string, unknown> & { id: string; checkStatus: string; checks: { key: string; ok: boolean | null; detail: string }[] };

/** El pago en la lista del administrador cuando ya terminó la revisión automática. */
async function checked(admin: Agent, id: string, status = "PENDING") {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const items = (await admin.get(`/api/v1/admin/transfers?status=${status}`).expect(200)).body.data.items as Reviewed[];
    const found = items.find((item) => item.id === id);
    if (found && found.checkStatus !== "PENDING") return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("La revisión del comprobante no terminó");
}

describe("Pago directo de los planes (Nequi o llave Bre-B)", () => {
  it("sin cuentas de Pedify no se ofrece, y solo los administradores las configuran", async () => {
    const merchant = await registerMerchant();
    const plan = (await merchant.agent.get("/api/v1/subscription").expect(200)).body.data;
    expect(plan).toMatchObject({ directPayment: null, transfer: null });
    const res = await pay(merchant.agent, await nequiReceipt("$ 399.900")).expect(409);
    expect(res.body.error.code).toBe("DIRECT_PAYMENT_UNAVAILABLE");

    await merchant.agent.put("/api/v1/admin/payment-accounts/NEQUI").send({ accountKey: "300 123 4567" }).expect(403);
    const admin = await pedifyWithAccounts();
    await admin.agent.put("/api/v1/admin/payment-accounts/DAVIPLATA").send({ accountKey: "300 123 4567" }).expect(400);
    expect((await admin.agent.get("/api/v1/admin/payment-accounts").expect(200)).body.data.map((account: { kind: string }) => account.kind)).toEqual(["NEQUI", "BRE_B"]);
  });

  it("el negocio paga a Nequi y sube el comprobante; Pedify lo revisa y al aprobarlo el plan se activa", async () => {
    const admin = await pedifyWithAccounts();
    const merchant = await registerMerchant({ businessName: "Café El Puente" });

    // «Mi plan» muestra las cuentas de Pedify, con el QR de Nequi para escanear o guardar.
    const plan = (await merchant.agent.get("/api/v1/subscription").expect(200)).body.data;
    expect(plan.directPayment.accounts.map((account: { kind: string }) => account.kind)).toEqual(["NEQUI", "BRE_B"]);
    expect(plan.directPayment.accounts[0]).toMatchObject({ accountKey: "300 123 4567", holderName: "Ana Pérez" });
    const png = await merchant.agent.get("/api/v1/subscription/payment-qr/NEQUI.png").expect(200);
    expect(png.headers["content-type"]).toBe("image/png");
    await merchant.agent.get("/api/v1/subscription/payment-qr/BRE_B.png").expect(404);

    const image = await nequiReceipt("$ 399.900");
    const sent = (await pay(merchant.agent, image).expect(201)).body.data;
    expect(sent).toMatchObject({ status: "PENDING", plan: "NEGOCIO", months: 1, amount: NEGOCIO_MONTH, method: "NEQUI", methodLabel: "Nequi" });
    expect(sent.reading).toEqual({ amount: NEGOCIO_MONTH, matchesTotal: true });

    // Un solo pago en revisión a la vez.
    expect((await pay(merchant.agent, image).expect(409)).body.error.code).toBe("TRANSFER_PENDING");
    expect((await merchant.agent.get("/api/v1/subscription").expect(200)).body.data.transfer).toMatchObject({ id: sent.id, status: "PENDING" });

    // El administrador lo ve revisado y le llega un correo.
    const review = await checked(admin.agent, sent.id);
    expect(review).toMatchObject({ checkStatus: "VERIFIED", business: { name: "Café El Puente" }, paidBy: { email: merchant.input.email.toLowerCase() } });
    expect(review.checks.find((check) => check.key === "amount")?.detail).toBe("$399.900, igual al valor del plan.");
    expect(mailer.outbox.find((mail) => mail.to === admin.input.email.toLowerCase())?.subject).toBe(
      "Pago por revisar: Café El Puente · plan Negocio 1 mes · $399.900 por Nequi",
    );
    const proof = await admin.agent.get(`/api/v1/admin/transfers/${sent.id}/image`).expect(200);
    expect(proof.headers["content-type"]).toBe("image/webp");
    expect((await admin.agent.get("/api/v1/admin/metrics").expect(200)).body.data.pendingTransfers).toBe(1);

    // Aprobado: el plan queda pagado un mes más y el negocio lo ve.
    await admin.agent.post(`/api/v1/admin/transfers/${sent.id}/approve`).expect(200);
    expect((await admin.agent.post(`/api/v1/admin/transfers/${sent.id}/approve`).expect(409)).body.error.code).toBe("TRANSFER_REVIEWED");
    const after = (await merchant.agent.get("/api/v1/subscription").expect(200)).body.data;
    expect(after.transfer).toMatchObject({ status: "APPROVED" });
    expect(after.paidUntil).not.toBeNull();
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0]).toMatchObject({ plan: "NEGOCIO", months: 1, amount: NEGOCIO_MONTH, method: "NEQUI" });
    expect(mailer.outbox.find((mail) => mail.to === merchant.input.email.toLowerCase())?.subject).toBe("Confirmamos tu pago de Pedify");

    // Ingresos en el panel central.
    const metrics = (await admin.agent.get("/api/v1/admin/metrics").expect(200)).body.data;
    expect(metrics).toMatchObject({ pendingTransfers: 0, revenue: { month: NEGOCIO_MONTH, total: NEGOCIO_MONTH, payments: 1 } });
    const payments = (await admin.agent.get("/api/v1/admin/payments").expect(200)).body.data;
    expect(payments.items[0]).toMatchObject({ amount: NEGOCIO_MONTH, method: "NEQUI", business: { name: "Café El Puente" }, recordedBy: { name: "Juan Pedify" } });

    // El mismo pantallazo otra vez: Pedify avisa que ya se usó.
    const again = (await pay(merchant.agent, image).expect(201)).body.data;
    const repeated = await checked(admin.agent, again.id);
    expect(repeated.checkStatus).toBe("MISMATCH");
    expect(repeated.checks.find((check) => check.key === "unique")?.detail).toMatch(/^Es el mismo pantallazo de otro pago de Café El Puente/);
  });

  it("rechazado: el plan no cambia, el negocio ve el motivo y puede cancelar o subir otro comprobante", async () => {
    const admin = await pedifyWithAccounts();
    const merchant = await registerMerchant();
    const sent = (await pay(merchant.agent, await nequiReceipt("$ 50.000"), "plan=NEGOCIO&months=12&method=BRE_B").expect(201)).body.data;
    expect(sent).toMatchObject({ months: 12, amount: 4_414_896, methodLabel: "Llave Bre-B", reading: { amount: 50_000, matchesTotal: false } });
    await checked(admin.agent, sent.id);

    await admin.agent.post(`/api/v1/admin/transfers/${sent.id}/reject`).send({}).expect(400);
    await admin.agent.post(`/api/v1/admin/transfers/${sent.id}/reject`).send({ reason: "El valor no coincide con el plan." }).expect(200);
    const plan = (await merchant.agent.get("/api/v1/subscription").expect(200)).body.data;
    expect(plan).toMatchObject({ paidUntil: null, payments: [], transfer: { status: "REJECTED", rejectReason: "El valor no coincide con el plan." } });
    expect(mailer.outbox.find((mail) => mail.to === merchant.input.email.toLowerCase())?.text).toContain("Motivo: El valor no coincide con el plan.");
    expect((await admin.agent.get("/api/v1/admin/transfers?status=REJECTED").expect(200)).body.data.total).toBe(1);

    // Sube otro y lo cancela (subió el equivocado).
    const second = (await pay(merchant.agent, await nequiReceipt("$ 399.900")).expect(201)).body.data;
    await merchant.agent.delete(`/api/v1/subscription/transfers/${second.id}`).expect(204);
    await merchant.agent.delete(`/api/v1/subscription/transfers/${second.id}`).expect(404);
    expect((await merchant.agent.get("/api/v1/subscription").expect(200)).body.data.transfer).toMatchObject({ status: "REJECTED" });
    await merchant.agent.delete(`/api/v1/subscription/transfers/${sent.id}`).expect(409);
  });
});
