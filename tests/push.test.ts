import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { pushService } from "../src/modules/push/push.service.js";
import { isPushServiceUrl } from "../src/modules/push/push.schemas.js";
import { login, newAgent, PASSWORD, registerMerchant, uniqueEmail } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

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

const device = (name: string = randomUUID()) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
  keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
});

/** Negocio abierto todo el día con un producto (para crear pedidos). */
async function openStore() {
  const merchant = await registerMerchant();
  const week = Array.from({ length: 7 }, (_, day) => ({ day, closed: false, open: "00:00", close: "23:59" }));
  await merchant.agent.patch("/api/v1/businesses/current/settings").send({ openingHours: week, paymentMethods: ["CASH"] }).expect(200);
  const product = (await merchant.agent.post("/api/v1/products").send({ name: "Salchipapa", price: 15000 }).expect(201)).body.data;
  const slug = (await merchant.agent.get("/api/v1/businesses/current")).body.data.slug as string;
  return { ...merchant, product, slug };
}

const placeOrder = (slug: string, productId: string) =>
  newAgent()
    .post(`/api/v1/store/${slug}/orders`)
    .send({ idempotencyKey: randomUUID(), items: [{ productId, quantity: 2 }], name: "Laura Vergara", phone: "311 222 3344", deliveryType: "PICKUP", paymentMethod: "CASH" })
    .expect(201);

/** Los avisos se envían sin bloquear la respuesta del pedido: se espera a que terminen. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe("Avisos push de pedidos nuevos", () => {
  it("entrega la llave pública y registra el dispositivo de la persona en su negocio", async () => {
    const { agent } = await registerMerchant();
    const key = await agent.get("/api/v1/push/public-key").expect(200);
    expect(key.body.data).toEqual({ enabled: true, publicKey: process.env.VAPID_PUBLIC_KEY });

    const res = await agent.post("/api/v1/push/subscriptions").send(device()).expect(201);
    expect(res.body.data).toEqual({ devices: 1 });
    // Volver a activar en el mismo navegador no duplica.
    const again = device("mismo");
    await agent.post("/api/v1/push/subscriptions").send(again).expect(201);
    await agent.post("/api/v1/push/subscriptions").send(again).expect(201);
    expect(await prisma.pushSubscription.count()).toBe(2);

    await newAgent().get("/api/v1/push/public-key").expect(401);
  });

  it("solo acepta direcciones de los servicios de push de los navegadores", async () => {
    const { agent } = await registerMerchant();
    for (const endpoint of ["http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://evil.com/fcm.googleapis.com", "https://fcm.googleapis.com.evil.com/x"]) {
      await agent.post("/api/v1/push/subscriptions").send({ ...device(), endpoint }).expect(400);
    }
    expect(isPushServiceUrl("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isPushServiceUrl("https://web.push.apple.com/abc")).toBe(true);
    expect(isPushServiceUrl("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
  });

  it("al llegar un pedido avisa a todo el equipo del negocio y a nadie más", async () => {
    const { agent, slug, product } = await openStore();
    const ownerDevice = device("propietario");
    await agent.post("/api/v1/push/subscriptions").send(ownerDevice).expect(201);
    const employeeEmail = uniqueEmail("empleado");
    await agent.post("/api/v1/businesses/current/members").send({ name: "Carlos Mesa", email: employeeEmail, password: PASSWORD }).expect(201);
    const employee = await login(employeeEmail);
    const employeeDevice = device("empleado");
    await employee.post("/api/v1/push/subscriptions").send(employeeDevice).expect(201);
    const other = await registerMerchant({ businessName: "Otro negocio", businessPhone: "300 999 8877" });
    await other.agent.post("/api/v1/push/subscriptions").send(device("otro")).expect(201);

    const { order } = (await placeOrder(slug, product.id)).body.data;
    await settle();

    expect(sent.map((item) => item.endpoint).sort()).toEqual([employeeDevice.endpoint, ownerDevice.endpoint].sort());
    expect(sent[0]?.payload).toEqual({
      title: `Nuevo pedido #${order.number}`,
      body: "Laura · Para recoger · $30.000",
      url: `/panel/pedidos?pedido=${order.id}`,
      tag: `pedido-${order.id}`,
    });
  });

  it("quien deja el equipo deja de recibir avisos; los dispositivos que ya no existen se borran", async () => {
    const { agent, slug, product } = await openStore();
    const employeeEmail = uniqueEmail("empleado");
    const member = (await agent.post("/api/v1/businesses/current/members").send({ name: "Carlos Mesa", email: employeeEmail, password: PASSWORD }).expect(201)).body.data;
    const employee = await login(employeeEmail);
    await employee.post("/api/v1/push/subscriptions").send(device("empleado")).expect(201);
    const gone = device("desinstalado");
    await agent.post("/api/v1/push/subscriptions").send(gone).expect(201);

    await agent.delete(`/api/v1/businesses/current/members/${member.id}`).expect(204);
    pushService.transport = async (subscription) => {
      if (subscription.endpoint === gone.endpoint) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse("{}") });
    };
    await placeOrder(slug, product.id);
    await settle();

    expect(sent).toEqual([]);
    expect(await prisma.pushSubscription.findUnique({ where: { endpoint: gone.endpoint } })).toBeNull();
  });

  it("prueba, desactivación y cierre de sesión en todos los dispositivos", async () => {
    const { agent } = await registerMerchant();
    const phone = device("celular");
    const laptop = device("computador");
    await agent.post("/api/v1/push/subscriptions").send(phone).expect(201);
    await agent.post("/api/v1/push/subscriptions").send(laptop).expect(201);

    const test = await agent.post("/api/v1/push/test").expect(200);
    expect(test.body.data).toEqual({ sent: 2, devices: 2 });
    expect(sent[0]?.payload.title).toBe("Pedify: avisos activados");

    await agent.delete("/api/v1/push/subscriptions").send({ endpoint: phone.endpoint }).expect(204);
    expect(await prisma.pushSubscription.count()).toBe(1);

    await agent.post("/api/v1/auth/logout-all").expect(204);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });
});
