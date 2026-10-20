import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { login, newAgent, PASSWORD, registerMerchant, uniqueEmail } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(resetDatabase);

const HOME = { lat: 9.3047, lng: -75.3978 }; // Sincelejo

/** Negocio abierto todo el día con un producto y un pedido a domicilio con ubicación del cliente. */
async function deliveryOrder(extra: Record<string, unknown> = {}) {
  const merchant = await registerMerchant();
  const week = Array.from({ length: 7 }, (_, day) => ({ day, closed: false, open: "00:00", close: "23:59" }));
  await merchant.agent.patch("/api/v1/businesses/current/settings").send({ openingHours: week, paymentMethods: ["CASH"], deliveryFee: 4000 }).expect(200);
  const product = (await merchant.agent.post("/api/v1/products").send({ name: "Salchipapa", price: 15000 }).expect(201)).body.data;
  const slug = (await merchant.agent.get("/api/v1/businesses/current")).body.data.slug as string;
  const key = randomUUID();
  const order = (
    await newAgent()
      .post(`/api/v1/store/${slug}/orders`)
      .send({
        idempotencyKey: key,
        items: [{ productId: product.id, quantity: 2 }],
        name: "Laura Vergara",
        phone: "311 222 3344",
        deliveryType: "DELIVERY",
        address: "Calle 23 #18-40",
        references: "Casa de rejas blancas",
        paymentMethod: "CASH",
        location: HOME,
        ...extra,
      })
      .expect(201)
  ).body.data.order as { id: string; number: number };
  const advance = (status: string) => merchant.agent.patch(`/api/v1/orders/${order.id}/status`).send({ status }).expect(200);
  const track = () => newAgent().get(`/api/v1/store/${slug}/orders/${order.id}`).set("X-Order-Key", key).expect(200);
  return { ...merchant, slug, order, advance, track };
}

const linkKey = (url: string) => new URL(url).hash.slice(1);
const courier = (key: string) => ({
  view: () => newAgent().get("/api/v1/courier").set("X-Courier-Key", key),
  move: (point: Record<string, unknown>) => newAgent().post("/api/v1/courier/location").set("X-Courier-Key", key).send(point),
  delivered: () => newAgent().post("/api/v1/courier/delivered").set("X-Courier-Key", key),
});

describe("Seguimiento del domiciliario en el mapa", () => {
  it("guarda el punto que marcó el cliente solo en domicilios y valida las coordenadas", async () => {
    const { order, agent, track, slug } = await deliveryOrder();
    expect((await agent.get(`/api/v1/orders/${order.id}`).expect(200)).body.data).toMatchObject({ deliveryLat: HOME.lat, deliveryLng: HOME.lng });
    expect((await track()).body.data).toMatchObject({ destination: HOME, courier: null, map: { tileUrl: expect.stringContaining("{z}") } });

    const pickup = await deliveryOrder({ deliveryType: "PICKUP", address: "" });
    expect((await pickup.track()).body.data.destination).toBeNull();

    const product = (await newAgent().get(`/api/v1/store/${slug}`)).body.data.categories[0].products[0];
    const invalid = await newAgent()
      .post(`/api/v1/store/${slug}/orders`)
      .send({
        idempotencyKey: randomUUID(),
        items: [{ productId: product.id, quantity: 1 }],
        name: "Laura Vergara",
        phone: "311 222 3344",
        deliveryType: "DELIVERY",
        address: "Calle 23 #18-40",
        paymentMethod: "CASH",
        location: { lat: 120, lng: 0 },
      })
      .expect(400);
    expect(JSON.stringify(invalid.body.error.fields ?? invalid.body.error.details)).toContain("location");
  });

  it("el domiciliario comparte su ubicación con el enlace y el cliente la ve mientras va en camino", async () => {
    const { agent, order, advance, track } = await deliveryOrder();
    await advance("PREPARING");
    await advance("READY");
    const link = (await agent.post(`/api/v1/orders/${order.id}/courier-link`).expect(201)).body.data;
    expect(link.url).toMatch(/\/domicilio#[A-Za-z0-9_-]{43}$/);
    expect(link.qrSvg).toContain("<svg");
    const rider = courier(linkKey(link.url));

    const view = (await rider.view().expect(200)).body.data;
    expect(view).toMatchObject({
      number: order.number,
      status: "READY",
      customer: { name: "Laura Vergara", phone: "573112223344", address: "Calle 23 #18-40", references: "Casa de rejas blancas" },
      destination: HOME,
      total: 34000,
      paymentMethod: "CASH",
      position: null,
    });

    // Antes de salir no se comparte la ubicación.
    expect((await rider.move({ lat: 9.3, lng: -75.39 }).expect(409)).body.error.code).toBe("NOT_ON_THE_WAY");
    await advance("OUT_FOR_DELIVERY");
    await rider.move({ lat: 9.301, lng: -75.391, accuracy: 12.4, heading: 90 }).expect(204);
    await rider.move({ lat: 9.302, lng: -75.393, accuracy: 8 }).expect(204);
    expect((await track()).body.data.courier).toMatchObject({ lat: 9.302, lng: -75.393, accuracy: 8, updatedAt: expect.any(String) });
    await rider.move({ lat: 200, lng: 0 }).expect(400);

    // El panel también lo ve.
    expect((await agent.get(`/api/v1/orders/${order.id}`).expect(200)).body.data.courier).toMatchObject({ lat: 9.302, lng: -75.393 });
  });

  it("el domiciliario marca la entrega: el pedido se entrega y se borra la ubicación de todos", async () => {
    const { agent, order, advance, track } = await deliveryOrder();
    await advance("PREPARING");
    await advance("READY");
    await advance("OUT_FOR_DELIVERY");
    const rider = courier(linkKey((await agent.post(`/api/v1/orders/${order.id}/courier-link`).expect(201)).body.data.url));
    await rider.move({ lat: 9.301, lng: -75.391 }).expect(204);

    await rider.delivered().expect(204);
    const detail = (await agent.get(`/api/v1/orders/${order.id}`).expect(200)).body.data;
    expect(detail).toMatchObject({ status: "DELIVERED", deliveryLat: null, deliveryLng: null, courier: null });
    expect(detail.statusHistory.at(-1)).toMatchObject({ toStatus: "DELIVERED", note: "Entregado por el domiciliario", changedBy: null });
    expect((await track()).body.data).toMatchObject({ status: "DELIVERED", destination: null, courier: null });
    expect((await rider.view().expect(404)).body.error.code).toBe("COURIER_LINK_INVALID");
    expect(await prisma.courierTracking.count()).toBe(0);
  });

  it("un enlace nuevo reemplaza al anterior; claves falsas, pedidos para recoger y otros negocios no sirven", async () => {
    const { agent, order, advance } = await deliveryOrder();
    await advance("PREPARING");
    const first = linkKey((await agent.post(`/api/v1/orders/${order.id}/courier-link`).expect(201)).body.data.url);
    const second = linkKey((await agent.post(`/api/v1/orders/${order.id}/courier-link`).expect(201)).body.data.url);
    await courier(first).view().expect(404);
    await courier(second).view().expect(200);
    await newAgent().get("/api/v1/courier").set("X-Courier-Key", "x".repeat(43)).expect(404);
    await newAgent().get("/api/v1/courier").expect(404);

    // Un empleado puede despachar; otro negocio no ve el pedido.
    const email = uniqueEmail("empleado");
    await agent.post("/api/v1/businesses/current/members").send({ name: "Carlos", email, password: PASSWORD }).expect(201);
    await (await login(email)).post(`/api/v1/orders/${order.id}/courier-link`).expect(201);
    const other = await registerMerchant({ businessName: "Otro", businessPhone: "300 999 8877" });
    await other.agent.post(`/api/v1/orders/${order.id}/courier-link`).expect(404);

    const pickup = await deliveryOrder({ deliveryType: "PICKUP", address: "" });
    expect((await pickup.agent.post(`/api/v1/orders/${pickup.order.id}/courier-link`).expect(409)).body.error.code).toBe("NOT_DELIVERY");

    // Cancelado: el enlace deja de funcionar.
    await agent.patch(`/api/v1/orders/${order.id}/status`).send({ status: "CANCELLED" }).expect(200);
    await courier(second).view().expect(404);
    expect((await agent.post(`/api/v1/orders/${order.id}/courier-link`).expect(409)).body.error.code).toBe("ORDER_FINISHED");
  });

  it("la configuración del mapa es pública", async () => {
    const res = await newAgent().get("/api/v1/map-config").expect(200);
    expect(res.body.data).toEqual({ tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: expect.stringContaining("OpenStreetMap") });
  });
});
