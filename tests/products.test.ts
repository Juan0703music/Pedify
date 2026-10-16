import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { login, PASSWORD, registerMerchant, uniqueEmail } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(resetDatabase);

type Agent = Awaited<ReturnType<typeof registerMerchant>>["agent"];

async function createCategory(agent: Agent, name: string) {
  const res = await agent.post("/api/v1/categories").send({ name }).expect(201);
  return res.body.data as { id: string; name: string; position: number };
}

async function createProduct(agent: Agent, body: Record<string, unknown>) {
  const res = await agent.post("/api/v1/products").send(body).expect(201);
  return res.body.data as { id: string; name: string; price: number; position: number; categoryId: string | null; imageUrl: string | null };
}

/** Empleado del negocio del agente propietario. */
async function addEmployee(owner: Agent) {
  const email = uniqueEmail("empleado");
  await owner.post("/api/v1/businesses/current/members").send({ name: "Carlos Mesa", email, password: PASSWORD }).expect(201);
  return login(email);
}

/** Foto de prueba con metadatos EXIF (como las del celular). */
function photo(width = 1600, height = 1200) {
  return sharp({ create: { width, height, channels: 3, background: "#ffc72c" } })
    .jpeg()
    .withExif({ IFD0: { Copyright: "Foto de celular", ImageDescription: "GPS 9.3047,-75.3978" } })
    .toBuffer();
}

/** Registra un pedido real para un producto (para probar que se archiva en lugar de borrarse). */
async function orderProduct(businessId: string, productId: string) {
  const customer = await prisma.customer.create({ data: { businessId, name: "Luis", phone: "573001112233" } });
  await prisma.order.create({
    data: {
      businessId,
      customerId: customer.id,
      number: 1,
      deliveryType: "PICKUP",
      customerName: "Luis",
      customerPhone: "573001112233",
      subtotal: 18000,
      total: 18000,
      items: { create: { productId, productName: "Hamburguesa especial", unitPrice: 18000, quantity: 1, subtotal: 18000 } },
    },
  });
}

describe("Productos", () => {
  it("crea, consulta, edita y lista productos del menú", async () => {
    const { agent } = await registerMerchant();
    const hamburguesas = await createCategory(agent, "Hamburguesas");

    const created = await createProduct(agent, {
      name: "Hamburguesa especial",
      description: "Carne de res, queso costeño y papitas",
      price: 18000,
      categoryId: hamburguesas.id,
    });
    expect(created).toMatchObject({
      name: "Hamburguesa especial",
      price: 18000,
      categoryId: hamburguesas.id,
      isActive: true,
      isAvailable: true,
      position: 0,
      imageUrl: null,
    });
    expect(created).not.toHaveProperty("imageKey");

    const second = await createProduct(agent, { name: "Hamburguesa doble", price: 24000, categoryId: hamburguesas.id });
    expect(second.position).toBe(1);

    const patched = await agent
      .patch(`/api/v1/products/${created.id}`)
      .send({ price: 19000, description: "", isActive: false })
      .expect(200);
    expect(patched.body.data).toMatchObject({ price: 19000, description: null, isActive: false });

    const list = await agent.get("/api/v1/products").expect(200);
    expect(list.body.data.map((product: { name: string }) => product.name)).toEqual(["Hamburguesa especial", "Hamburguesa doble"]);

    const one = await agent.get(`/api/v1/products/${second.id}`).expect(200);
    expect(one.body.data.name).toBe("Hamburguesa doble");

    const summary = await agent.get("/api/v1/products/summary").expect(200);
    expect(summary.body.data).toEqual({ total: 2, visible: 1, soldOut: 0, withImage: 0 });
  });

  it("valida nombre, precio entero en pesos y categoría", async () => {
    const { agent } = await registerMerchant();

    const invalid = await agent.post("/api/v1/products").send({ name: "", price: 1500.5 }).expect(400);
    expect(invalid.body.error.fields).toMatchObject({ name: expect.any(String), price: expect.any(String) });

    const zero = await agent.post("/api/v1/products").send({ name: "Agua", price: 0 }).expect(400);
    expect(zero.body.error.fields.price).toMatch(/mayor que \$0/);

    const missingCategory = await agent
      .post("/api/v1/products")
      .send({ name: "Agua", price: 3000, categoryId: "0199e2a4-0000-7000-8000-000000000000" })
      .expect(400);
    expect(missingCategory.body.error.code).toBe("CATEGORY_NOT_FOUND");
  });

  it("al cambiar de categoría, el producto queda al final de la nueva", async () => {
    const { agent } = await registerMerchant();
    const perros = await createCategory(agent, "Perros");
    const salchipapas = await createCategory(agent, "Salchipapas");
    await createProduct(agent, { name: "Salchipapa", price: 15000, categoryId: salchipapas.id });
    const perro = await createProduct(agent, { name: "Perro suizo", price: 14000, categoryId: perros.id });

    const moved = await agent.patch(`/api/v1/products/${perro.id}`).send({ categoryId: salchipapas.id }).expect(200);
    expect(moved.body.data).toMatchObject({ categoryId: salchipapas.id, position: 1 });
  });

  it("ordena los productos de una categoría y rechaza listas desactualizadas", async () => {
    const { agent } = await registerMerchant();
    const a = await createProduct(agent, { name: "Salchipapa", price: 15000 });
    const b = await createProduct(agent, { name: "Salchipapa especial", price: 22000 });
    const c = await createProduct(agent, { name: "Salchipapa ranchera", price: 20000 });

    await agent.put("/api/v1/products/order").send({ categoryId: null, productIds: [c.id, a.id, b.id] }).expect(204);
    const list = await agent.get("/api/v1/products").expect(200);
    expect(list.body.data.map((product: { id: string }) => product.id)).toEqual([c.id, a.id, b.id]);

    const outdated = await agent.put("/api/v1/products/order").send({ categoryId: null, productIds: [a.id, b.id] }).expect(409);
    expect(outdated.body.error.code).toBe("ORDER_OUTDATED");
  });

  it("elimina un producto sin pedidos y archiva uno que ya aparece en pedidos", async () => {
    const { agent, businessId } = await registerMerchant();
    const unused = await createProduct(agent, { name: "Jugo de corozo", price: 5000 });
    const sold = await createProduct(agent, { name: "Hamburguesa especial", price: 18000 });
    await orderProduct(businessId, sold.id);

    const deleted = await agent.delete(`/api/v1/products/${unused.id}`).expect(200);
    expect(deleted.body.data).toEqual({ result: "deleted" });
    await agent.get(`/api/v1/products/${unused.id}`).expect(404);

    const archived = await agent.delete(`/api/v1/products/${sold.id}`).expect(200);
    expect(archived.body.data).toEqual({ result: "archived" });

    // Sale del menú vigente, pero el pedido conserva su detalle.
    const current = await agent.get("/api/v1/products").expect(200);
    expect(current.body.data).toHaveLength(0);
    const archivedList = await agent.get("/api/v1/products?status=archived").expect(200);
    expect(archivedList.body.data.map((product: { id: string }) => product.id)).toEqual([sold.id]);
    expect(await prisma.orderItem.count({ where: { productId: sold.id } })).toBe(1);

    const editArchived = await agent.patch(`/api/v1/products/${sold.id}`).send({ price: 20000 }).expect(409);
    expect(editArchived.body.error.code).toBe("PRODUCT_ARCHIVED");

    const restored = await agent.post(`/api/v1/products/${sold.id}/restore`).expect(200);
    expect(restored.body.data.archivedAt).toBeNull();
  });
});

describe("Categorías", () => {
  it("crea, renombra, ordena y cuenta productos por categoría", async () => {
    const { agent } = await registerMerchant();
    const bebidas = await createCategory(agent, "Bebidas");
    const pizzas = await createCategory(agent, "Pizzas");
    await createProduct(agent, { name: "Gaseosa", price: 4000, categoryId: bebidas.id });

    const duplicate = await agent.post("/api/v1/categories").send({ name: "bebidas" }).expect(409);
    expect(duplicate.body.error.code).toBe("CATEGORY_EXISTS");

    const renamed = await agent.patch(`/api/v1/categories/${pizzas.id}`).send({ name: "Pizzas artesanales" }).expect(200);
    expect(renamed.body.data.name).toBe("Pizzas artesanales");

    await agent.put("/api/v1/categories/order").send({ categoryIds: [pizzas.id, bebidas.id] }).expect(204);
    const list = await agent.get("/api/v1/categories").expect(200);
    expect(list.body.data).toMatchObject([
      { id: pizzas.id, name: "Pizzas artesanales", position: 0, productCount: 0 },
      { id: bebidas.id, name: "Bebidas", position: 1, productCount: 1 },
    ]);
  });

  it("al eliminar una categoría sus productos pasan a «Sin categoría» en el mismo orden", async () => {
    const { agent } = await registerMerchant();
    await createProduct(agent, { name: "Sin categoría previa", price: 3000 });
    const perros = await createCategory(agent, "Perros");
    const sencillo = await createProduct(agent, { name: "Perro sencillo", price: 9000, categoryId: perros.id });
    const suizo = await createProduct(agent, { name: "Perro suizo", price: 14000, categoryId: perros.id });

    const res = await agent.delete(`/api/v1/categories/${perros.id}`).expect(200);
    expect(res.body.data).toEqual({ movedProducts: 2 });

    const list = await agent.get("/api/v1/products").expect(200);
    const moved = list.body.data.filter((product: { id: string }) => [sencillo.id, suizo.id].includes(product.id));
    expect(moved).toMatchObject([
      { id: sencillo.id, categoryId: null, position: 1 },
      { id: suizo.id, categoryId: null, position: 2 },
    ]);
  });

  it("elige los productos de una categoría: marca, desmarca y conserva el orden", async () => {
    const { agent } = await registerMerchant();
    const combos = await createCategory(agent, "Combos");
    const bebidas = await createCategory(agent, "Bebidas");
    const combo1 = await createProduct(agent, { name: "Combo 1", price: 20000, categoryId: combos.id });
    const combo2 = await createProduct(agent, { name: "Combo 2", price: 25000, categoryId: combos.id });
    const gaseosa = await createProduct(agent, { name: "Gaseosa", price: 4000, categoryId: bebidas.id });
    const suelto = await createProduct(agent, { name: "Papas", price: 6000 });

    // Combo 2 se queda, Combo 1 sale, entran Papas y Gaseosa (en ese orden, al final).
    const res = await agent
      .put(`/api/v1/categories/${combos.id}/products`)
      .send({ productIds: [suelto.id, combo2.id, gaseosa.id] })
      .expect(200);
    expect(res.body.data).toEqual({ added: 2, removed: 1, productCount: 3 });

    const list = (await agent.get("/api/v1/products").expect(200)).body.data as { id: string; categoryId: string | null; position: number }[];
    const byId = new Map(list.map((product) => [product.id, product]));
    expect(byId.get(combo2.id)).toMatchObject({ categoryId: combos.id, position: 0 });
    expect(byId.get(suelto.id)).toMatchObject({ categoryId: combos.id, position: 1 });
    expect(byId.get(gaseosa.id)).toMatchObject({ categoryId: combos.id, position: 2 });
    expect(byId.get(combo1.id)).toMatchObject({ categoryId: null });

    // Desmarcar todo vacía la categoría sin borrarla.
    const emptied = await agent.put(`/api/v1/categories/${combos.id}/products`).send({ productIds: [] }).expect(200);
    expect(emptied.body.data).toEqual({ added: 0, removed: 3, productCount: 0 });
    const categories = await agent.get("/api/v1/categories").expect(200);
    expect(categories.body.data.find((category: { id: string }) => category.id === combos.id)).toMatchObject({ productCount: 0 });
  });

  it("al elegir productos rechaza los de otro negocio, los archivados y a los empleados", async () => {
    const { agent } = await registerMerchant();
    const other = await registerMerchant({ businessName: "Otro negocio" });
    const combos = await createCategory(agent, "Combos");
    const ajeno = await createProduct(other.agent, { name: "Ajeno", price: 1000 });
    const propio = await createProduct(agent, { name: "Propio", price: 1000 });

    const foreign = await agent.put(`/api/v1/categories/${combos.id}/products`).send({ productIds: [propio.id, ajeno.id] }).expect(400);
    expect(foreign.body.error.code).toBe("PRODUCT_NOT_FOUND");
    expect((await agent.get(`/api/v1/products/${propio.id}`).expect(200)).body.data.categoryId).toBeNull();

    await other.agent.put(`/api/v1/categories/${combos.id}/products`).send({ productIds: [] }).expect(404);
    await agent.put(`/api/v1/categories/${combos.id}/products`).send({ productIds: [propio.id, propio.id] }).expect(400);

    const employee = await addEmployee(agent);
    await employee.put(`/api/v1/categories/${combos.id}/products`).send({ productIds: [propio.id] }).expect(403);
  });
});

describe("Fotos de productos", () => {
  it("procesa la foto: la reduce, la convierte a WebP y le quita los metadatos", async () => {
    const { agent, businessId } = await registerMerchant();
    const product = await createProduct(agent, { name: "Salchipapa", price: 15000 });

    const res = await agent
      .post(`/api/v1/products/${product.id}/image`)
      .set("Content-Type", "image/jpeg")
      .send(await photo())
      .expect(200);

    const imageUrl: string = res.body.data.imageUrl;
    expect(imageUrl).toMatch(new RegExp(`^/uploads/businesses/${businessId}/products/${product.id}/[\\w-]+\\.webp$`));

    const served = await agent.get(imageUrl).buffer(true).expect(200);
    expect(served.headers["content-type"]).toBe("image/webp");
    expect(served.headers["cache-control"]).toContain("immutable");
    const meta = await sharp(served.body as Buffer).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 800, height: 600 });
    expect(meta.exif).toBeUndefined();
  });

  it("al reemplazar o quitar la foto borra el archivo anterior", async () => {
    const { agent } = await registerMerchant();
    const product = await createProduct(agent, { name: "Pizza hawaiana", price: 32000 });
    const uploadsDir = process.env.UPLOADS_DIR!;
    const fileOf = (url: string) => path.join(uploadsDir, url.replace(/^\/uploads\//, ""));

    const first = await agent.post(`/api/v1/products/${product.id}/image`).set("Content-Type", "image/jpeg").send(await photo());
    const second = await agent
      .post(`/api/v1/products/${product.id}/image`)
      .set("Content-Type", "image/jpeg")
      .send(await photo(900, 900))
      .expect(200);
    expect(existsSync(fileOf(first.body.data.imageUrl))).toBe(false);
    expect(existsSync(fileOf(second.body.data.imageUrl))).toBe(true);

    const removed = await agent.delete(`/api/v1/products/${product.id}/image`).expect(200);
    expect(removed.body.data.imageUrl).toBeNull();
    expect(existsSync(fileOf(second.body.data.imageUrl))).toBe(false);
  });

  it("rechaza archivos que no son imágenes y fotos de más de 8 MB", async () => {
    const { agent } = await registerMerchant();
    const product = await createProduct(agent, { name: "Pizza", price: 30000 });

    const notImage = await agent
      .post(`/api/v1/products/${product.id}/image`)
      .set("Content-Type", "image/png")
      .send(Buffer.from("<script>alert(1)</script>"))
      .expect(415);
    expect(notImage.body.error.code).toBe("UNSUPPORTED_IMAGE");

    const tooLarge = await agent
      .post(`/api/v1/products/${product.id}/image`)
      .set("Content-Type", "image/jpeg")
      .send(Buffer.alloc(8 * 1024 * 1024 + 1))
      .expect(413);
    expect(tooLarge.body.error.code).toBe("IMAGE_TOO_LARGE");

    const empty = await agent.post(`/api/v1/products/${product.id}/image`).set("Content-Type", "image/jpeg").expect(400);
    expect(empty.body.error.code).toBe("IMAGE_REQUIRED");
  });
});

describe("Permisos y aislamiento entre negocios", () => {
  it("un negocio no puede ver, editar ni borrar productos o categorías de otro", async () => {
    const a = await registerMerchant({ businessName: "Sabores del Caribe" });
    const b = await registerMerchant({ businessName: "Pizzería Napoli" });
    const category = await createCategory(a.agent, "Hamburguesas");
    const product = await createProduct(a.agent, { name: "Hamburguesa especial", price: 18000, categoryId: category.id });

    await b.agent.get(`/api/v1/products/${product.id}`).expect(404);
    await b.agent.patch(`/api/v1/products/${product.id}`).send({ price: 1 }).expect(404);
    await b.agent.delete(`/api/v1/products/${product.id}`).expect(404);
    await b.agent.post(`/api/v1/products/${product.id}/image`).set("Content-Type", "image/jpeg").send(await photo()).expect(404);
    await b.agent.patch(`/api/v1/categories/${category.id}`).send({ name: "Mías" }).expect(404);
    await b.agent.delete(`/api/v1/categories/${category.id}`).expect(404);

    // Tampoco puede usar la categoría ajena en sus productos ni colarla al ordenar.
    const foreign = await b.agent.post("/api/v1/products").send({ name: "Pizza", price: 30000, categoryId: category.id }).expect(400);
    expect(foreign.body.error.code).toBe("CATEGORY_NOT_FOUND");
    await b.agent.put("/api/v1/products/order").send({ categoryId: category.id, productIds: [product.id] }).expect(409);

    const listB = await b.agent.get("/api/v1/products").expect(200);
    expect(listB.body.data).toHaveLength(0);
    const unchanged = await a.agent.get(`/api/v1/products/${product.id}`).expect(200);
    expect(unchanged.body.data.price).toBe(18000);
  });

  it("un empleado consulta el menú y marca agotados, pero no edita ni crea productos", async () => {
    const { agent: owner } = await registerMerchant();
    const product = await createProduct(owner, { name: "Salchipapa", price: 15000 });
    const employee = await addEmployee(owner);

    await employee.get("/api/v1/products").expect(200);
    const soldOut = await employee.patch(`/api/v1/products/${product.id}`).send({ isAvailable: false }).expect(200);
    expect(soldOut.body.data.isAvailable).toBe(false);

    const edit = await employee.patch(`/api/v1/products/${product.id}`).send({ isAvailable: true, price: 1000 }).expect(403);
    expect(edit.body.error.code).toBe("ROLE_REQUIRED");
    await employee.post("/api/v1/products").send({ name: "Gratis", price: 100 }).expect(403);
    await employee.delete(`/api/v1/products/${product.id}`).expect(403);
    await employee.post("/api/v1/categories").send({ name: "Mía" }).expect(403);
    await employee.post(`/api/v1/products/${product.id}/image`).set("Content-Type", "image/jpeg").send(await photo()).expect(403);
  });

  it("sin sesión no hay acceso al menú del panel", async () => {
    const { agent } = await registerMerchant();
    await createProduct(agent, { name: "Salchipapa", price: 15000 });
    const { newAgent } = await import("./helpers/app.js");
    await newAgent().get("/api/v1/products").expect(401);
    await newAgent().post("/api/v1/categories").send({ name: "Bebidas" }).expect(401);
  });
});
