import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/config/database.js";
import { buildOrderMessage } from "../src/modules/whatsapp/whatsapp.service.js";
import { calculateOrder } from "../src/services/pricing.service.js";
import { clock } from "../src/utils/clock.js";
import { newAgent, registerMerchant } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

/** Martes 13 de octubre de 2026, 7:00 p. m. en Colombia (el horario por defecto es 11:00–22:00). */
const TUESDAY_EVENING = new Date("2026-10-13T19:00:00-05:00");

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(clock, "now").mockReturnValue(TUESDAY_EVENING);
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Agent = Awaited<ReturnType<typeof registerMerchant>>["agent"];

/** Negocio del ejemplo del documento: domicilio $4.000, efectivo y Nequi, menú de 3 productos. */
async function setupStore(overrides: { businessName?: string; businessPhone?: string } = {}) {
  const merchant = await registerMerchant({ businessName: overrides.businessName ?? "Sabores del Caribe", ...overrides });
  const { agent } = merchant;
  await agent.patch("/api/v1/businesses/current/settings").send({ deliveryFee: 4000, paymentMethods: ["CASH", "NEQUI"] }).expect(200);
  const product = async (name: string, price: number, extra: Record<string, unknown> = {}) =>
    (await agent.post("/api/v1/products").send({ name, price, ...extra }).expect(201)).body.data as { id: string };
  const slug = (await agent.get("/api/v1/businesses/current")).body.data.slug as string;
  return {
    ...merchant,
    slug,
    hamburguesa: await product("Hamburguesa especial", 18000),
    bebida: await product("Bebida", 4000),
    salchipapa: await product("Salchipapa", 15000),
  };
}

function orderBody(items: { productId: string; quantity: number }[], extra: Record<string, unknown> = {}) {
  return {
    idempotencyKey: randomUUID(),
    items,
    name: "Luis Gómez",
    phone: "311 222 3344",
    deliveryType: "DELIVERY",
    address: "Calle 20 #15-30",
    paymentMethod: "CASH",
    ...extra,
  };
}

const placeOrder = (slug: string, body: Record<string, unknown>) => newAgent().post(`/api/v1/store/${slug}/orders`).send(body);

describe("Crear pedidos desde la tienda", () => {
  it("calcula el total en el servidor y genera el mensaje de WhatsApp de la sección 9", async () => {
    const { slug, hamburguesa, bebida, salchipapa, businessId } = await setupStore();

    const res = await placeOrder(slug, {
      ...orderBody([
        { productId: hamburguesa.id, quantity: 1 },
        { productId: bebida.id, quantity: 2 },
        { productId: salchipapa.id, quantity: 1 },
      ]),
      // Valores manipulados por el navegador: se ignoran.
      subtotal: 1,
      total: 1,
      deliveryFee: 0,
    }).expect(201);

    const { order, whatsapp } = res.body.data;
    expect(order).toMatchObject({
      number: 1,
      status: "PENDING",
      deliveryType: "DELIVERY",
      customerName: "Luis Gómez",
      customerPhone: "573112223344",
      deliveryAddress: "Calle 20 #15-30",
      paymentMethod: "CASH",
      subtotal: 41000,
      deliveryFee: 4000,
      discount: 0,
      total: 45000,
      whatsappOpenedAt: null,
    });
    expect(order.items).toEqual([
      { productId: hamburguesa.id, productName: "Hamburguesa especial", unitPrice: 18000, quantity: 1, subtotal: 18000 },
      { productId: bebida.id, productName: "Bebida", unitPrice: 4000, quantity: 2, subtotal: 8000 },
      { productId: salchipapa.id, productName: "Salchipapa", unitPrice: 15000, quantity: 1, subtotal: 15000 },
    ]);
    expect(order).not.toHaveProperty("idempotencyKey");

    const expectedMessage = [
      "¡Hola! Quiero realizar el siguiente pedido:",
      "",
      "Negocio: Sabores del Caribe",
      "Pedido: #1",
      "Nombre: Luis Gómez",
      "",
      "PRODUCTOS",
      "1. Hamburguesa especial x1 - $18.000",
      "2. Bebida x2 - $8.000",
      "3. Salchipapa x1 - $15.000",
      "",
      "Entrega: Domicilio",
      "Dirección: Calle 20 #15-30",
      "Pago: Efectivo",
      "",
      "Subtotal: $41.000",
      "Domicilio: $4.000",
      "TOTAL: $45.000",
      "",
      "¡Quedo atento a la confirmación!",
    ].join("\n");
    expect(whatsapp.message).toBe(expectedMessage);
    expect(whatsapp.url).toBe(`https://wa.me/573001234567?text=${encodeURIComponent(expectedMessage)}`);

    // Guardado de forma atómica: pedido, detalle, historial, cliente y dirección.
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id } });
    expect(history).toMatchObject([{ fromStatus: null, toStatus: "PENDING" }]);
    const customer = await prisma.customer.findFirst({ where: { businessId }, include: { addresses: true } });
    expect(customer).toMatchObject({ name: "Luis Gómez", phone: "573112223344", addresses: [{ address: "Calle 20 #15-30" }] });
  });

  it("recoger en el local no cobra domicilio ni guarda dirección", async () => {
    const { slug, salchipapa } = await setupStore();
    const res = await placeOrder(
      slug,
      orderBody([{ productId: salchipapa.id, quantity: 2 }], { deliveryType: "PICKUP", paymentMethod: "NEQUI", notes: "Sin cebolla" }),
    ).expect(201);

    expect(res.body.data.order).toMatchObject({ deliveryType: "PICKUP", deliveryAddress: null, deliveryFee: 0, subtotal: 30000, total: 30000 });
    const message: string = res.body.data.whatsapp.message;
    expect(message).toContain("Entrega: Recoger en el local\nPago: Nequi\nNotas: Sin cebolla");
    expect(message).not.toContain("Domicilio:");
    expect(message).not.toContain("Dirección:");
    expect(await prisma.customerAddress.count()).toBe(0);
  });

  it("suma las cantidades repetidas de un mismo producto", async () => {
    const { slug, bebida } = await setupStore();
    const res = await placeOrder(slug, orderBody([{ productId: bebida.id, quantity: 1 }, { productId: bebida.id, quantity: 2 }])).expect(201);
    expect(res.body.data.order.items).toMatchObject([{ productName: "Bebida", quantity: 3, subtotal: 12000 }]);
  });

  it("un reintento con la misma clave no duplica el pedido", async () => {
    const { slug, salchipapa, businessId } = await setupStore();
    const body = orderBody([{ productId: salchipapa.id, quantity: 1 }]);

    const first = await placeOrder(slug, body).expect(201);
    const retry = await placeOrder(slug, body).expect(200);
    expect(retry.body.data.order.id).toBe(first.body.data.order.id);
    expect(retry.body.data.whatsapp.url).toBe(first.body.data.whatsapp.url);
    expect(await prisma.order.count({ where: { businessId } })).toBe(1);

    const another = await placeOrder(slug, orderBody([{ productId: salchipapa.id, quantity: 1 }])).expect(201);
    expect(another.body.data.order.number).toBe(2);
  });

  it("los números de pedido son consecutivos por negocio", async () => {
    const a = await setupStore({ businessName: "Sabores del Caribe" });
    const b = await setupStore({ businessName: "Pizzería Napoli", businessPhone: "315 555 0101" });
    await placeOrder(a.slug, orderBody([{ productId: a.salchipapa.id, quantity: 1 }])).expect(201);
    await placeOrder(a.slug, orderBody([{ productId: a.salchipapa.id, quantity: 1 }])).expect(201);
    const first = await placeOrder(b.slug, orderBody([{ productId: b.salchipapa.id, quantity: 1 }])).expect(201);
    expect(first.body.data.order.number).toBe(1);
    expect(first.body.data.whatsapp.url).toContain("https://wa.me/573155550101?text=");
  });

  it("guarda un cliente por celular y no repite direcciones", async () => {
    const { slug, salchipapa, businessId } = await setupStore();
    const item = [{ productId: salchipapa.id, quantity: 1 }];
    await placeOrder(slug, orderBody(item, { name: "Luis", address: "Calle 20 #15-30" })).expect(201);
    await placeOrder(slug, orderBody(item, { name: "Luis Gómez", phone: "+57 311-222-3344", address: "calle 20 #15-30", references: "Casa azul" })).expect(201);
    await placeOrder(slug, orderBody(item, { name: "Luis Gómez", address: "Carrera 25 #10-12" })).expect(201);

    const customers = await prisma.customer.findMany({ where: { businessId }, include: { addresses: { orderBy: { createdAt: "asc" } } } });
    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({
      name: "Luis Gómez",
      addresses: [
        { address: "Calle 20 #15-30", references: "Casa azul" },
        { address: "Carrera 25 #10-12", references: null },
      ],
    });
  });
});

describe("Validaciones del pedido", () => {
  it("pide los datos del cliente y la dirección para domicilio", async () => {
    const { slug, salchipapa } = await setupStore();
    const res = await placeOrder(slug, {
      ...orderBody([{ productId: salchipapa.id, quantity: 0 }]),
      name: "",
      phone: "12345",
      address: "",
    }).expect(400);
    expect(res.body.error.fields).toMatchObject({
      name: expect.any(String),
      phone: expect.any(String),
      address: "Escribe la dirección de entrega.",
      "items.0.quantity": expect.any(String),
    });

    const empty = await placeOrder(slug, orderBody([])).expect(400);
    expect(empty.body.error.fields.items).toMatch(/vacío/);
  });

  it("rechaza productos agotados, ocultos, archivados o de otro negocio", async () => {
    const { slug, agent, salchipapa, bebida, hamburguesa, businessId } = await setupStore();
    const other = await setupStore({ businessName: "Pizzería Napoli", businessPhone: "315 555 0101" });
    await agent.patch(`/api/v1/products/${bebida.id}`).send({ isAvailable: false }).expect(200);
    await agent.patch(`/api/v1/products/${hamburguesa.id}`).send({ isActive: false }).expect(200);
    await prisma.product.update({ where: { id: salchipapa.id }, data: { archivedAt: new Date() } });

    for (const productId of [bebida.id, hamburguesa.id, salchipapa.id, other.salchipapa.id, randomUUID()]) {
      const res = await placeOrder(slug, orderBody([{ productId, quantity: 1 }])).expect(409);
      expect(res.body.error.code).toBe("PRODUCTS_UNAVAILABLE");
    }
    const soldOut = await placeOrder(slug, orderBody([{ productId: bebida.id, quantity: 1 }])).expect(409);
    expect(soldOut.body.error.message).toContain("Bebida");
    expect(await prisma.order.count({ where: { businessId } })).toBe(0);
  });

  it("aplica las reglas del negocio: modalidad, método de pago y pedido mínimo", async () => {
    const { slug, agent, salchipapa } = await setupStore();
    const item = [{ productId: salchipapa.id, quantity: 1 }];

    const card = await placeOrder(slug, orderBody(item, { paymentMethod: "CARD" })).expect(400);
    expect(card.body.error.code).toBe("PAYMENT_METHOD_NOT_ACCEPTED");

    await agent.patch("/api/v1/businesses/current/settings").send({ minimumOrder: 20000 }).expect(200);
    const minimum = await placeOrder(slug, orderBody(item)).expect(400);
    expect(minimum.body.error).toMatchObject({ code: "MINIMUM_ORDER", message: "El pedido mínimo es $20.000 (sin domicilio). Te faltan $5.000." });

    await agent.patch("/api/v1/businesses/current/settings").send({ minimumOrder: 0, deliveryEnabled: false }).expect(200);
    const delivery = await placeOrder(slug, orderBody(item)).expect(400);
    expect(delivery.body.error.code).toBe("DELIVERY_UNAVAILABLE");
    await placeOrder(slug, orderBody(item, { deliveryType: "PICKUP" })).expect(201);
  });

  it("no recibe pedidos con el negocio cerrado, en pausa o sin WhatsApp", async () => {
    const { slug, agent, salchipapa, businessId } = await setupStore();
    const item = [{ productId: salchipapa.id, quantity: 1 }];

    vi.spyOn(clock, "now").mockReturnValue(new Date("2026-10-13T23:00:00-05:00"));
    const closed = await placeOrder(slug, orderBody(item)).expect(409);
    expect(closed.body.error).toMatchObject({
      code: "STORE_CLOSED",
      message: "El negocio está cerrado en este momento; abre mañana a las 11:00 a. m.",
    });
    const store = await newAgent().get(`/api/v1/store/${slug}`).expect(200);
    expect(store.body.data.status).toMatchObject({ isOpen: false, canOrder: false });

    vi.spyOn(clock, "now").mockReturnValue(TUESDAY_EVENING);
    await agent.patch("/api/v1/businesses/current/settings").send({ acceptingOrders: false }).expect(200);
    expect((await placeOrder(slug, orderBody(item)).expect(409)).body.error.code).toBe("ORDERS_PAUSED");

    await agent.patch("/api/v1/businesses/current/settings").send({ acceptingOrders: true }).expect(200);
    await prisma.businessSettings.update({ where: { businessId }, data: { whatsappPhone: null } });
    expect((await placeOrder(slug, orderBody(item)).expect(409)).body.error.code).toBe("WHATSAPP_NOT_CONFIGURED");

    await newAgent().post("/api/v1/store/no-existe/orders").send(orderBody(item)).expect(404);
  });

  it("rechaza pedidos enviados desde otro sitio web", async () => {
    const { slug, salchipapa } = await setupStore();
    await newAgent()
      .post(`/api/v1/store/${slug}/orders`)
      .set("Origin", "https://sitio-malicioso.com")
      .send(orderBody([{ productId: salchipapa.id, quantity: 1 }]))
      .expect(403);
  });
});

describe("Apertura de WhatsApp", () => {
  it("registra cuándo el cliente abrió WhatsApp solo con la clave del pedido", async () => {
    const { slug, salchipapa } = await setupStore();
    const body = orderBody([{ productId: salchipapa.id, quantity: 1 }]);
    const { order } = (await placeOrder(slug, body).expect(201)).body.data;

    await newAgent().post(`/api/v1/store/${slug}/orders/${order.id}/whatsapp`).send({ idempotencyKey: randomUUID() }).expect(404);
    expect((await prisma.order.findUnique({ where: { id: order.id } }))?.whatsappOpenedAt).toBeNull();

    await newAgent().post(`/api/v1/store/${slug}/orders/${order.id}/whatsapp`).send({ idempotencyKey: body.idempotencyKey }).expect(204);
    const opened = await prisma.order.findUnique({ where: { id: order.id } });
    expect(opened?.whatsappOpenedAt).toBeInstanceOf(Date);
    // Abrir WhatsApp no cambia el estado: sigue pendiente hasta que el negocio lo acepte.
    expect(opened?.status).toBe("PENDING");
  });
});

describe("Cálculo y mensaje", () => {
  it("el descuento se resta del total y nunca lo deja negativo", () => {
    const product = { id: "p", name: "Pizza", price: 30000 };
    expect(calculateOrder({ items: [{ product, quantity: 2 }], deliveryType: "DELIVERY", deliveryFee: 4000, discount: 5000 })).toMatchObject({
      subtotal: 60000,
      deliveryFee: 4000,
      discount: 5000,
      total: 59000,
    });
    expect(calculateOrder({ items: [{ product, quantity: 1 }], deliveryType: "PICKUP", deliveryFee: 4000, discount: 99999 })).toMatchObject({
      deliveryFee: 0,
      discount: 30000,
      total: 0,
    });
  });

  it("el mensaje incluye referencias y descuento cuando existen", () => {
    const message = buildOrderMessage({
      businessName: "Pizzería Napoli",
      number: 7,
      customerName: "Ana",
      items: [{ name: "Pizza", quantity: 2, subtotal: 60000 }],
      deliveryType: "DELIVERY",
      deliveryAddress: "Cra 25 #10-12",
      addressReferences: "Portón negro",
      paymentMethod: "DAVIPLATA",
      notes: null,
      subtotal: 60000,
      deliveryFee: 4000,
      discount: 5000,
      total: 59000,
    });
    expect(message).toContain("Dirección: Cra 25 #10-12\nReferencias: Portón negro\nPago: Daviplata");
    expect(message).toContain("Subtotal: $60.000\nDomicilio: $4.000\nDescuento: -$5.000\nTOTAL: $59.000");
  });
});

describe("Panel: atención de pedidos", () => {
  async function storeWithOrder(extra: Record<string, unknown> = {}) {
    const store = await setupStore();
    const res = await placeOrder(store.slug, orderBody([{ productId: store.hamburguesa.id, quantity: 2 }], extra)).expect(201);
    return { ...store, order: res.body.data.order as { id: string; number: number } };
  }

  it("lista los pedidos en curso y muestra el detalle con los siguientes estados posibles", async () => {
    const { agent, order } = await storeWithOrder();
    const list = await agent.get("/api/v1/orders").expect(200);
    expect(list.body.data).toMatchObject({ total: 1, items: [{ id: order.id, number: 1, status: "PENDING", total: 40000 }] });

    const detail = await agent.get(`/api/v1/orders/${order.id}`).expect(200);
    expect(detail.body.data).toMatchObject({
      status: "PENDING",
      nextStatuses: ["CONFIRMED", "CANCELLED"],
      statusHistory: [{ fromStatus: null, toStatus: "PENDING", changedBy: null }],
    });
  });

  it("avanza por los estados y registra quién hizo cada cambio", async () => {
    const { agent, order, profile } = await storeWithOrder();
    for (const status of ["CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"]) {
      const res = await agent.patch(`/api/v1/orders/${order.id}/status`).send({ status }).expect(200);
      expect(res.body.data.status).toBe(status);
    }
    const detail = (await agent.get(`/api/v1/orders/${order.id}`).expect(200)).body.data;
    expect(detail.nextStatuses).toEqual([]);
    expect(detail.statusHistory.map((entry: { toStatus: string }) => entry.toStatus)).toEqual([
      "PENDING",
      "CONFIRMED",
      "PREPARING",
      "READY",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
    ]);
    expect(detail.statusHistory[1].changedBy).toEqual({ name: profile.user.name });

    // Ya entregado: sale de "en curso" y aparece en el historial.
    expect((await agent.get("/api/v1/orders").expect(200)).body.data.total).toBe(0);
    const history = await agent.get("/api/v1/orders?view=history").expect(200);
    expect(history.body.data.items.map((item: { id: string }) => item.id)).toEqual([order.id]);
  });

  it("rechaza saltos no permitidos y «en camino» para pedidos de recoger", async () => {
    const { agent, order } = await storeWithOrder({ deliveryType: "PICKUP" });
    const skip = await agent.patch(`/api/v1/orders/${order.id}/status`).send({ status: "DELIVERED" }).expect(400);
    expect(skip.body.error.code).toBe("INVALID_TRANSITION");

    await agent.patch(`/api/v1/orders/${order.id}/status`).send({ status: "CONFIRMED" }).expect(200);
    await agent.patch(`/api/v1/orders/${order.id}/status`).send({ status: "READY" }).expect(200);
    const outForDelivery = await agent.patch(`/api/v1/orders/${order.id}/status`).send({ status: "OUT_FOR_DELIVERY" }).expect(400);
    expect(outForDelivery.body.error.code).toBe("INVALID_TRANSITION");
    await agent.patch(`/api/v1/orders/${order.id}/status`).send({ status: "DELIVERED" }).expect(200);
  });

  it("si otra persona ya cambió el pedido, avisa en lugar de sobrescribir", async () => {
    const { agent, order } = await storeWithOrder();
    await agent.patch(`/api/v1/orders/${order.id}/status`).send({ status: "CONFIRMED", from: "PENDING" }).expect(200);
    const stale = await agent.patch(`/api/v1/orders/${order.id}/status`).send({ status: "CANCELLED", from: "PENDING" }).expect(409);
    expect(stale.body.error.code).toBe("STATUS_CHANGED");
  });

  it("cancela con motivo y no permite marcar como pagado un pedido cancelado", async () => {
    const { agent, order } = await storeWithOrder();
    const cancelled = await agent
      .patch(`/api/v1/orders/${order.id}/status`)
      .send({ status: "CANCELLED", reason: "El cliente no respondió" })
      .expect(200);
    expect(cancelled.body.data).toMatchObject({ status: "CANCELLED", cancelReason: "El cliente no respondió" });
    const paid = await agent.patch(`/api/v1/orders/${order.id}/payment`).send({ paid: true }).expect(400);
    expect(paid.body.error.code).toBe("ORDER_CANCELLED");
  });

  it("marca y desmarca el pago", async () => {
    const { agent, order } = await storeWithOrder();
    const paid = await agent.patch(`/api/v1/orders/${order.id}/payment`).send({ paid: true }).expect(200);
    expect(paid.body.data.paidAt).toEqual(expect.any(String));
    const unpaid = await agent.patch(`/api/v1/orders/${order.id}/payment`).send({ paid: false }).expect(200);
    expect(unpaid.body.data.paidAt).toBeNull();
  });

  it("los empleados atienden pedidos; otro negocio no los ve ni los cambia", async () => {
    const { agent, order } = await storeWithOrder();
    const email = `empleado-${randomUUID()}@ejemplo.com`;
    await agent.post("/api/v1/businesses/current/members").send({ name: "Carlos", email, password: "clave-segura-123" }).expect(201);
    const employee = newAgent();
    await employee.post("/api/v1/auth/login").send({ email, password: "clave-segura-123" }).expect(200);
    await employee.patch(`/api/v1/orders/${order.id}/status`).send({ status: "CONFIRMED" }).expect(200);

    const other = await registerMerchant({ businessName: "Pizzería Napoli" });
    await other.agent.get(`/api/v1/orders/${order.id}`).expect(404);
    await other.agent.patch(`/api/v1/orders/${order.id}/status`).send({ status: "CANCELLED" }).expect(404);
    await other.agent.patch(`/api/v1/orders/${order.id}/payment`).send({ paid: true }).expect(404);
    expect((await other.agent.get("/api/v1/orders").expect(200)).body.data.total).toBe(0);
  });

  it("busca en el historial por nombre, celular o número de pedido", async () => {
    const { agent, slug, salchipapa } = await setupStore();
    const create = async (name: string, phone: string) =>
      (await placeOrder(slug, orderBody([{ productId: salchipapa.id, quantity: 1 }], { name, phone })).expect(201)).body.data.order.id as string;
    const ids = [await create("Ana Ruiz", "300 111 2233"), await create("Luis Gómez", "311 222 3344")];
    for (const id of ids) await agent.patch(`/api/v1/orders/${id}/status`).send({ status: "CANCELLED" }).expect(200);

    const byName = await agent.get("/api/v1/orders?view=history&search=ana").expect(200);
    expect(byName.body.data.items.map((item: { customerName: string }) => item.customerName)).toEqual(["Ana Ruiz"]);
    const byPhone = await agent.get("/api/v1/orders?view=history&search=3112223344").expect(200);
    expect(byPhone.body.data.items.map((item: { customerName: string }) => item.customerName)).toEqual(["Luis Gómez"]);
    const byNumber = await agent.get("/api/v1/orders?view=history&search=%231").expect(200);
    expect(byNumber.body.data.items.map((item: { number: number }) => item.number)).toEqual([1]);
  });
});
