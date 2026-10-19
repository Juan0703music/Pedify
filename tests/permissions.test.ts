import { beforeEach, describe, expect, it } from "vitest";
import { login, newAgent, PASSWORD, registerMerchant, uniqueEmail } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(resetDatabase);

type Agent = Awaited<ReturnType<typeof registerMerchant>>["agent"];

async function addEmployee(owner: Agent, permissions?: Record<string, boolean>) {
  const email = uniqueEmail("empleado");
  const member = (
    await owner.post("/api/v1/businesses/current/members").send({ name: "Carlos Mesa", email, password: PASSWORD, permissions }).expect(201)
  ).body.data as { id: string; role: string; permissions: Record<string, boolean> };
  return { member, email, agent: await login(email) };
}

describe("Permisos de los empleados", () => {
  it("un empleado nuevo puede marcar agotados, ver ventas y clientes, pero no las analíticas", async () => {
    const { agent: owner } = await registerMerchant();
    const { member, agent } = await addEmployee(owner);
    expect(member).toMatchObject({
      role: "EMPLOYEE",
      permissions: { markSoldOut: true, viewSales: true, viewCustomers: true, viewAnalytics: false },
    });
    expect(JSON.stringify(member)).not.toMatch(/canView|canMark/);

    const current = (await agent.get("/api/v1/businesses/current").expect(200)).body.data;
    expect(current).toMatchObject({ role: "EMPLOYEE", permissions: member.permissions });
    await agent.get("/api/v1/analytics/today").expect(200);
    await agent.get("/api/v1/customers").expect(200);
    const denied = await agent.get("/api/v1/analytics/summary").expect(403);
    expect(denied.body.error).toMatchObject({ code: "PERMISSION_REQUIRED", message: "El propietario no te dio permiso para ver las analíticas." });

    // El propietario lo puede todo.
    const ownerCurrent = (await owner.get("/api/v1/businesses/current").expect(200)).body.data;
    expect(ownerCurrent.permissions).toEqual({ markSoldOut: true, viewSales: true, viewCustomers: true, viewAnalytics: true });
    await owner.get("/api/v1/analytics/summary").expect(200);
  });

  it("el propietario cambia los permisos de cada empleado y el servidor los respeta al instante", async () => {
    const { agent: owner } = await registerMerchant();
    const product = (await owner.post("/api/v1/products").send({ name: "Salchipapa", price: 15000 }).expect(201)).body.data;
    const cashier = await addEmployee(owner, { viewSales: false, viewCustomers: false });
    const manager = await addEmployee(owner, { viewAnalytics: true });

    await cashier.agent.get("/api/v1/analytics/today").expect(403);
    await cashier.agent.get("/api/v1/customers").expect(403);
    await manager.agent.get("/api/v1/analytics/summary").expect(200);

    // Quitar "marcar agotados" a uno solo.
    const updated = await owner
      .patch(`/api/v1/businesses/current/members/${cashier.member.id}`)
      .send({ permissions: { markSoldOut: false } })
      .expect(200);
    expect(updated.body.data.permissions).toEqual({ markSoldOut: false, viewSales: false, viewCustomers: false, viewAnalytics: false });
    const blocked = await cashier.agent.patch(`/api/v1/products/${product.id}`).send({ isAvailable: false }).expect(403);
    expect(blocked.body.error.code).toBe("PERMISSION_REQUIRED");
    await manager.agent.patch(`/api/v1/products/${product.id}`).send({ isAvailable: false }).expect(200);

    // Lo que siempre es del propietario no se abre con permisos.
    await manager.agent.patch(`/api/v1/products/${product.id}`).send({ price: 1000 }).expect(403);
    await manager.agent.get("/api/v1/subscription").expect(403);
    await manager.agent.get("/api/v1/businesses/current/members").expect(403);
    const customer = (await owner.get("/api/v1/customers")).body.data.items[0];
    if (customer) await manager.agent.delete(`/api/v1/customers/${customer.id}`).expect(403);

    // Un empleado no puede cambiar sus propios permisos.
    await manager.agent.patch(`/api/v1/businesses/current/members/${manager.member.id}`).send({ permissions: { viewAnalytics: true } }).expect(403);

    // Los empleados atienden pedidos sin importar sus permisos.
    await cashier.agent.get("/api/v1/orders").expect(200);
  });

  it("los permisos se piden con el rol o con los permisos, no vacíos", async () => {
    const { agent: owner } = await registerMerchant();
    const { member } = await addEmployee(owner);
    await owner.patch(`/api/v1/businesses/current/members/${member.id}`).send({}).expect(400);
    await owner.patch(`/api/v1/businesses/current/members/${member.id}`).send({ permissions: { viewSales: "si" } }).expect(400);
  });
});

describe("Elegir el rol al iniciar sesión", () => {
  it("el dueño entra como dueño; si elige empleado, no se abre sesión", async () => {
    const { input } = await registerMerchant();
    const res = await newAgent().post("/api/v1/auth/login").send({ email: input.email, password: PASSWORD, as: "OWNER" }).expect(200);
    expect(res.headers["set-cookie"]?.toString()).toContain("pedify_sid=");

    const wrong = await newAgent().post("/api/v1/auth/login").send({ email: input.email, password: PASSWORD, as: "EMPLOYEE" }).expect(403);
    expect(wrong.body.error).toMatchObject({ code: "ROLE_MISMATCH", message: "Esta cuenta no es de empleado. Elige «Soy el dueño» para entrar." });
    expect(wrong.headers["set-cookie"]).toBeUndefined();
  });

  it("el empleado entra como empleado; si elige dueño, no se abre sesión", async () => {
    const { agent: owner } = await registerMerchant();
    const { email } = await addEmployee(owner);
    await newAgent().post("/api/v1/auth/login").send({ email, password: PASSWORD, as: "EMPLOYEE" }).expect(200);
    const wrong = await newAgent().post("/api/v1/auth/login").send({ email, password: PASSWORD, as: "OWNER" }).expect(403);
    expect(wrong.body.error.message).toBe("Esta cuenta es de empleado. Elige «Soy empleado» para entrar.");
  });

  it("con contraseña equivocada no revela el rol de la cuenta", async () => {
    const { input } = await registerMerchant();
    const res = await newAgent().post("/api/v1/auth/login").send({ email: input.email, password: "otra-clave-123", as: "EMPLOYEE" }).expect(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("si es dueño de un negocio y empleado de otro, entra al negocio del rol que eligió", async () => {
    const own = await registerMerchant({ businessName: "Mi negocio" });
    const other = await registerMerchant({ businessName: "Negocio ajeno", businessPhone: "300 999 8877" });
    await other.agent.post("/api/v1/businesses/current/members").send({ name: own.input.name, email: own.input.email }).expect(201);

    const asEmployee = newAgent();
    await asEmployee.post("/api/v1/auth/login").send({ email: own.input.email, password: PASSWORD, as: "EMPLOYEE" }).expect(200);
    expect((await asEmployee.get("/api/v1/businesses/current").expect(200)).body.data).toMatchObject({ name: "Negocio ajeno", role: "EMPLOYEE" });

    const asOwner = newAgent();
    await asOwner.post("/api/v1/auth/login").send({ email: own.input.email, password: PASSWORD, as: "OWNER" }).expect(200);
    expect((await asOwner.get("/api/v1/businesses/current").expect(200)).body.data).toMatchObject({ name: "Mi negocio", role: "OWNER" });
  });
});
