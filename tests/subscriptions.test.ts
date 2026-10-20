import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/config/database.js";
import { addMonths, subscriptionState } from "../src/modules/subscriptions/subscription-state.js";
import { clock } from "../src/utils/clock.js";
import { login, newAgent, PASSWORD, registerMerchant, uniqueEmail } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

const at = (iso: string) => vi.spyOn(clock, "now").mockReturnValue(new Date(iso));

describe("Estado de la suscripción", () => {
  const trialEndsAt = new Date("2026-10-10T00:00:00Z");

  it("prueba → vencida con días de gracia → vencida; pagada → activa", () => {
    expect(subscriptionState({ trialEndsAt, paidUntil: null }, new Date("2026-10-05T00:00:00Z"))).toMatchObject({ status: "TRIAL", daysLeft: 5, canReceiveOrders: true });
    expect(subscriptionState({ trialEndsAt, paidUntil: null }, new Date("2026-10-13T00:00:00Z"))).toMatchObject({ status: "PAST_DUE", canReceiveOrders: true });
    expect(subscriptionState({ trialEndsAt, paidUntil: null }, new Date("2026-10-16T00:00:00Z"))).toMatchObject({ status: "EXPIRED", canReceiveOrders: false });
    expect(subscriptionState({ trialEndsAt, paidUntil: new Date("2026-11-10T00:00:00Z") }, new Date("2026-10-20T00:00:00Z"))).toMatchObject({ status: "ACTIVE", daysLeft: 21 });
  });

  it("suma meses de calendario sin pasarse del último día", () => {
    expect(addMonths(new Date("2026-01-31T05:00:00Z"), 1).toISOString()).toBe("2026-02-28T05:00:00.000Z");
    expect(addMonths(new Date("2026-10-16T05:00:00Z"), 12).toISOString()).toBe("2027-10-16T05:00:00.000Z");
  });
});

describe("Suscripción del negocio", () => {
  it("un negocio nuevo empieza con 7 días de prueba del plan Negocio", async () => {
    const { agent } = await registerMerchant();
    const current = await agent.get("/api/v1/businesses/current").expect(200);
    expect(current.body.data.subscription).toMatchObject({ plan: "NEGOCIO", planName: "Negocio", status: "TRIAL", daysLeft: 7, canReceiveOrders: true });

    const plan = await agent.get("/api/v1/subscription").expect(200);
    expect(plan.body.data).toMatchObject({
      status: "TRIAL",
      usage: { products: 0, members: 1 },
      limits: { products: 30, members: 6 },
      support: { whatsapp: "573009998877" },
    });
    expect(plan.body.data.plans.map((item: { code: string }) => item.code)).toEqual(["EMPRENDEDOR", "NEGOCIO", "EMPRESA"]);
    expect(plan.body.data).toMatchObject({ priceMonthly: 399900, priceYearly: 4414896, annualDiscountPercent: 8 });
    expect(decodeURIComponent(plan.body.data.support.url)).toContain("quiero pagar el plan Negocio");
  });

  it("al registrarse se elige el plan de la prueba: 7 días con los límites de ese plan", async () => {
    const register = (agent: ReturnType<typeof newAgent>, plan: string) =>
      agent
        .post("/api/v1/auth/register")
        .send({ name: "Ana Pérez", email: uniqueEmail(), password: PASSWORD, businessName: "Pizzería Napoli", businessPhone: "300 123 4567", acceptPrivacy: true, plan });
    for (const [plan, limits] of [
      ["EMPRENDEDOR", { products: 5, members: 1 }],
      ["EMPRESA", { products: null, members: null }],
    ] as const) {
      const agent = newAgent();
      await register(agent, plan).expect(201);
      expect((await agent.get("/api/v1/subscription").expect(200)).body.data).toMatchObject({ plan, status: "TRIAL", daysLeft: 7, limits });
    }
    const invalid = await register(newAgent(), "GRATIS").expect(400);
    expect(invalid.body.error.fields.plan).toBe("Elige uno de los planes.");
  });

  it("aplica los límites del plan a productos y equipo", async () => {
    const { agent, businessId } = await registerMerchant();
    await prisma.subscription.update({ where: { businessId }, data: { plan: "EMPRENDEDOR" } });
    await prisma.product.createMany({ data: Array.from({ length: 4 }, (_, index) => ({ businessId, name: `Producto ${index}`, price: 1000 })) });
    await agent.post("/api/v1/products").send({ name: "El quinto", price: 5000 }).expect(201);

    const product = await agent.post("/api/v1/products").send({ name: "Uno más", price: 5000 }).expect(409);
    expect(product.body.error).toMatchObject({ code: "PLAN_LIMIT", message: "Tu plan Emprendedor permite hasta 5 productos. Pásate al plan Negocio para agregar más." });

    // Emprendedor es solo para el dueño: no admite empleados.
    const member = await agent.post("/api/v1/businesses/current/members").send({ name: "Carlos", email: uniqueEmail(), password: PASSWORD }).expect(409);
    expect(member.body.error).toMatchObject({ code: "PLAN_LIMIT", message: "Tu plan Emprendedor permite hasta 1 persona en el equipo. Pásate al plan Negocio para agregar más." });

    // En Negocio, el siguiente paso es Empresa; Empresa es el plan más alto.
    await prisma.subscription.update({ where: { businessId }, data: { plan: "NEGOCIO" } });
    await agent.post("/api/v1/businesses/current/members").send({ name: "Carlos", email: uniqueEmail(), password: PASSWORD }).expect(201);
    await prisma.product.createMany({ data: Array.from({ length: 25 }, (_, index) => ({ businessId, name: `Más ${index}`, price: 1000 })) });
    const negocio = await agent.post("/api/v1/products").send({ name: "Uno más", price: 5000 }).expect(409);
    expect(negocio.body.error.message).toBe("Tu plan Negocio permite hasta 30 productos. Pásate al plan Empresa para agregar más.");
    // Empresa no tiene límites: ni de productos ni de personas.
    await prisma.subscription.update({ where: { businessId }, data: { plan: "EMPRESA" } });
    await agent.post("/api/v1/products").send({ name: "Uno más", price: 5000 }).expect(201);
    const extra = await prisma.user.createManyAndReturn({
      data: Array.from({ length: 8 }, (_, index) => ({ name: `Persona ${index}`, email: uniqueEmail(), passwordHash: "x" })),
      select: { id: true },
    });
    await prisma.businessMembership.createMany({ data: extra.map((user) => ({ businessId, userId: user.id, role: "EMPLOYEE" as const })) });
    await agent.post("/api/v1/businesses/current/members").send({ name: "Lina", email: uniqueEmail(), password: PASSWORD }).expect(201);
    expect((await agent.get("/api/v1/subscription").expect(200)).body.data).toMatchObject({ usage: { members: 11 }, limits: { products: null, members: null } });
  });

  it("el precio anual es 12 meses con el descuento de cada plan ya aplicado", async () => {
    const { PLANS } = await import("../src/modules/subscriptions/plans.js");
    expect(Object.values(PLANS).map((plan) => [plan.code, plan.priceMonthly, plan.annualDiscountPercent, plan.priceYearly])).toEqual([
      ["EMPRENDEDOR", 99900, 10, 1078920],
      ["NEGOCIO", 399900, 8, 4414896],
      ["EMPRESA", 799900, 5, 9118860],
    ]);
    for (const plan of Object.values(PLANS)) {
      expect(plan.priceYearly).toBe(Math.round((plan.priceMonthly * 12 * (100 - plan.annualDiscountPercent)) / 100));
    }
  });

  it("vencida la prueba hay días de gracia; después la tienda deja de recibir pedidos", async () => {
    const { agent, businessId } = await registerMerchant();
    const product = (await agent.post("/api/v1/products").send({ name: "Salchipapa", price: 15000 }).expect(201)).body.data;
    const slug = (await agent.get("/api/v1/businesses/current")).body.data.slug;
    await prisma.subscription.update({ where: { businessId }, data: { trialEndsAt: new Date("2026-10-10T00:00:00Z") } });
    const order = () =>
      newAgent()
        .post(`/api/v1/store/${slug}/orders`)
        .send({ idempotencyKey: randomUUID(), items: [{ productId: product.id, quantity: 1 }], name: "Luis", phone: "311 222 3344", deliveryType: "PICKUP", paymentMethod: "CASH" });

    // Martes 13 de octubre, 7:00 p. m.: dentro de los 5 días de gracia.
    at("2026-10-13T19:00:00-05:00");
    expect((await agent.get("/api/v1/businesses/current")).body.data.subscription.status).toBe("PAST_DUE");
    await order().expect(201);

    // Martes 20 de octubre, 7:00 p. m.: vencida.
    at("2026-10-20T19:00:00-05:00");
    expect((await agent.get("/api/v1/businesses/current")).body.data.subscription.status).toBe("EXPIRED");
    const store = await newAgent().get(`/api/v1/store/${slug}`).expect(200);
    expect(store.body.data.status).toMatchObject({ onlineOrdering: false, canOrder: false });
    const blocked = await order().expect(409);
    expect(blocked.body.error.code).toBe("STORE_UNAVAILABLE");
    // El panel sigue funcionando para que el negocio vea sus datos y renueve.
    await agent.get("/api/v1/orders").expect(200);
  });

  it("los empleados no ven la facturación", async () => {
    const { agent } = await registerMerchant();
    const email = uniqueEmail("empleado");
    await agent.post("/api/v1/businesses/current/members").send({ name: "Carlos", email, password: PASSWORD }).expect(201);
    await (await login(email)).get("/api/v1/subscription").expect(403);
  });
});

describe("Panel central de Pedify", () => {
  async function admin() {
    const merchant = await registerMerchant({ businessName: "Pedify Soporte" });
    await prisma.user.update({ where: { id: merchant.profile.user.id }, data: { isPlatformAdmin: true } });
    return merchant;
  }

  it("solo los administradores de la plataforma pueden entrar", async () => {
    const { agent } = await registerMerchant();
    const res = await agent.get("/api/v1/admin/metrics").expect(403);
    expect(res.body.error.code).toBe("ADMIN_REQUIRED");
    await newAgent().get("/api/v1/admin/businesses").expect(401);
  });

  it("muestra métricas globales y la lista de negocios con su estado", async () => {
    const { agent } = await admin();
    const other = await registerMerchant({ businessName: "Pizzería Napoli" });
    await prisma.subscription.update({ where: { businessId: other.businessId }, data: { trialEndsAt: new Date(Date.now() - 30 * 86_400_000) } });

    const metrics = await agent.get("/api/v1/admin/metrics").expect(200);
    expect(metrics.body.data.businesses).toMatchObject({ total: 2, trial: 1, expired: 1 });
    expect(metrics.body.data.system).toMatchObject({ dbLatencyMs: expect.any(Number), uptimeSeconds: expect.any(Number) });

    const expired = await agent.get("/api/v1/admin/businesses?status=EXPIRED").expect(200);
    expect(expired.body.data.items).toMatchObject([{ name: "Pizzería Napoli", subscriptionStatus: "EXPIRED", ownerEmail: other.input.email.toLowerCase() }]);
    const search = await agent.get("/api/v1/admin/businesses?search=napoli").expect(200);
    expect(search.body.data.total).toBe(1);
  });

  it("registra un pago: extiende la suscripción desde el fin de la prueba sin perder días", async () => {
    const { agent } = await admin();
    const shop = await registerMerchant({ businessName: "Pizzería Napoli" });
    const trialEndsAt = (await prisma.subscription.findUniqueOrThrow({ where: { businessId: shop.businessId } })).trialEndsAt;

    const res = await agent
      .post(`/api/v1/admin/businesses/${shop.businessId}/payments`)
      .send({ months: 1, method: "NEQUI", reference: "M123456", plan: "EMPRENDEDOR" })
      .expect(201);
    expect(res.body.data.subscription).toMatchObject({ plan: "EMPRENDEDOR", status: "ACTIVE" });
    expect(new Date(res.body.data.subscription.paidUntil).toISOString()).toBe(addMonths(trialEndsAt, 1).toISOString());
    expect(res.body.data.payments).toMatchObject([{ amount: 99900, months: 1, method: "NEQUI", reference: "M123456", plan: "EMPRENDEDOR" }]);

    const merchantView = await shop.agent.get("/api/v1/subscription").expect(200);
    expect(merchantView.body.data).toMatchObject({ status: "ACTIVE", plan: "EMPRENDEDOR", payments: [{ amount: 99900 }] });
  });

  it("un pago de 12 meses se cobra al precio anual con descuento", async () => {
    const { agent } = await admin();
    const shop = await registerMerchant({ businessName: "Hamburguesas del Puerto" });
    const res = await agent.post(`/api/v1/admin/businesses/${shop.businessId}/payments`).send({ months: 12, method: "TRANSFERENCIA", plan: "EMPRESA" }).expect(201);
    expect(res.body.data.subscription).toMatchObject({ plan: "EMPRESA", planName: "Empresa", priceMonthly: 799900, priceYearly: 9118860 });
    expect(res.body.data.payments).toMatchObject([{ amount: 9118860, months: 12, plan: "EMPRESA" }]);

    // Varios meses sin completar el año se cobran mes a mes; el valor recibido se puede escribir a mano.
    const three = await agent.post(`/api/v1/admin/businesses/${shop.businessId}/payments`).send({ months: 3, method: "NEQUI", plan: "NEGOCIO" }).expect(201);
    expect(three.body.data.payments[0]).toMatchObject({ amount: 1199700, months: 3, plan: "NEGOCIO" });
    const manual = await agent.post(`/api/v1/admin/businesses/${shop.businessId}/payments`).send({ months: 12, method: "NEQUI", amount: 3000000 }).expect(201);
    expect(manual.body.data.payments[0]).toMatchObject({ amount: 3000000, months: 12 });
  });

  it("suspende y reactiva un negocio; amplía la prueba", async () => {
    const { agent } = await admin();
    const shop = await registerMerchant({ businessName: "Pizzería Napoli" });
    const slug = (await shop.agent.get("/api/v1/businesses/current")).body.data.slug;

    await agent.patch(`/api/v1/admin/businesses/${shop.businessId}`).send({ status: "SUSPENDED" }).expect(200);
    await newAgent().get(`/api/v1/store/${slug}`).expect(404);
    expect((await shop.agent.get("/api/v1/businesses/current").expect(403)).body.error.code).toBe("BUSINESS_SUSPENDED");

    await agent.patch(`/api/v1/admin/businesses/${shop.businessId}`).send({ status: "ACTIVE", extendTrialDays: 7 }).expect(200);
    await newAgent().get(`/api/v1/store/${slug}`).expect(200);
    expect((await shop.agent.get("/api/v1/businesses/current").expect(200)).body.data.subscription.daysLeft).toBe(14);

    await agent.patch(`/api/v1/admin/businesses/${shop.businessId}`).send({}).expect(400);
  });
});

describe("Portada", () => {
  it("los precios publicados en la portada coinciden con los planes", async () => {
    const { readFileSync } = await import("node:fs");
    const { PLANS } = await import("../src/modules/subscriptions/plans.js");
    const { formatCOP } = await import("../src/utils/currency.js");
    const html = readFileSync("public/index.html", "utf8");
    for (const plan of Object.values(PLANS)) {
      expect(html).toContain(`>${plan.name}</h3>`);
      expect(html).toContain(`${formatCOP(plan.priceMonthly)} <span`);
      expect(html).toContain(`${formatCOP(plan.priceYearly)} <span`);
      expect(html).toContain(`Ahorra ${plan.annualDiscountPercent} %`);
      expect(html).toContain(plan.maxProducts === null ? "Productos ilimitados con foto" : `Hasta ${plan.maxProducts} productos`);
      expect(html).toContain(plan.maxMembers === null ? "Personas ilimitadas con acceso" : `${plan.maxMembers} ${plan.maxMembers === 1 ? "persona" : "personas"} con acceso`);
      expect(html).toContain(`href="/registro?plan=${plan.code}"`);
    }
    expect(html).not.toContain("14 días");
  });

  it("el registro ofrece los planes con sus precios y límites para la prueba", async () => {
    const { readFileSync } = await import("node:fs");
    const { PLANS, DEFAULT_TRIAL_PLAN } = await import("../src/modules/subscriptions/plans.js");
    const { formatCOP } = await import("../src/utils/currency.js");
    const html = readFileSync("public/pages/auth/register.html", "utf8");
    for (const plan of Object.values(PLANS)) {
      expect(html).toContain(`value="${plan.code}"${plan.code === DEFAULT_TRIAL_PLAN ? " checked" : ""} />`);
      expect(html).toContain(`>${plan.name}</span>`);
      expect(html).toContain(`${formatCOP(plan.priceMonthly)} / mes`);
      expect(html).toContain(
        plan.maxProducts === null ? "Productos y personas ilimitados<" : `${plan.maxProducts} productos · ${plan.maxMembers} ${plan.maxMembers === 1 ? "persona" : "personas"}<`,
      );
    }
    expect(html).toContain("7 días gratis");
    expect(html).not.toContain("14 días");
  });
});
