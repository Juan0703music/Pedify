import http from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { attachSocket } from "../src/config/socket.js";
import { clock } from "../src/utils/clock.js";
import { newAgent, PASSWORD, sessionCookieFrom, uniqueEmail } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

let server: http.Server;
let live: ReturnType<typeof attachSocket>;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  server = http.createServer(createApp());
  live = attachSocket(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await live.close();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  await resetDatabase();
  // Martes 7:00 p. m. en Colombia: dentro del horario por defecto (11:00–22:00).
  vi.spyOn(clock, "now").mockReturnValue(new Date("2026-10-13T19:00:00-05:00"));
});

afterEach(() => {
  sockets.splice(0).forEach((socket) => socket.close());
  vi.restoreAllMocks();
});

/** Registra un comerciante y devuelve su cookie de sesión, su agente HTTP y el slug de su tienda. */
async function merchant(businessName: string, businessPhone: string) {
  const agent = newAgent();
  const res = await agent
    .post("/api/v1/auth/register")
    .send({ name: "Ana", email: uniqueEmail(), password: PASSWORD, businessName, businessPhone, acceptPrivacy: true })
    .expect(201);
  const slug = res.body.data.businesses[0].slug as string;
  const product = (await agent.post("/api/v1/products").send({ name: "Salchipapa", price: 15000 }).expect(201)).body.data;
  return { agent, cookie: `pedify_sid=${sessionCookieFrom(res)}`, slug, productId: product.id as string };
}

function open(headers: Record<string, string>) {
  const socket = connect(url, { transports: ["websocket"], extraHeaders: headers, reconnection: false, forceNew: true });
  sockets.push(socket);
  return socket;
}

const once = <T>(socket: Socket, event: string, timeout = 3000) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Sin evento ${event}`)), timeout);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const placeOrder = (slug: string, productId: string) =>
  newAgent()
    .post(`/api/v1/store/${slug}/orders`)
    .send({
      idempotencyKey: crypto.randomUUID(),
      items: [{ productId, quantity: 1 }],
      name: "Luis",
      phone: "311 222 3344",
      deliveryType: "PICKUP",
      paymentMethod: "CASH",
    })
    .expect(201);

describe("Pedidos en vivo (Socket.IO)", () => {
  it("rechaza conexiones sin sesión", async () => {
    const error = await once<Error>(open({}), "connect_error");
    expect(error.message).toBe("UNAUTHORIZED");
  });

  it("rechaza conexiones desde otro sitio web", async () => {
    const { cookie } = await merchant("Sabores del Caribe", "300 123 4567");
    const error = await once<Error>(open({ cookie, origin: "https://sitio-malicioso.com" }), "connect_error");
    expect(error).toBeInstanceOf(Error);
  });

  it("avisa de pedidos nuevos y cambios de estado solo al negocio que corresponde", async () => {
    const a = await merchant("Sabores del Caribe", "300 123 4567");
    const b = await merchant("Pizzería Napoli", "315 555 0101");
    const socketA = open({ cookie: a.cookie });
    const socketB = open({ cookie: b.cookie });
    await Promise.all([once(socketA, "ready"), once(socketB, "ready")]);

    let leaked = false;
    socketB.on("order:created", () => (leaked = true));

    const created = once<{ orderId: string; number: number; total: number; customerName: string }>(socketA, "order:created");
    const res = await placeOrder(a.slug, a.productId);
    expect(await created).toMatchObject({ orderId: res.body.data.order.id, number: 1, total: 15000, customerName: "Luis" });

    const updated = once<{ orderId: string; status: string }>(socketA, "order:updated");
    await a.agent.patch(`/api/v1/orders/${res.body.data.order.id}/status`).send({ status: "CONFIRMED" }).expect(200);
    expect(await updated).toMatchObject({ orderId: res.body.data.order.id, status: "CONFIRMED" });

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(leaked).toBe(false);
  });

  it("avisa a los demás dispositivos los cambios del menú y de la tienda", async () => {
    const a = await merchant("Sabores del Caribe", "300 123 4567");
    const b = await merchant("Pizzería Napoli", "315 555 0101");
    // El mismo negocio abierto en el computador y en el celular, y otro negocio aparte.
    const computer = open({ cookie: a.cookie });
    const phone = open({ cookie: a.cookie });
    const other = open({ cookie: b.cookie });
    await Promise.all([once(computer, "ready"), once(phone, "ready"), once(other, "ready")]);
    const received: unknown[] = [];
    phone.on("business:changed", (payload) => received.push(payload));
    let leaked = false;
    other.on("business:changed", () => (leaked = true));

    // Las consultas y los cambios rechazados no avisan nada.
    await a.agent.get("/api/v1/products").expect(200);
    await a.agent.post("/api/v1/products").set("X-Pedify-Client", "pestana-computador").send({ name: "" }).expect(400);

    const catalog = once(computer, "business:changed");
    await a.agent.patch(`/api/v1/products/${a.productId}`).set("X-Pedify-Client", "pestana-computador").send({ isAvailable: false }).expect(200);
    // La pestaña que hizo el cambio viene identificada para que no se recargue a sí misma.
    expect(await catalog).toEqual({ scope: "catalog", clientId: "pestana-computador" });

    const business = once(computer, "business:changed");
    await a.agent.patch("/api/v1/businesses/current/settings").send({ acceptingOrders: false }).expect(200);
    expect(await business).toEqual({ scope: "business", clientId: null });

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(received).toEqual([
      { scope: "catalog", clientId: "pestana-computador" },
      { scope: "business", clientId: null },
    ]);
    expect(leaked).toBe(false);
  });

  it("una sesión cerrada ya no puede conectarse", async () => {
    const { agent, cookie } = await merchant("Sabores del Caribe", "300 123 4567");
    await agent.post("/api/v1/auth/logout").expect(204);
    const error = await once<Error>(open({ cookie }), "connect_error");
    expect(error.message).toBe("UNAUTHORIZED");
  });
});
