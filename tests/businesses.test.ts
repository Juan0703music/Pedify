import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { login, PASSWORD, registerMerchant, uniqueEmail } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(resetDatabase);

const week = (open = "17:00", close = "23:30") =>
  Array.from({ length: 7 }, (_, day) => ({ day, closed: day === 1, open, close }));

describe("Negocio actual", () => {
  it("devuelve el negocio con el enlace público de la tienda", async () => {
    const { agent, businessId } = await registerMerchant({ businessName: "Sabores del Caribe" });
    const res = await agent.get("/api/v1/businesses/current").expect(200);

    expect(res.body.data).toMatchObject({
      id: businessId,
      slug: "sabores-del-caribe",
      phone: "573001234567",
      status: "ACTIVE",
      role: "OWNER",
      storeUrl: "http://localhost:3000/tienda/sabores-del-caribe",
    });
  });

  it("el propietario actualiza los datos del negocio", async () => {
    const { agent } = await registerMerchant();
    const res = await agent
      .patch("/api/v1/businesses/current")
      .send({ name: "Sabores del Caribe Express", description: "Comida rápida en Sincelejo", city: "Sincelejo", address: "" })
      .expect(200);

    expect(res.body.data).toMatchObject({
      name: "Sabores del Caribe Express",
      description: "Comida rápida en Sincelejo",
      city: "Sincelejo",
      address: null,
      // El slug no cambia solo porque cambie el nombre: los enlaces compartidos siguen funcionando.
      slug: "sabores-del-caribe",
    });
  });

  it("valida el formato del enlace y no permite repetir el de otro negocio", async () => {
    await registerMerchant({ businessName: "Pizzería Napoli" });
    const { agent } = await registerMerchant({ businessName: "Otro negocio" });

    const invalid = await agent.patch("/api/v1/businesses/current").send({ slug: "Con Espacios!" }).expect(400);
    expect(invalid.body.error.fields.slug).toBeDefined();

    const taken = await agent.patch("/api/v1/businesses/current").send({ slug: "pizzeria-napoli" }).expect(409);
    expect(taken.body.error.code).toBe("SLUG_TAKEN");

    const ok = await agent.patch("/api/v1/businesses/current").send({ slug: "mi-negocio" }).expect(200);
    expect(ok.body.data.storeUrl).toBe("http://localhost:3000/tienda/mi-negocio");
  });
});

describe("Configuración del negocio", () => {
  it("guarda horario, domicilio, WhatsApp y métodos de pago", async () => {
    const { agent } = await registerMerchant();
    const res = await agent
      .patch("/api/v1/businesses/current/settings")
      .send({
        openingHours: week(),
        whatsappPhone: "+57 315 555 0101",
        deliveryFee: 4000,
        deliveryArea: "Todo Sincelejo",
        minimumOrder: 15000,
        paymentMethods: ["CASH", "NEQUI", "NEQUI"],
        acceptingOrders: false,
      })
      .expect(200);

    expect(res.body.data).toMatchObject({
      whatsappPhone: "573155550101",
      deliveryFee: 4000,
      deliveryArea: "Todo Sincelejo",
      minimumOrder: 15000,
      paymentMethods: ["CASH", "NEQUI"],
      acceptingOrders: false,
      timezone: "America/Bogota",
    });
    expect(res.body.data.openingHours[1]).toEqual({ day: 1, closed: true, open: "17:00", close: "23:30" });
  });

  it("solo acepta pesos enteros y no negativos", async () => {
    const { agent } = await registerMerchant();
    await agent.patch("/api/v1/businesses/current/settings").send({ deliveryFee: 4000.5 }).expect(400);
    await agent.patch("/api/v1/businesses/current/settings").send({ deliveryFee: -100 }).expect(400);
    await agent.patch("/api/v1/businesses/current/settings").send({ deliveryFee: "4000" }).expect(400);
  });

  it("exige que el WhatsApp sea un celular colombiano", async () => {
    const { agent } = await registerMerchant();
    const res = await agent.patch("/api/v1/businesses/current/settings").send({ whatsappPhone: "604 123 4567" }).expect(400);
    expect(res.body.error.fields.whatsappPhone).toMatch(/celular/);
  });

  it("exige el horario completo de la semana", async () => {
    const { agent } = await registerMerchant();
    await agent
      .patch("/api/v1/businesses/current/settings")
      .send({ openingHours: week().slice(0, 6) })
      .expect(400);
    await agent
      .patch("/api/v1/businesses/current/settings")
      .send({ openingHours: week("18:00", "18:00") })
      .expect(400);
  });

  it("no permite desactivar domicilio y recoger al mismo tiempo", async () => {
    const { agent } = await registerMerchant();
    await agent.patch("/api/v1/businesses/current/settings").send({ pickupEnabled: false }).expect(200);
    const res = await agent.patch("/api/v1/businesses/current/settings").send({ deliveryEnabled: false }).expect(400);
    expect(res.body.error.code).toBe("NO_DELIVERY_MODE");
  });
});

describe("Aislamiento entre negocios (multiempresa)", () => {
  it("un usuario no puede seleccionar un negocio al que no pertenece", async () => {
    const intruder = await registerMerchant({ businessName: "Negocio A" });
    const victim = await registerMerchant({ businessName: "Negocio B" });

    const res = await intruder.agent
      .post("/api/v1/auth/switch-business")
      .send({ businessId: victim.businessId })
      .expect(403);
    expect(res.body.error.code).toBe("NOT_A_MEMBER");
  });

  it("la pertenencia se verifica en cada operación, no solo al iniciar sesión", async () => {
    const intruder = await registerMerchant({ businessName: "Negocio A" });
    const victim = await registerMerchant({ businessName: "Negocio B" });

    // Aunque la sesión apunte al negocio ajeno, el servidor rechaza el acceso.
    await prisma.session.updateMany({
      where: { userId: intruder.profile.user.id },
      data: { activeBusinessId: victim.businessId },
    });

    await intruder.agent.get("/api/v1/businesses/current").expect(403);
    await intruder.agent.patch("/api/v1/businesses/current/settings").send({ deliveryFee: 0 }).expect(403);

    const victimSettings = await prisma.businessSettings.findUniqueOrThrow({ where: { businessId: victim.businessId } });
    expect(victimSettings.deliveryFee).toBe(0);

    // /auth/me corrige la sesión hacia un negocio propio.
    const me = await intruder.agent.get("/api/v1/auth/me").expect(200);
    expect(me.body.data.activeBusinessId).toBe(intruder.businessId);
    await intruder.agent.get("/api/v1/businesses/current").expect(200);
  });

  it("un negocio no puede gestionar miembros de otro", async () => {
    const a = await registerMerchant({ businessName: "Negocio A" });
    const b = await registerMerchant({ businessName: "Negocio B" });
    const bOwnerMembership = await prisma.businessMembership.findFirstOrThrow({ where: { businessId: b.businessId } });

    await a.agent.delete(`/api/v1/businesses/current/members/${bOwnerMembership.id}`).expect(404);
    await a.agent.patch(`/api/v1/businesses/current/members/${bOwnerMembership.id}`).send({ role: "EMPLOYEE" }).expect(404);
    expect(await prisma.businessMembership.count({ where: { businessId: b.businessId } })).toBe(1);
  });
});

describe("Miembros y roles", () => {
  it("el propietario crea la cuenta de un empleado con permisos limitados", async () => {
    const owner = await registerMerchant();
    const employeeEmail = uniqueEmail("empleado");

    const created = await owner.agent
      .post("/api/v1/businesses/current/members")
      .send({ name: "Carlos Mesa", email: employeeEmail, password: PASSWORD })
      .expect(201);
    expect(created.body.data).toMatchObject({ role: "EMPLOYEE", user: { email: employeeEmail, name: "Carlos Mesa" } });

    const employee = await login(employeeEmail);
    await employee.get("/api/v1/businesses/current").expect(200);
    await employee.get("/api/v1/businesses/current/settings").expect(200);

    const denied = await employee.patch("/api/v1/businesses/current/settings").send({ deliveryFee: 1 }).expect(403);
    expect(denied.body.error.code).toBe("ROLE_REQUIRED");
    await employee.patch("/api/v1/businesses/current").send({ name: "Cambio" }).expect(403);
    await employee.get("/api/v1/businesses/current/members").expect(403);
  });

  it("vincula a un usuario existente sin pedir contraseña y evita duplicados", async () => {
    const owner = await registerMerchant({ businessName: "Negocio A" });
    const other = await registerMerchant({ businessName: "Negocio B" });

    await owner.agent
      .post("/api/v1/businesses/current/members")
      .send({ name: "Ana", email: other.input.email })
      .expect(201);
    const duplicate = await owner.agent
      .post("/api/v1/businesses/current/members")
      .send({ name: "Ana", email: other.input.email })
      .expect(409);
    expect(duplicate.body.error.code).toBe("ALREADY_MEMBER");

    const me = await other.agent.get("/api/v1/auth/me").expect(200);
    expect(me.body.data.businesses).toHaveLength(2);
  });

  it("pide contraseña inicial si el correo no tiene cuenta", async () => {
    const owner = await registerMerchant();
    const res = await owner.agent
      .post("/api/v1/businesses/current/members")
      .send({ name: "Nuevo", email: uniqueEmail("nuevo") })
      .expect(400);
    expect(res.body.error.code).toBe("PASSWORD_REQUIRED");
  });

  it("el negocio nunca se queda sin propietario", async () => {
    const owner = await registerMerchant();
    const ownMembership = await prisma.businessMembership.findFirstOrThrow({ where: { businessId: owner.businessId } });

    const demote = await owner.agent
      .patch(`/api/v1/businesses/current/members/${ownMembership.id}`)
      .send({ role: "EMPLOYEE" })
      .expect(409);
    expect(demote.body.error.code).toBe("LAST_OWNER");
    await owner.agent.delete(`/api/v1/businesses/current/members/${ownMembership.id}`).expect(409);
  });

  it("al quitar a un miembro pierde el acceso de inmediato", async () => {
    const owner = await registerMerchant();
    const email = uniqueEmail("empleado");
    const created = await owner.agent
      .post("/api/v1/businesses/current/members")
      .send({ name: "Carlos", email, password: PASSWORD })
      .expect(201);
    const employee = await login(email);
    await employee.get("/api/v1/businesses/current").expect(200);

    await owner.agent.delete(`/api/v1/businesses/current/members/${created.body.data.id}`).expect(204);

    await employee.get("/api/v1/businesses/current").expect(403);
    const me = await employee.get("/api/v1/auth/me").expect(200);
    expect(me.body.data.businesses).toEqual([]);
    expect(me.body.data.activeBusinessId).toBeNull();
  });
});

describe("Varios negocios por cuenta", () => {
  it("crea otro negocio, lo activa y permite volver al anterior", async () => {
    const { agent, businessId } = await registerMerchant({ businessName: "Salchipapería La 20" });

    const created = await agent
      .post("/api/v1/businesses")
      .send({ name: "Pizzería La 20", phone: "3001234567" })
      .expect(201);
    expect(created.body.data.slug).toBe("pizzeria-la-20");

    let me = await agent.get("/api/v1/auth/me").expect(200);
    expect(me.body.data.businesses).toHaveLength(2);
    expect(me.body.data.activeBusinessId).toBe(created.body.data.id);

    await agent.post("/api/v1/auth/switch-business").send({ businessId }).expect(200);
    me = await agent.get("/api/v1/auth/me").expect(200);
    expect(me.body.data.activeBusinessId).toBe(businessId);
  });
});
