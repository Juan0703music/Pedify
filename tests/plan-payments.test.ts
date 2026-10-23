import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/config/database.js";
import { env } from "../src/config/env.js";
import { addMonths } from "../src/modules/subscriptions/subscription-state.js";
import { notifications } from "../src/services/notification.service.js";
import { wompi } from "../src/services/wompi.service.js";
import { login, newAgent, PASSWORD, registerMerchant, uniqueEmail } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

type Agent = ReturnType<typeof newAgent>;
interface Checkout {
  id: string;
  amount: number;
  url: string;
}

let sequence = 0;

/** Transacción de Wompi para un cobro (aprobada con Nequi, salvo que se cambie). */
const transactionFor = (checkout: { id: string; amount: number }, overrides: Record<string, unknown> = {}) => ({
  id: `1292-1761184000-${++sequence}`,
  amount_in_cents: checkout.amount * 100,
  reference: checkout.id,
  customer_email: "ana@ejemplo.com",
  currency: "COP",
  payment_method_type: "NEQUI",
  redirect_url: "http://localhost:3000/panel/plan",
  status: "APPROVED",
  ...overrides,
});

/** Evento firmado como lo envía Wompi: SHA-256 de las propiedades, el timestamp y el secreto de eventos. */
function signedEvent(transaction: Record<string, unknown>, secret = process.env.WOMPI_EVENTS_SECRET!) {
  const timestamp = 1_761_184_000;
  const properties = ["transaction.id", "transaction.status", "transaction.amount_in_cents"];
  const values = properties.map((path) => transaction[path.split(".")[1]!]);
  return {
    event: "transaction.updated",
    data: { transaction },
    environment: "test",
    signature: { properties, checksum: sha256(`${values.join("")}${timestamp}${secret}`).toUpperCase() },
    timestamp,
    sent_at: "2026-10-23T02:00:00.000Z",
  };
}

const sendEvent = (event: unknown) => newAgent().post("/api/v1/webhooks/wompi").send(event as object);

async function startCheckout(agent: Agent, body: Record<string, unknown> = { plan: "EMPRENDEDOR", months: 1 }) {
  return (await agent.post("/api/v1/subscription/checkouts").send(body).expect(201)).body.data as Checkout;
}

const confirm = (agent: Agent, checkoutId: string, transactionId?: string) =>
  agent.post(`/api/v1/subscription/checkouts/${checkoutId}/confirm`).send(transactionId ? { transactionId } : {});

const paymentsOf = (businessId: string) => prisma.subscriptionPayment.findMany({ where: { businessId } });

describe("Firmas de Wompi", () => {
  it("coinciden con los ejemplos de la documentación de Wompi", () => {
    const original = { ...env };
    try {
      // Secretos de ejemplo publicados en docs.wompi.co (no son de ninguna cuenta).
      env.WOMPI_INTEGRITY_SECRET = "prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6";
      env.WOMPI_EVENTS_SECRET = "prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z";
      expect(wompi.integritySignature("sk8-438k4-xmxm392-sn2m", 2_490_000)).toBe("37c8407747e595535433ef8f6a811d853cd943046624a0ec04662b17bbf33bf5");
      // Eventos: la cadena del paso 3 del ejemplo («1234-1610641025-49201APPROVED44900001530291411prod_events_…»).
      // La suma que muestra el ejemplo no corresponde a esa cadena, así que se compara con su SHA-256.
      const event = {
        event: "transaction.updated",
        data: { transaction: { id: "1234-1610641025-49201", status: "APPROVED", amount_in_cents: 4_490_000 } },
        signature: {
          properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
          checksum: sha256("1234-1610641025-49201APPROVED44900001530291411prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z").toUpperCase(),
        },
        timestamp: 1_530_291_411,
      };
      expect(wompi.verifyEvent(event)).toBe(true);
      expect(wompi.verifyEvent({ ...event, timestamp: 1_530_291_412 })).toBe(false);
    } finally {
      Object.assign(env, original);
    }
  });
});

describe("Pago del plan en línea con Wompi", () => {
  it("crea el cobro con el enlace firmado al Web Checkout de Wompi", async () => {
    const { agent, input } = await registerMerchant();
    expect((await agent.get("/api/v1/subscription").expect(200)).body.data.onlinePayment).toEqual({ provider: "WOMPI", sandbox: true });

    const checkout = await startCheckout(agent, { plan: "EMPRESA", months: 12 });
    expect(checkout.amount).toBe(9_118_860);
    const url = new URL(checkout.url);
    expect(`${url.origin}${url.pathname}`).toBe("https://checkout.wompi.co/p/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      "public-key": process.env.WOMPI_PUBLIC_KEY,
      currency: "COP",
      "amount-in-cents": "911886000",
      reference: checkout.id,
      "signature:integrity": sha256(`${checkout.id}911886000COP${process.env.WOMPI_INTEGRITY_SECRET}`),
      "redirect-url": `http://localhost:3000/panel/plan?pago=${checkout.id}`,
      "customer-data:email": input.email,
      "customer-data:full-name": "Ana Pérez",
    });
    expect(await prisma.planCheckout.findUniqueOrThrow({ where: { id: checkout.id } })).toMatchObject({
      plan: "EMPRESA",
      months: 12,
      amount: 9_118_860,
      status: "PENDING",
      paymentId: null,
    });

    // Un mes o el año completo; solo los planes que existen.
    await agent.post("/api/v1/subscription/checkouts").send({ plan: "EMPRESA", months: 3 }).expect(400);
    await agent.post("/api/v1/subscription/checkouts").send({ plan: "GRATIS", months: 1 }).expect(400);
  });

  it("el aviso de Wompi aprueba el pago y extiende el plan una sola vez", async () => {
    const { agent, businessId } = await registerMerchant();
    const { trialEndsAt } = await prisma.subscription.findUniqueOrThrow({ where: { businessId } });
    const checkout = await startCheckout(agent);
    const transaction = transactionFor(checkout);
    const changed = vi.spyOn(notifications, "businessChanged");

    expect((await sendEvent(signedEvent(transaction)).expect(200)).body.data).toEqual({ received: true });
    // El panel abierto en el computador y en el celular se entera al instante.
    expect(changed).toHaveBeenCalledWith({ businessId, scope: "subscription", clientId: null });
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { businessId } });
    // Los días de prueba no se pierden: el mes pagado empieza cuando termina la prueba.
    expect(subscription).toMatchObject({ plan: "EMPRENDEDOR", paidUntil: addMonths(trialEndsAt, 1) });
    const payments = await paymentsOf(businessId);
    expect(payments).toMatchObject([{ plan: "EMPRENDEDOR", months: 1, amount: 119_900, method: "WOMPI", reference: transaction.id, note: "Nequi", recordedById: null }]);
    expect(await prisma.planCheckout.findUniqueOrThrow({ where: { id: checkout.id } })).toMatchObject({
      status: "APPROVED",
      transactionId: transaction.id,
      paymentMethod: "NEQUI",
      paymentId: payments[0]!.id,
    });

    // Wompi reintenta el aviso: no se cobra ni se extiende dos veces.
    await sendEvent(signedEvent(transaction)).expect(200);
    expect(await paymentsOf(businessId)).toHaveLength(1);

    const plan = (await agent.get("/api/v1/subscription").expect(200)).body.data;
    expect(plan).toMatchObject({ status: "ACTIVE", plan: "EMPRENDEDOR", payments: [{ method: "WOMPI", note: "Nequi", amount: 119_900 }] });
  });

  it("rechaza avisos sin la firma de Wompi y no aplica valores distintos al del plan", async () => {
    const { agent, businessId } = await registerMerchant();
    const checkout = await startCheckout(agent);

    const forged = await sendEvent(signedEvent(transactionFor(checkout), "test_events_OtroSecreto")).expect(401);
    expect(forged.body.error.code).toBe("INVALID_SIGNATURE");
    const tampered = signedEvent(transactionFor(checkout, { status: "DECLINED" }));
    tampered.data.transaction.status = "APPROVED";
    await sendEvent(tampered).expect(401);
    await sendEvent({ event: "transaction.updated", data: {} }).expect(400);

    // Firmado por Wompi pero por otro valor (no puede pasar con el enlace firmado): no se aplica.
    await sendEvent(signedEvent(transactionFor(checkout, { amount_in_cents: 150_000 }))).expect(200);
    // Otros cobros de la misma cuenta de Wompi y otros eventos se ignoran.
    await sendEvent(signedEvent(transactionFor({ id: "venta-tienda-123", amount: 119_900 }))).expect(200);
    await sendEvent({ ...signedEvent(transactionFor(checkout)), event: "nequi_token.updated" }).expect(200);

    expect(await paymentsOf(businessId)).toEqual([]);
    expect(await prisma.planCheckout.findUniqueOrThrow({ where: { id: checkout.id } })).toMatchObject({ status: "PENDING" });
  });

  it("un pago rechazado no cambia el plan; el reintento aprobado sí y ya no se revierte", async () => {
    const { agent, businessId } = await registerMerchant();
    const checkout = await startCheckout(agent, { plan: "NEGOCIO", months: 12 });
    const declined = transactionFor(checkout, { status: "DECLINED", payment_method_type: "CARD" });

    await sendEvent(signedEvent(declined)).expect(200);
    expect(await prisma.planCheckout.findUniqueOrThrow({ where: { id: checkout.id } })).toMatchObject({ status: "DECLINED", paymentMethod: "CARD" });
    expect(await paymentsOf(businessId)).toEqual([]);
    expect((await agent.get("/api/v1/subscription").expect(200)).body.data.status).toBe("TRIAL");

    await sendEvent(signedEvent(transactionFor(checkout, { payment_method_type: "PSE" }))).expect(200);
    expect(await paymentsOf(businessId)).toMatchObject([{ plan: "NEGOCIO", months: 12, amount: 4_414_896, note: "PSE" }]);
    // Si el aviso del intento rechazado llega tarde, el pago sigue aprobado.
    await sendEvent(signedEvent(declined)).expect(200);
    expect(await prisma.planCheckout.findUniqueOrThrow({ where: { id: checkout.id } })).toMatchObject({ status: "APPROVED", paymentMethod: "PSE" });
  });

  it("al volver de Wompi se confirma la transacción con la llave privada", async () => {
    const { agent, businessId } = await registerMerchant();
    const checkout = await startCheckout(agent);
    const transaction = transactionFor(checkout, { payment_method_type: "PSE" });
    const lookup = vi.spyOn(wompi, "getTransaction").mockResolvedValue(transaction);

    // El aviso de Wompi y la confirmación llegan al mismo tiempo: el plan se extiende una sola vez.
    const [confirmed] = await Promise.all([confirm(agent, checkout.id, transaction.id).expect(200), sendEvent(signedEvent(transaction)).expect(200)]);
    expect(confirmed.body.data).toMatchObject({ status: "APPROVED", planName: "Emprendedor", months: 1, amount: 119_900 });
    expect(lookup).toHaveBeenCalledWith(transaction.id);
    expect(await paymentsOf(businessId)).toHaveLength(1);
    expect((await confirm(agent, checkout.id, transaction.id).expect(200)).body.data).toMatchObject({ status: "APPROVED", paymentMethod: "PSE" });

    // Pendiente (PSE puede tardar), Wompi sin respuesta o una transacción de otro cobro: queda pendiente.
    const pending = await startCheckout(agent);
    lookup.mockResolvedValue(transactionFor(pending, { status: "PENDING" }));
    expect((await confirm(agent, pending.id, "tx-pendiente").expect(200)).body.data.status).toBe("PENDING");
    lookup.mockRejectedValue(new Error("Wompi no responde"));
    expect((await confirm(agent, pending.id, "tx-pendiente").expect(200)).body.data.status).toBe("PENDING");
    lookup.mockResolvedValue(transactionFor(checkout));
    expect((await confirm(agent, pending.id, "tx-de-otro-cobro").expect(200)).body.data.status).toBe("PENDING");
    // Sin transacción (volvió sin pagar) no se consulta a Wompi.
    lookup.mockClear();
    expect((await confirm(agent, pending.id).expect(200)).body.data.status).toBe("PENDING");
    expect(lookup).not.toHaveBeenCalled();
    expect(await paymentsOf(businessId)).toHaveLength(1);

    // Cada negocio solo ve sus cobros.
    const other = await registerMerchant({ businessName: "Otro", businessPhone: "300 999 8877" });
    expect((await confirm(other.agent, checkout.id, transaction.id).expect(404)).body.error.code).toBe("CHECKOUT_NOT_FOUND");
  });

  it("no deja pagar un plan más pequeño que el menú o el equipo", async () => {
    const { agent, businessId } = await registerMerchant();
    await prisma.product.createMany({ data: Array.from({ length: 16 }, (_, index) => ({ businessId, name: `Producto ${index}`, price: 1000 })) });
    const products = await agent.post("/api/v1/subscription/checkouts").send({ plan: "EMPRENDEDOR", months: 1 }).expect(409);
    expect(products.body.error).toMatchObject({
      code: "PLAN_TOO_SMALL",
      message: "Tienes 16 productos en el menú y el plan Emprendedor permite 15. Elimina algunos o elige un plan más grande.",
    });
    await startCheckout(agent, { plan: "NEGOCIO", months: 1 });

    const team = await registerMerchant({ businessName: "Con equipo", businessPhone: "300 111 2233" });
    await team.agent.post("/api/v1/businesses/current/members").send({ name: "Carlos", email: uniqueEmail(), password: PASSWORD }).expect(201);
    const members = await team.agent.post("/api/v1/subscription/checkouts").send({ plan: "EMPRENDEDOR", months: 12 }).expect(409);
    expect(members.body.error.message).toBe("Tienes 2 personas en el equipo y el plan Emprendedor permite 1 persona. Quita algunas o elige un plan más grande.");
  });

  it("solo el propietario paga; sin las llaves de Wompi se paga por WhatsApp", async () => {
    const { agent } = await registerMerchant();
    const email = uniqueEmail("empleado");
    await agent.post("/api/v1/businesses/current/members").send({ name: "Carlos", email, password: PASSWORD }).expect(201);
    await (await login(email)).post("/api/v1/subscription/checkouts").send({ plan: "NEGOCIO", months: 1 }).expect(403);
    await newAgent().post("/api/v1/subscription/checkouts").send({ plan: "NEGOCIO", months: 1 }).expect(401);

    vi.spyOn(wompi, "enabled").mockReturnValue(false);
    const plan = (await agent.get("/api/v1/subscription").expect(200)).body.data;
    expect(plan).toMatchObject({ onlinePayment: null, support: { whatsapp: "573009998877" } });
    const unavailable = await agent.post("/api/v1/subscription/checkouts").send({ plan: "NEGOCIO", months: 1 }).expect(409);
    expect(unavailable.body.error.code).toBe("ONLINE_PAYMENT_UNAVAILABLE");
    await sendEvent(signedEvent(transactionFor({ id: "cualquiera", amount: 1000 }))).expect(404);
  });
});
