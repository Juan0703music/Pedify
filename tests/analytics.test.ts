import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/config/database.js";
import { clock } from "../src/utils/clock.js";
import { addDays, dateIn, startOfDay } from "../src/utils/dates.js";
import { newAgent, registerMerchant } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

/** Viernes 16 de octubre de 2026, 8:00 p. m. en Colombia. */
const NOW = new Date("2026-10-16T20:00:00-05:00");

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(clock, "now").mockReturnValue(NOW);
});
afterEach(() => vi.restoreAllMocks());

type Status = "PENDING" | "CONFIRMED" | "PREPARING" | "READY" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";

/** Inserta un pedido directamente (con su hora de creación) para probar los cálculos. */
async function insertOrder(
  businessId: string,
  data: { at: string; status: Status; lines: { productId: string; name: string; price: number; quantity: number }[]; deliveryFee?: number; paid?: boolean },
) {
  const customer = await prisma.customer.upsert({
    where: { businessId_phone: { businessId, phone: "573001112233" } },
    create: { businessId, name: "Cliente", phone: "573001112233" },
    update: {},
  });
  const business = await prisma.business.update({ where: { id: businessId }, data: { lastOrderNumber: { increment: 1 } } });
  const subtotal = data.lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const deliveryFee = data.deliveryFee ?? 0;
  return prisma.order.create({
    data: {
      businessId,
      customerId: customer.id,
      number: business.lastOrderNumber,
      status: data.status,
      deliveryType: deliveryFee > 0 ? "DELIVERY" : "PICKUP",
      deliveryAddress: deliveryFee > 0 ? "Calle 1" : null,
      customerName: "Cliente",
      customerPhone: "573001112233",
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
      paidAt: data.paid ? new Date(data.at) : null,
      idempotencyKey: randomUUID(),
      createdAt: new Date(data.at),
      items: {
        create: data.lines.map((line) => ({
          productId: line.productId,
          productName: line.name,
          unitPrice: line.price,
          quantity: line.quantity,
          subtotal: line.price * line.quantity,
        })),
      },
    },
  });
}

async function setup() {
  const merchant = await registerMerchant();
  const product = async (name: string, price: number) => {
    const res = await merchant.agent.post("/api/v1/products").send({ name, price }).expect(201);
    return { productId: res.body.data.id as string, name, price };
  };
  return { ...merchant, hamburguesa: await product("Hamburguesa especial", 18000), bebida: await product("Bebida", 4000) };
}

describe("Fechas en la zona horaria de Colombia", () => {
  it("la conexión a PostgreSQL usa UTC, así las fechas se guardan como el instante correcto", async () => {
    const [row] = await prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
    expect(row?.tz).toBe("UTC");
    const [stored] = await prisma.$queryRaw<{ value: string }[]>`SELECT (${new Date("2026-10-16T12:34:56Z")}::timestamptz AT TIME ZONE 'UTC')::text AS value`;
    expect(stored?.value).toBe("2026-10-16 12:34:56");
  });

  it("calcula el inicio del día y la fecha local", () => {
    expect(startOfDay("2026-10-16", "America/Bogota").toISOString()).toBe("2026-10-16T05:00:00.000Z");
    expect(dateIn(new Date("2026-10-17T03:30:00Z"), "America/Bogota")).toBe("2026-10-16");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});

describe("Analíticas (sección 11)", () => {
  it("ventas del día, pedidos, ticket promedio y producto más vendido; los cancelados no cuentan como venta", async () => {
    const { agent, businessId, hamburguesa, bebida } = await setup();
    // Hoy (16 de octubre en Colombia)
    await insertOrder(businessId, { at: "2026-10-16T12:00:00-05:00", status: "DELIVERED", lines: [{ ...hamburguesa, quantity: 1 }, { ...bebida, quantity: 2 }], deliveryFee: 4000 });
    await insertOrder(businessId, { at: "2026-10-16T19:00:00-05:00", status: "CONFIRMED", lines: [{ ...bebida, quantity: 3 }] });
    await insertOrder(businessId, { at: "2026-10-16T19:30:00-05:00", status: "CANCELLED", lines: [{ ...hamburguesa, quantity: 5 }] });
    await insertOrder(businessId, { at: "2026-10-16T19:45:00-05:00", status: "PENDING", lines: [{ ...hamburguesa, quantity: 1 }] });
    // 23:30 del día anterior en Colombia = 04:30 UTC del 16: cuenta para el 15, no para hoy.
    await insertOrder(businessId, { at: "2026-10-15T23:30:00-05:00", status: "DELIVERED", lines: [{ ...hamburguesa, quantity: 1 }] });

    const res = await agent.get("/api/v1/analytics/summary").expect(200);
    const data = res.body.data;
    expect(data.range).toMatchObject({ from: "2026-10-16", to: "2026-10-16", timeZone: "America/Bogota" });
    expect(data.salesPolicy).toBe("ACCEPTED");
    // Aceptados: 30.000 (18.000 + 8.000 + 4.000 de domicilio) + 12.000.
    expect(data.sales).toBe(42000);
    expect(data.salesOrders).toBe(2);
    expect(data.averageTicket).toBe(21000);
    expect(data.orders).toEqual({ created: 4, pending: 1, accepted: 2, delivered: 1, cancelled: 1, paid: 0 });
    // Producto más vendido por unidades (la hamburguesa cancelada no cuenta).
    expect(data.topProduct).toMatchObject({ name: "Bebida", quantity: 5, revenue: 20000 });
    expect(data.byHour.find((entry: { hour: number }) => entry.hour === 19).orders).toBe(1);
    expect(data.previous).toMatchObject({ from: "2026-10-15", to: "2026-10-15", sales: 18000, salesOrders: 1 });
  });

  it("respeta la política de ventas del negocio: entregados o pagados", async () => {
    const { agent, businessId, hamburguesa, bebida } = await setup();
    await insertOrder(businessId, { at: "2026-10-16T12:00:00-05:00", status: "DELIVERED", lines: [{ ...hamburguesa, quantity: 1 }] });
    await insertOrder(businessId, { at: "2026-10-16T13:00:00-05:00", status: "READY", lines: [{ ...bebida, quantity: 1 }], paid: true });
    await insertOrder(businessId, { at: "2026-10-16T14:00:00-05:00", status: "CANCELLED", lines: [{ ...bebida, quantity: 1 }], paid: true });

    await agent.patch("/api/v1/businesses/current/settings").send({ salesPolicy: "DELIVERED" }).expect(200);
    expect((await agent.get("/api/v1/analytics/summary").expect(200)).body.data).toMatchObject({ sales: 18000, salesOrders: 1 });

    await agent.patch("/api/v1/businesses/current/settings").send({ salesPolicy: "PAID" }).expect(200);
    const paid = (await agent.get("/api/v1/analytics/summary").expect(200)).body.data;
    expect(paid).toMatchObject({ sales: 4000, salesOrders: 1 });
    expect(paid.orders.paid).toBe(1);
  });

  it("agrupa por día en un periodo e incluye los días sin ventas", async () => {
    const { agent, businessId, hamburguesa } = await setup();
    await insertOrder(businessId, { at: "2026-10-10T20:00:00-05:00", status: "DELIVERED", lines: [{ ...hamburguesa, quantity: 1 }] });
    await insertOrder(businessId, { at: "2026-10-12T23:59:00-05:00", status: "DELIVERED", lines: [{ ...hamburguesa, quantity: 2 }] });

    const res = await agent.get("/api/v1/analytics/summary?from=2026-10-10&to=2026-10-13").expect(200);
    expect(res.body.data.byDay).toEqual([
      { date: "2026-10-10", sales: 18000, orders: 1 },
      { date: "2026-10-11", sales: 0, orders: 0 },
      { date: "2026-10-12", sales: 36000, orders: 1 },
      { date: "2026-10-13", sales: 0, orders: 0 },
    ]);
    expect(res.body.data.sales).toBe(54000);

    const invalid = await agent.get("/api/v1/analytics/summary?from=2026-10-13&to=2026-10-10").expect(400);
    expect(invalid.body.error.fields.to).toBeDefined();
  });

  it("el resumen de hoy lo ve todo el equipo; las analíticas completas, solo el propietario", async () => {
    const { agent, businessId, hamburguesa } = await setup();
    await insertOrder(businessId, { at: "2026-10-16T18:00:00-05:00", status: "CONFIRMED", lines: [{ ...hamburguesa, quantity: 1 }] });
    const email = `empleado-${randomUUID()}@ejemplo.com`;
    await agent.post("/api/v1/businesses/current/members").send({ name: "Carlos", email, password: "clave-segura-123" }).expect(201);
    const employee = newAgent();
    await employee.post("/api/v1/auth/login").send({ email, password: "clave-segura-123" }).expect(200);

    const today = await employee.get("/api/v1/analytics/today").expect(200);
    expect(today.body.data).toMatchObject({ date: "2026-10-16", sales: 18000, created: 1, pending: 0, averageTicket: 18000 });
    expect(today.body.data.topProducts[0]).toMatchObject({ name: "Hamburguesa especial", quantity: 1 });
    await employee.get("/api/v1/analytics/summary").expect(403);
    await employee.get("/api/v1/customers").expect(403);
  });

  it("no mezcla datos de otros negocios", async () => {
    const a = await setup();
    const b = await registerMerchant({ businessName: "Pizzería Napoli" });
    await insertOrder(a.businessId, { at: "2026-10-16T12:00:00-05:00", status: "DELIVERED", lines: [{ ...a.hamburguesa, quantity: 1 }] });
    const res = await b.agent.get("/api/v1/analytics/summary").expect(200);
    expect(res.body.data).toMatchObject({ sales: 0, salesOrders: 0, topProduct: null });
  });
});

describe("Clientes", () => {
  it("lista clientes con sus compras y muestra su historial y direcciones", async () => {
    const { agent, businessId, hamburguesa } = await setup();
    await insertOrder(businessId, { at: "2026-10-14T12:00:00-05:00", status: "DELIVERED", lines: [{ ...hamburguesa, quantity: 2 }] });
    await insertOrder(businessId, { at: "2026-10-16T12:00:00-05:00", status: "CANCELLED", lines: [{ ...hamburguesa, quantity: 1 }] });
    const customer = await prisma.customer.findFirstOrThrow({ where: { businessId } });
    await prisma.customerAddress.create({ data: { customerId: customer.id, address: "Calle 20 #15-30", references: "Casa azul" } });

    const list = await agent.get("/api/v1/customers").expect(200);
    expect(list.body.data).toMatchObject({ total: 1, items: [{ id: customer.id, name: "Cliente", orders: 1, spent: 36000 }] });
    expect((await agent.get("/api/v1/customers?search=300111").expect(200)).body.data.total).toBe(1);
    expect((await agent.get("/api/v1/customers?search=zzz").expect(200)).body.data.total).toBe(0);

    const detail = await agent.get(`/api/v1/customers/${customer.id}`).expect(200);
    expect(detail.body.data).toMatchObject({
      phone: "573001112233",
      addresses: [{ address: "Calle 20 #15-30", references: "Casa azul" }],
      stats: { orders: 1, cancelled: 1, spent: 36000 },
    });
    expect(detail.body.data.orders).toHaveLength(2);

    const other = await registerMerchant({ businessName: "Pizzería Napoli" });
    await other.agent.get(`/api/v1/customers/${customer.id}`).expect(404);
    await other.agent.delete(`/api/v1/customers/${customer.id}`).expect(404);
  });

  it("suprime los datos personales del cliente y conserva los pedidos (Ley 1581)", async () => {
    const { agent, businessId, hamburguesa } = await setup();
    const order = await insertOrder(businessId, { at: "2026-10-14T12:00:00-05:00", status: "DELIVERED", lines: [{ ...hamburguesa, quantity: 1 }], deliveryFee: 4000 });
    const customer = await prisma.customer.findFirstOrThrow({ where: { businessId } });
    await prisma.customerAddress.create({ data: { customerId: customer.id, address: "Calle 20 #15-30" } });

    await agent.delete(`/api/v1/customers/${customer.id}`).expect(204);

    const anonymized = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(anonymized).toMatchObject({ customerName: "Cliente eliminado", customerPhone: "eliminado", deliveryAddress: "Dirección eliminada", total: 22000 });
    expect(await prisma.customerAddress.count({ where: { customerId: customer.id } })).toBe(0);
    expect((await agent.get("/api/v1/customers").expect(200)).body.data.total).toBe(0);
    // Las cifras del negocio no cambian.
    expect((await agent.get("/api/v1/analytics/summary?from=2026-10-14&to=2026-10-14").expect(200)).body.data.sales).toBe(22000);
  });
});
