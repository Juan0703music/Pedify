import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { getOpeningStatus } from "../src/modules/businesses/opening-hours.js";
import request from "supertest";
import { app, newAgent, registerMerchant } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(resetDatabase);

const BOGOTA = "America/Bogota";
/** Fecha en hora de Colombia (UTC−5): bogota("2026-10-13T18:30") → martes 6:30 p. m. */
const bogota = (local: string) => new Date(`${local}:00-05:00`);

const week = (open: string, close: string, closedDays: number[] = []) =>
  Array.from({ length: 7 }, (_, day) => ({ day, closed: closedDays.includes(day), open, close }));

describe("Horario de atención", () => {
  // 2026-10-12 es lunes; 2026-10-13, martes.
  const hours = week("17:00", "23:30", [1]); // lunes cerrado

  it("abierto dentro del turno, con su hora de cierre", () => {
    expect(getOpeningStatus(hours, BOGOTA, bogota("2026-10-13T18:30"))).toEqual({ isOpen: true, closesAt: "23:30", nextOpen: null });
  });

  it("antes de abrir indica que abre hoy; un día cerrado indica el próximo día", () => {
    expect(getOpeningStatus(hours, BOGOTA, bogota("2026-10-13T10:00")).nextOpen).toEqual({ inDays: 0, day: 2, time: "17:00" });
    expect(getOpeningStatus(hours, BOGOTA, bogota("2026-10-12T19:00")).nextOpen).toEqual({ inDays: 1, day: 2, time: "17:00" });
    expect(getOpeningStatus(hours, BOGOTA, bogota("2026-10-13T23:45")).nextOpen).toEqual({ inDays: 1, day: 3, time: "17:00" });
  });

  it("los turnos que pasan la medianoche siguen abiertos al día siguiente", () => {
    const night = week("18:00", "02:00");
    expect(getOpeningStatus(night, BOGOTA, bogota("2026-10-13T23:59")).isOpen).toBe(true);
    expect(getOpeningStatus(night, BOGOTA, bogota("2026-10-14T01:30"))).toEqual({ isOpen: true, closesAt: "02:00", nextOpen: null });
    expect(getOpeningStatus(night, BOGOTA, bogota("2026-10-14T02:00")).isOpen).toBe(false);
    // Cierre a medianoche.
    expect(getOpeningStatus(week("17:00", "00:00"), BOGOTA, bogota("2026-10-13T23:59")).isOpen).toBe(true);
  });

  it("usa la hora de Colombia aunque el servidor esté en otra zona", () => {
    // 03:00 UTC del miércoles = 22:00 del martes en Bogotá.
    expect(getOpeningStatus(hours, BOGOTA, new Date("2026-10-14T03:00:00Z")).isOpen).toBe(true);
  });

  it("sin días abiertos no hay próxima apertura", () => {
    expect(getOpeningStatus(week("10:00", "20:00", [0, 1, 2, 3, 4, 5, 6]), BOGOTA, new Date())).toEqual({
      isOpen: false,
      closesAt: null,
      nextOpen: null,
    });
  });
});

describe("Tienda pública", () => {
  async function seedStore() {
    const merchant = await registerMerchant({ businessName: "Sabores del Caribe" });
    const { agent } = merchant;
    await agent.patch("/api/v1/businesses/current").send({ description: "Comida rápida costeña", city: "Sincelejo" }).expect(200);
    await agent.patch("/api/v1/businesses/current/settings").send({ openingHours: week("00:00", "23:59"), deliveryFee: 4000 }).expect(200);

    const bebidas = (await agent.post("/api/v1/categories").send({ name: "Bebidas" })).body.data;
    const hamburguesas = (await agent.post("/api/v1/categories").send({ name: "Hamburguesas" })).body.data;
    const postres = (await agent.post("/api/v1/categories").send({ name: "Postres" })).body.data; // vacía: no aparece
    await agent.put("/api/v1/categories/order").send({ categoryIds: [hamburguesas.id, bebidas.id, postres.id] }).expect(204);

    const create = (body: Record<string, unknown>) => agent.post("/api/v1/products").send(body).expect(201);
    await create({ name: "Hamburguesa especial", price: 18000, categoryId: hamburguesas.id, description: "Con queso costeño" });
    await create({ name: "Bebida", price: 4000, categoryId: bebidas.id, isAvailable: false });
    await create({ name: "Producto oculto", price: 9000, categoryId: bebidas.id, isActive: false });
    await create({ name: "Salchipapa", price: 15000 });
    const archived = (await create({ name: "Archivado", price: 1000 })).body.data;
    await prisma.product.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    return merchant;
  }

  it("muestra el negocio, su estado y el catálogo visible agrupado por categorías", async () => {
    await seedStore();
    const res = await newAgent().get("/api/v1/store/sabores-del-caribe").expect(200);
    const store = res.body.data;

    expect(res.headers["cache-control"]).toBe("public, max-age=15");
    expect(store.business).toEqual({
      name: "Sabores del Caribe",
      slug: "sabores-del-caribe",
      description: "Comida rápida costeña",
      city: "Sincelejo",
      address: null,
      phone: "573001234567",
      logoUrl: null,
      bannerUrl: null,
    });
    expect(store.settings).toMatchObject({ deliveryFee: 4000, whatsappPhone: "573001234567", timezone: BOGOTA });
    expect(store.status).toMatchObject({ acceptingOrders: true });

    expect(store.categories).toEqual([
      {
        id: expect.any(String),
        name: "Hamburguesas",
        products: [
          { id: expect.any(String), name: "Hamburguesa especial", description: "Con queso costeño", price: 18000, imageUrl: null, isAvailable: true },
        ],
      },
      {
        id: expect.any(String),
        name: "Bebidas",
        products: [{ id: expect.any(String), name: "Bebida", description: null, price: 4000, imageUrl: null, isAvailable: false }],
      },
      {
        id: null,
        name: "Otros productos",
        products: [{ id: expect.any(String), name: "Salchipapa", description: null, price: 15000, imageUrl: null, isAvailable: true }],
      },
    ]);
    // Nunca expone datos internos.
    expect(JSON.stringify(store)).not.toMatch(/businessId|imageKey|position|archivedAt|"id":"[^"]+","name":"Sabores/);
  });

  it("indica cuando el negocio pausó los pedidos", async () => {
    const { agent } = await seedStore();
    await agent.patch("/api/v1/businesses/current/settings").send({ acceptingOrders: false }).expect(200);
    const res = await newAgent().get("/api/v1/store/sabores-del-caribe").expect(200);
    expect(res.body.data.status).toMatchObject({ acceptingOrders: false, canOrder: false });
  });

  it("responde 404 para tiendas inexistentes o negocios suspendidos", async () => {
    const { businessId } = await seedStore();
    const missing = await newAgent().get("/api/v1/store/no-existe").expect(404);
    expect(missing.body.error.code).toBe("STORE_NOT_FOUND");

    await prisma.business.update({ where: { id: businessId }, data: { status: "SUSPENDED" } });
    await newAgent().get("/api/v1/store/sabores-del-caribe").expect(404);
    await request(app).get("/tienda/sabores-del-caribe").expect(404);
  });

  it("la página /tienda/:slug incluye las etiquetas para compartir el enlace", async () => {
    const { agent } = await seedStore();
    await agent.patch("/api/v1/businesses/current").send({ name: 'Sabores "del" <Caribe>' }).expect(200);
    const banner = await sharp({ create: { width: 1800, height: 900, channels: 3, background: "#17161c" } }).png().toBuffer();
    const uploaded = await agent.post("/api/v1/businesses/current/banner").set("Content-Type", "image/png").send(banner).expect(200);
    expect(uploaded.body.data.bannerUrl).toMatch(/^\/uploads\/businesses\/.+\/banner\/[\w-]+\.webp$/);

    const res = await request(app).get("/tienda/sabores-del-caribe").expect(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("<title>Sabores &quot;del&quot; &lt;Caribe&gt; · Menú</title>");
    expect(res.text).toContain('<meta property="og:description" content="Comida rápida costeña" />');
    expect(res.text).toContain(`<meta property="og:image" content="http://localhost:3000${uploaded.body.data.bannerUrl}" />`);
    expect(res.text).not.toContain("<Caribe>");

    await request(app).get("/tienda/Sabores-Del-Caribe").expect(301).expect("Location", "/tienda/sabores-del-caribe");
    await request(app).get("/tienda/no-existe").expect(404);
  });
});

describe("Logo, portada y código QR", () => {
  it("el propietario sube y quita el logo; el QR apunta al enlace de la tienda", async () => {
    const { agent } = await registerMerchant({ businessName: "Pizzería Napoli" });
    const logo = await sharp({ create: { width: 900, height: 600, channels: 4, background: "#ffc72c" } }).png().toBuffer();

    const res = await agent.post("/api/v1/businesses/current/logo").set("Content-Type", "image/png").send(logo).expect(200);
    expect(res.body.data).toMatchObject({ logoUrl: expect.stringMatching(/\.webp$/), storeUrl: "http://localhost:3000/tienda/pizzeria-napoli" });
    expect(res.body.data).not.toHaveProperty("logoKey");
    const served = await agent.get(res.body.data.logoUrl).buffer(true).expect(200);
    expect(await sharp(served.body as Buffer).metadata()).toMatchObject({ width: 512, height: 512 });

    const removed = await agent.delete("/api/v1/businesses/current/logo").expect(200);
    expect(removed.body.data.logoUrl).toBeNull();

    const svg = await agent.get("/api/v1/businesses/current/qr").buffer(true).expect(200);
    expect(svg.headers["content-type"]).toContain("image/svg+xml");
    const png = await agent.get("/api/v1/businesses/current/qr?format=png&download=1").buffer(true).expect(200);
    expect(png.headers["content-type"]).toBe("image/png");
    expect(png.headers["content-disposition"]).toBe("attachment; filename=qr-pizzeria-napoli.png");
  });
});
