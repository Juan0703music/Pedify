/**
 * Datos de demostración para desarrollo:  npm run db:seed
 *
 * Crea el comerciante demo, su negocio "Sabores del Caribe" (Sincelejo) y su menú.
 * Es idempotente: no duplica el usuario ni el menú si ya existen.
 * En el entorno de pruebas (APP_ENV=staging) también se puede usar, con DEMO_PASSWORD definida
 * (ese servidor es público: la contraseña de ejemplo no sirve allí). En producción no se ejecuta.
 */
import { readFile } from "node:fs/promises";
import { prisma } from "../src/config/database.js";
import { isProduction, isStaging } from "../src/config/env.js";
import { authRepository } from "../src/modules/auth/auth.repository.js";
import { hashPassword } from "../src/modules/auth/password.js";
import { businessesService } from "../src/modules/businesses/businesses.service.js";
import { calculateOrder } from "../src/services/pricing.service.js";
import { saveImage } from "../src/services/storage.service.js";
import { addDays, dateIn, startOfDay } from "../src/utils/dates.js";

const DEMO_EMAIL = "demo@pedifyai.com";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "pedifyai123";
const DEMO_HOURS = Array.from({ length: 7 }, (_, day) => ({ day, closed: day === 1, open: "08:00", close: "23:30" }));

/** Menú de ejemplo; los precios del ejemplo del documento (sección 8): hamburguesa $18.000, bebida $4.000, salchipapa $15.000. */
const DEMO_MENU: { category: string; products: { name: string; price: number; description?: string; available?: boolean }[] }[] = [
  {
    category: "Hamburguesas",
    products: [
      { name: "Hamburguesa especial", price: 18000, description: "Carne de res de 150 g, queso costeño, tocineta, lechuga, tomate y salsas de la casa." },
      { name: "Hamburguesa sencilla", price: 13000, description: "Carne de res, queso, lechuga y tomate." },
      { name: "Hamburguesa doble carne", price: 24000, description: "Dos carnes de 150 g, doble queso y tocineta." },
    ],
  },
  {
    category: "Salchipapas",
    products: [
      { name: "Salchipapa", price: 15000, description: "Papas a la francesa con salchicha, queso rallado y salsas." },
      { name: "Salchipapa especial", price: 22000, description: "Con pollo desmechado, butifarra, queso costeño gratinado y huevos de codorniz." },
      { name: "Salchipapa ranchera", price: 20000, description: "Con chorizo, salchicha ranchera y maíz tierno.", available: false },
    ],
  },
  {
    category: "Perros calientes",
    products: [
      { name: "Perro sencillo", price: 9000, description: "Salchicha americana, papitas ripio y salsas." },
      { name: "Perro suizo", price: 14000, description: "Salchicha suiza, queso gratinado, tocineta y cebolla caramelizada." },
    ],
  },
  {
    category: "Bebidas",
    products: [
      { name: "Bebida", price: 4000, description: "Gaseosa personal de 400 ml." },
      { name: "Jugo natural", price: 6000, description: "Corozo, maracuyá o mango. En agua o en leche." },
      { name: "Agua", price: 3000 },
    ],
  },
  {
    category: "Adicionales",
    products: [
      { name: "Porción de papas", price: 6000 },
      { name: "Queso costeño extra", price: 2500 },
    ],
  },
];

/** Fotos de ejemplo (public/assets/images/food, de dominio público; ver scripts/photos.ts). "Agua" y el queso quedan sin foto a propósito. */
const DEMO_PHOTOS: Record<string, string> = {
  "Hamburguesa especial": "burger-closeup",
  "Hamburguesa sencilla": "burger-classic",
  "Hamburguesa doble carne": "burger-dark",
  Salchipapa: "fries-bowl",
  "Salchipapa especial": "fries-sauce",
  "Salchipapa ranchera": "sausages-grill",
  "Perro sencillo": "hotdog-classic",
  "Perro suizo": "hotdog-loaded",
  Bebida: "soda-glass",
  "Jugo natural": "juice-orange",
  "Porción de papas": "fries-cup",
};
const DEMO_BANNER = "burger-board";

const demoPhoto = (name: string) => readFile(new URL(`../public/assets/images/food/${name}-960.webp`, import.meta.url));

/** Pone las fotos de ejemplo a los productos demo que no tienen y la portada del negocio si falta. */
async function ensurePhotos(businessId: string): Promise<number> {
  const products = await prisma.product.findMany({
    where: { businessId, imageUrl: null, archivedAt: null, name: { in: Object.keys(DEMO_PHOTOS) } },
    select: { id: true, name: true },
  });
  for (const product of products) {
    const saved = await saveImage(await demoPhoto(DEMO_PHOTOS[product.name]!), "product", `businesses/${businessId}/products/${product.id}`);
    await prisma.product.update({ where: { id: product.id }, data: { imageUrl: saved.url, imageKey: saved.key } });
  }
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { bannerUrl: true } });
  if (!business.bannerUrl) {
    const saved = await saveImage(await demoPhoto(DEMO_BANNER), "banner", `businesses/${businessId}/banner`);
    await prisma.business.update({ where: { id: businessId }, data: { bannerUrl: saved.url, bannerKey: saved.key } });
  }
  return products.length;
}

async function ensureMenu(businessId: string): Promise<number> {
  if ((await prisma.category.count({ where: { businessId } })) > 0) return 0;
  let count = 0;
  await prisma.$transaction(async (tx) => {
    for (const [categoryPosition, section] of DEMO_MENU.entries()) {
      const category = await tx.category.create({ data: { businessId, name: section.category, position: categoryPosition } });
      for (const [position, product] of section.products.entries()) {
        await tx.product.create({
          data: {
            businessId,
            categoryId: category.id,
            position,
            name: product.name,
            description: product.description ?? null,
            price: product.price,
            isAvailable: product.available ?? true,
          },
        });
        count++;
      }
    }
  });
  return count;
}

// ─── Historial de pedidos de ejemplo (para ver Analíticas con datos) ───

const DEMO_CUSTOMERS: [string, string][] = [
  ["Luis Gómez", "573112223344"], ["Ana Ruiz", "573001112233"], ["Carlos Pérez", "573015550101"], ["María Arrieta", "573126667788"],
  ["Jorge Salgado", "573205554433"], ["Paola Benítez", "573148889900"], ["Andrés Montes", "573176661122"], ["Camila Oviedo", "573004443322"],
  ["Daniel Tapia", "573187770011"], ["Valentina Meza", "573159998877"], ["Sebastián Díaz", "573223334455"], ["Laura Vergara", "573014445566"],
];
const DEMO_ADDRESSES: [string, string | null][] = [
  ["Calle 23 #18-40, barrio La Ford", "Casa esquinera de rejas blancas"], ["Carrera 25 #10-12, barrio Majagual", "Frente a la tienda La Nueva"],
  ["Calle 32 #22-15, barrio Venecia", null], ["Transversal 7 #15-80, barrio Las Américas", "Segundo piso"],
  ["Calle 15 #30-05, barrio El Bosque", "Al lado del parque"],
];
const DEMO_PAYMENTS = ["CASH", "CASH", "NEQUI", "DAVIPLATA"] as const;

/** Generador pseudoaleatorio con semilla: el historial de ejemplo siempre es el mismo. */
function seededRandom(seed: number) {
  let value = seed;
  return () => {
    value = (value * 1_103_515_245 + 12_345) % 2_147_483_648;
    return value / 2_147_483_648;
  };
}

async function ensureDemoOrders(businessId: string): Promise<number> {
  const timeZone = "America/Bogota";
  const today = dateIn(new Date(), timeZone);
  if ((await prisma.order.count({ where: { businessId, createdAt: { lt: startOfDay(today, timeZone) } } })) > 0) return 0;

  const products = await prisma.product.findMany({ where: { businessId, archivedAt: null }, select: { id: true, name: true, price: true } });
  if (products.length === 0) return 0;
  const byName = new Map(products.map((product) => [product.name, product]));
  // Más probabilidad para los platos fuertes y las bebidas.
  const weighted = [
    ...["Hamburguesa especial", "Hamburguesa especial", "Salchipapa", "Salchipapa", "Salchipapa especial", "Perro suizo"],
    ...["Hamburguesa sencilla", "Hamburguesa doble carne", "Perro sencillo", "Bebida", "Bebida", "Jugo natural", "Porción de papas"],
  ]
    .map((name) => byName.get(name))
    .filter((product): product is NonNullable<typeof product> => Boolean(product));
  const random = seededRandom(20261016);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
  const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { businessId }, select: { deliveryFee: true } });
  const owner = await prisma.businessMembership.findFirst({ where: { businessId, role: "OWNER" }, select: { userId: true } });

  let created = 0;
  for (let daysAgo = 21; daysAgo >= 1; daysAgo--) {
    const date = addDays(today, -daysAgo);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday === 1) continue; // lunes cerrado
    const count = (weekday === 5 || weekday === 6 ? 5 : 2) + Math.floor(random() * 3);
    // Entre 5:00 p. m. y 11:00 p. m., con más pedidos de 7 a 9; en orden para que los números sean consecutivos.
    const minutes = Array.from({ length: count }, () => 17 * 60 + Math.floor(((random() + random() + random()) / 3) * 360)).sort((a, b) => a - b);
    for (let n = 0; n < count; n++) {
      const minute = minutes[n]!;
      const createdAt = new Date(startOfDay(date, timeZone).getTime() + minute * 60_000);
      const [name, phone] = pick(DEMO_CUSTOMERS);
      const isDelivery = random() < 0.7;
      const [address, references] = pick(DEMO_ADDRESSES);
      const lines = new Map<string, number>();
      const itemCount = 1 + Math.floor(random() * 3);
      for (let i = 0; i < itemCount; i++) {
        const product = pick(weighted);
        lines.set(product.id, (lines.get(product.id) ?? 0) + 1 + (random() < 0.25 ? 1 : 0));
      }
      const totals = calculateOrder({
        items: [...lines].map(([id, quantity]) => ({ product: products.find((product) => product.id === id)!, quantity })),
        deliveryType: isDelivery ? "DELIVERY" : "PICKUP",
        deliveryFee: settings.deliveryFee,
      });
      const cancelled = random() < 0.08;
      const steps = (cancelled ? ["PENDING", "CANCELLED"] : ["PENDING", "CONFIRMED", "PREPARING", "READY", ...(isDelivery ? ["OUT_FOR_DELIVERY"] : []), "DELIVERED"]) as (
        | "PENDING"
        | "CONFIRMED"
        | "PREPARING"
        | "READY"
        | "OUT_FOR_DELIVERY"
        | "DELIVERED"
        | "CANCELLED"
      )[];

      await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.upsert({
          where: { businessId_phone: { businessId, phone } },
          create: { businessId, name, phone, createdAt },
          update: {},
        });
        if (isDelivery && !(await tx.customerAddress.findFirst({ where: { customerId: customer.id, address } }))) {
          await tx.customerAddress.create({ data: { customerId: customer.id, address, references, createdAt } });
        }
        const { lastOrderNumber } = await tx.business.update({ where: { id: businessId }, data: { lastOrderNumber: { increment: 1 } } });
        const finishedAt = new Date(createdAt.getTime() + (25 + Math.floor(random() * 30)) * 60_000);
        await tx.order.create({
          data: {
            businessId,
            customerId: customer.id,
            number: lastOrderNumber,
            status: steps.at(-1)!,
            deliveryType: isDelivery ? "DELIVERY" : "PICKUP",
            customerName: name,
            customerPhone: phone,
            deliveryAddress: isDelivery ? address : null,
            addressReferences: isDelivery ? references : null,
            paymentMethod: pick(DEMO_PAYMENTS),
            subtotal: totals.subtotal,
            deliveryFee: totals.deliveryFee,
            discount: 0,
            total: totals.total,
            idempotencyKey: `demo-${date}-${n}`,
            whatsappOpenedAt: new Date(createdAt.getTime() + 30_000),
            paidAt: cancelled ? null : finishedAt,
            cancelReason: cancelled ? "El cliente no confirmó por WhatsApp" : null,
            createdAt,
            items: {
              create: totals.lines.map((line) => ({
                productId: line.productId,
                productName: line.name,
                unitPrice: line.unitPrice,
                quantity: line.quantity,
                subtotal: line.subtotal,
              })),
            },
            statusHistory: {
              create: steps.map((status, index) => ({
                fromStatus: index === 0 ? null : steps[index - 1],
                toStatus: status,
                changedById: index === 0 ? null : (owner?.userId ?? null),
                createdAt: new Date(createdAt.getTime() + index * 7 * 60_000),
              })),
            },
          },
        });
      });
      created++;
    }
  }
  return created;
}

async function main() {
  if (isProduction && !isStaging) {
    throw new Error("El seed de demostración no se ejecuta en producción.");
  }
  if (isProduction && (!process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 10)) {
    throw new Error("En el entorno de pruebas define DEMO_PASSWORD (mínimo 10 caracteres) para la cuenta de demostración.");
  }

  const existing = await authRepository.findUserByEmail(DEMO_EMAIL);
  if (existing) {
    const membership = await prisma.businessMembership.findFirst({
      where: { userId: existing.id, role: "OWNER" },
      orderBy: { createdAt: "asc" },
      select: { businessId: true },
    });
    const added = membership ? await ensureMenu(membership.businessId) : 0;
    const orders = membership ? await ensureDemoOrders(membership.businessId) : 0;
    const photos = membership ? await ensurePhotos(membership.businessId) : 0;
    const changes = [
      added ? `menú de ejemplo (${added} productos)` : "",
      orders ? `historial de ejemplo (${orders} pedidos)` : "",
      photos ? `fotos de ejemplo (${photos} productos)` : "",
    ].filter(Boolean);
    console.log(`El usuario ${DEMO_EMAIL} ya existe.${changes.length ? ` Se agregó: ${changes.join(" y ")}.` : " No se cambió nada."}`);
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const business = await prisma.$transaction(async (tx) => {
    const user = await authRepository.createUser({ name: "Comerciante Demo", email: DEMO_EMAIL, passwordHash }, tx);
    const created = await businessesService.createForOwner(user.id, { name: "Sabores del Caribe", phone: "573001234567" }, tx);

    await tx.business.update({
      where: { id: created.id },
      data: {
        description: "Hamburguesas, salchipapas y bebidas con el sabor de la costa.",
        city: "Sincelejo",
        address: "Calle 20 #15-30",
      },
    });
    await tx.businessSettings.update({
      where: { businessId: created.id },
      data: {
        // Lunes cerrado; de martes a domingo de 8:00 a. m. a 11:30 p. m. (horario amplio para probar pedidos).
        openingHours: DEMO_HOURS,
        deliveryFee: 4000,
        deliveryArea: "Todo Sincelejo",
        minimumOrder: 15000,
        paymentMethods: ["CASH", "NEQUI", "DAVIPLATA"],
      },
    });
    return created;
  });
  const products = await ensureMenu(business.id);
  const orders = await ensureDemoOrders(business.id);
  await ensurePhotos(business.id);

  console.log("Datos de demostración creados:");
  console.log(`  Correo:     ${DEMO_EMAIL}`);
  console.log(`  Contraseña: ${process.env.DEMO_PASSWORD ? "la de DEMO_PASSWORD" : DEMO_PASSWORD}`);
  console.log(`  Negocio:    Sabores del Caribe (/tienda/${business.slug}), ${products} productos con fotos, ${orders} pedidos de ejemplo`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
