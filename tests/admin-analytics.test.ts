import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { registerMerchant } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(resetDatabase);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function admin() {
  const merchant = await registerMerchant({ businessName: "Pedify Soporte" });
  await prisma.user.update({ where: { id: merchant.profile.user.id }, data: { isPlatformAdmin: true } });
  return merchant;
}

/** Pedido de $30.000 creado hace `ago` milisegundos (sin productos: solo cuentan la hora y el total). */
async function order(businessId: string, ago: number, status: "PENDING" | "DELIVERED" | "CANCELLED" = "DELIVERED") {
  const customer = await prisma.customer.upsert({
    where: { businessId_phone: { businessId, phone: "573001112233" } },
    create: { businessId, name: "Cliente", phone: "573001112233" },
    update: {},
  });
  const business = await prisma.business.update({ where: { id: businessId }, data: { lastOrderNumber: { increment: 1 } } });
  const createdAt = new Date(Date.now() - ago);
  await prisma.order.create({
    data: {
      businessId,
      customerId: customer.id,
      number: business.lastOrderNumber,
      status,
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
  return createdAt;
}

const bogota = (date: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", ...options }).format(date);

describe("Analíticas del panel central", () => {
  it("solo para administradores", async () => {
    const merchant = await registerMerchant();
    await merchant.agent.get("/api/v1/admin/analytics").expect(403);
  });

  it("ingresos y negocios por mes, pedidos por día y por hora, planes por estado y las tiendas con más pedidos", async () => {
    const { agent } = await admin();
    const cafe = await registerMerchant({ businessName: "Café El Puente" });
    const reino = await registerMerchant({ businessName: "El Reino de la Salchipapa" });

    const yesterday = await order(cafe.businessId, DAY);
    await order(cafe.businessId, DAY);
    await order(cafe.businessId, 2 * DAY, "CANCELLED");
    await order(reino.businessId, 3 * HOUR, "PENDING");
    await order(reino.businessId, 40 * DAY); // de los 30 días anteriores
    await agent.post(`/api/v1/admin/businesses/${cafe.businessId}/payments`).send({ months: 1, method: "NEQUI", plan: "NEGOCIO" }).expect(201);

    const data = (await agent.get("/api/v1/admin/analytics").expect(200)).body.data;

    // 12 meses, del más antiguo al actual: el pago y los 3 negocios caen en este mes.
    expect(data.months).toHaveLength(12);
    expect(data.months.at(-1)).toEqual({ month: bogota(new Date(), { year: "numeric", month: "2-digit" }), revenue: 399_900, payments: 1, newBusinesses: 3 });
    expect(data.months.slice(0, -1).every((month: { revenue: number }) => month.revenue === 0)).toBe(true);

    // 30 días hasta hoy: 4 pedidos; las ventas no cuentan el cancelado ni el que aún no se acepta.
    expect(data.days).toHaveLength(30);
    expect(data.days.at(-1).day).toBe(bogota(new Date(), { year: "numeric", month: "2-digit", day: "2-digit" }));
    const sum = (key: "orders" | "gmv") => data.days.reduce((total: number, day: Record<string, number>) => total + day[key]!, 0);
    expect(sum("orders")).toBe(4);
    expect(sum("gmv")).toBe(60_000);
    expect(data.previous).toEqual({ orders: 1, gmv: 30_000 });

    // Día de la semana (lunes = 0) × hora de Colombia.
    expect(data.hours.reduce((total: number, cell: { orders: number }) => total + cell.orders, 0)).toBe(4);
    const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(bogota(yesterday, { weekday: "short" }));
    const hour = Number(bogota(yesterday, { hour: "numeric", hourCycle: "h23" }));
    expect(data.hours).toContainEqual({ weekday, hour, orders: 2 });

    expect(data.plans).toContainEqual({ plan: "NEGOCIO", status: "ACTIVE", count: 1 });
    expect(data.plans).toContainEqual({ plan: "NEGOCIO", status: "TRIAL", count: 2 });
    expect(data.topStores.map((store: { name: string; orders: number }) => [store.name, store.orders])).toEqual([
      ["Café El Puente", 3],
      ["El Reino de la Salchipapa", 1],
    ]);
    expect(data.topStores[0].gmv).toBe(60_000);
  });
});
