import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { dataRetention } from "../src/services/data-retention.service.js";
import { savePrivateImage } from "../src/services/storage.service.js";
import { registerMerchant } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(resetDatabase);

const DAY = 86_400_000;
const fileOf = (key: string) => path.join(process.env.UPLOADS_DIR!, key);
const image = () => sharp({ create: { width: 40, height: 40, channels: 3, background: "#f4f0ff" } }).png().toBuffer();

/** Pedido con su comprobante, creado hace `ago` milisegundos. */
async function orderWithProof(businessId: string, ago: number) {
  const customer = await prisma.customer.upsert({
    where: { businessId_phone: { businessId, phone: "573001112233" } },
    create: { businessId, name: "Cliente", phone: "573001112233" },
    update: {},
  });
  const business = await prisma.business.update({ where: { id: businessId }, data: { lastOrderNumber: { increment: 1 } } });
  const createdAt = new Date(Date.now() - ago);
  const order = await prisma.order.create({
    data: {
      businessId,
      customerId: customer.id,
      number: business.lastOrderNumber,
      status: "DELIVERED",
      deliveryType: "PICKUP",
      customerName: "Cliente",
      customerPhone: "573001112233",
      subtotal: 30_000,
      deliveryFee: 0,
      total: 30_000,
      idempotencyKey: randomUUID(),
      createdAt,
    },
  });
  const imageKey = await savePrivateImage(await image(), "proof", `businesses/${businessId}/payment-proofs`);
  await prisma.paymentProof.create({ data: { businessId, orderId: order.id, imageKey, receiptText: "Para ANA PEREZ 300 123 4567", createdAt } });
  return { order, imageKey };
}

describe("Conservación de los comprobantes de pago", () => {
  it("borra los de los pedidos a los 180 días y la imagen de los de los planes a los 5 años", async () => {
    const { businessId } = await registerMerchant();
    const old = await orderWithProof(businessId, 181 * DAY);
    const recent = await orderWithProof(businessId, 30 * DAY);

    const planImage = await savePrivateImage(await image(), "proof", `businesses/${businessId}/plan-payments`);
    const plan = await prisma.planTransfer.create({
      data: { businessId, plan: "NEGOCIO", months: 1, amount: 399_900, method: "NEQUI", imageKey: planImage, receiptText: "Para JUAN", createdAt: new Date(Date.now() - 6 * 365 * DAY) },
    });

    expect(await dataRetention.run()).toEqual({ orderProofs: 1, planProofs: 1 });
    expect(await prisma.paymentProof.findFirst({ where: { orderId: old.order.id } })).toBeNull();
    expect(existsSync(fileOf(old.imageKey))).toBe(false);
    // El pedido viejo se queda (para las cuentas del negocio); solo se va el comprobante.
    expect(await prisma.order.findUnique({ where: { id: old.order.id } })).not.toBeNull();
    expect(await prisma.paymentProof.findFirst({ where: { orderId: recent.order.id } })).not.toBeNull();
    expect(existsSync(fileOf(recent.imageKey))).toBe(true);

    expect(await prisma.planTransfer.findUniqueOrThrow({ where: { id: plan.id } })).toMatchObject({ imageKey: "", receiptText: null });
    expect(existsSync(fileOf(planImage))).toBe(false);
    expect(await dataRetention.run()).toEqual({ orderProofs: 0, planProofs: 0 });
  });
});
