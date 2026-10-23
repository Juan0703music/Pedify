import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/config/database.js";
import { deliveryReachKm, feeForDistance, MAX_DELIVERY_KM, parseDeliveryTiers } from "../src/services/pricing.service.js";
import { clock } from "../src/utils/clock.js";
import { distanceLabel, distanceMeters } from "../src/utils/geo.js";
import { newAgent, registerMerchant } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

/** Martes 7:00 p. m. en Colombia: dentro del horario por defecto (11:00–22:00). */
const TUESDAY_EVENING = new Date("2026-10-13T19:00:00-05:00");

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(clock, "now").mockReturnValue(TUESDAY_EVENING);
});

afterEach(() => vi.restoreAllMocks());

/** El negocio, en el centro de Sincelejo. Un grado de latitud son unos 111,2 km. */
const SHOP = { lat: 9.3047, lng: -75.3978 };
const north = (km: number) => ({ lat: Number((SHOP.lat + km / 111.195).toFixed(6)), lng: SHOP.lng });

const TIERS = [
  { upToKm: 2, fee: 3000 },
  { upToKm: 4, fee: 5000 },
  { upToKm: 6, fee: 7000 },
];

async function setupStore(settings: Record<string, unknown>) {
  const merchant = await registerMerchant();
  const { agent } = merchant;
  await agent.patch("/api/v1/businesses/current/settings").send(settings).expect(200);
  const product = (await agent.post("/api/v1/products").send({ name: "Salchipapa", price: 15000 }).expect(201)).body.data as { id: string };
  const slug = (await agent.get("/api/v1/businesses/current")).body.data.slug as string;
  return { ...merchant, slug, productId: product.id };
}

const placeOrder = (slug: string, productId: string, extra: Record<string, unknown> = {}) =>
  newAgent()
    .post(`/api/v1/store/${slug}/orders`)
    .send({
      idempotencyKey: randomUUID(),
      items: [{ productId, quantity: 1 }],
      name: "Laura Vergara",
      phone: "311 222 3344",
      deliveryType: "DELIVERY",
      address: "Calle 23 #18-40",
      paymentMethod: "CASH",
      ...extra,
    });

describe("Cálculo de la distancia y del valor del domicilio", () => {
  it("mide en línea recta y elige el primer rango que cubre la distancia", () => {
    expect(distanceMeters(SHOP, north(1))).toBeCloseTo(1000, -1);
    expect(distanceLabel(3240)).toBe("3,2 km");
    expect(distanceLabel(452)).toBe("450 m");
    const onlyTiers = { tiers: TIERS, extraKmFee: null, maxKm: null };
    expect(feeForDistance(onlyTiers, 1500)).toBe(3000);
    expect(feeForDistance(onlyTiers, 2000)).toBe(3000); // justo en el límite: el rango más barato
    expect(feeForDistance(onlyTiers, 2040)).toBe(3000); // de a 100 m: 2,04 km cuenta como 2 km
    expect(feeForDistance(onlyTiers, 2100)).toBe(5000);
    expect(feeForDistance(onlyTiers, 6500)).toBeNull();
    expect(deliveryReachKm(onlyTiers)).toBe(6);

    // Toda la ciudad: más allá del último rango, cada km empezado suma el valor adicional.
    const wholeCity = { tiers: TIERS, extraKmFee: 1000, maxKm: null };
    expect(feeForDistance(wholeCity, 6000)).toBe(7000);
    expect(feeForDistance(wholeCity, 6100)).toBe(8000);
    expect(feeForDistance(wholeCity, 20_000)).toBe(21_000);
    expect(deliveryReachKm(wholeCity)).toBe(MAX_DELIVERY_KM);
    expect(feeForDistance(wholeCity, 50_500)).toBeNull(); // el tope de Pedify: 50 km
    // Con un máximo propio, no se lleva más lejos aunque haya valor por km.
    expect(feeForDistance({ ...wholeCity, maxKm: 10 }, 10_500)).toBeNull();
    expect(deliveryReachKm({ ...wholeCity, maxKm: 10 })).toBe(10);
    expect(parseDeliveryTiers([{ upToKm: 4, fee: 5000 }, { upToKm: 2, fee: 3000 }, { nada: true }])).toEqual([
      { upToKm: 2, fee: 3000 },
      { upToKm: 4, fee: 5000 },
    ]);
  });
});

describe("Domicilio según la distancia", () => {
  it("la configuración exige la ubicación del negocio y rangos de menor a mayor", async () => {
    const { agent } = await registerMerchant();
    const settings = "/api/v1/businesses/current/settings";

    const noLocation = await agent.patch(settings).send({ deliveryPricing: "DISTANCE", deliveryTiers: TIERS }).expect(400);
    expect(noLocation.body.error).toMatchObject({ code: "LOCATION_REQUIRED" });
    const noTiers = await agent.patch(settings).send({ deliveryPricing: "DISTANCE", location: SHOP }).expect(400);
    expect(noTiers.body.error).toMatchObject({ code: "DELIVERY_TIERS_REQUIRED" });
    const unordered = await agent
      .patch(settings)
      .send({ deliveryPricing: "DISTANCE", location: SHOP, deliveryTiers: [{ upToKm: 4, fee: 5000 }, { upToKm: 2, fee: 3000 }] })
      .expect(400);
    expect(JSON.stringify(unordered.body.error)).toContain("Cada rango debe llegar más lejos que el anterior.");

    const saved = await agent.patch(settings).send({ deliveryPricing: "DISTANCE", location: SHOP, deliveryTiers: [{ upToKm: 2.04, fee: 3000 }, ...TIERS.slice(1)] }).expect(200);
    expect(saved.body.data).toMatchObject({ deliveryPricing: "DISTANCE", location: SHOP, deliveryTiers: TIERS });
    expect(saved.body.data).not.toHaveProperty("locationLat");
    // Sin la ubicación no se puede seguir cobrando por distancia; con tarifa fija sí se puede quitar.
    await agent.patch(settings).send({ location: null }).expect(400);
    await agent.patch(settings).send({ deliveryPricing: "FIXED", location: null }).expect(200);
  });

  it("cobra según dónde está el cliente y guarda la distancia del pedido", async () => {
    const { slug, productId, businessId } = await setupStore({ deliveryPricing: "DISTANCE", location: SHOP, deliveryTiers: TIERS });

    // La tienda publica los rangos y el punto de partida para calcularlo antes de pedir.
    const store = (await newAgent().get(`/api/v1/store/${slug}`).expect(200)).body.data;
    expect(store.settings).toMatchObject({ deliveryPricing: "DISTANCE", deliveryTiers: TIERS, location: SHOP });

    const near = await placeOrder(slug, productId, { location: north(1.5) }).expect(201);
    expect(near.body.data.order).toMatchObject({ deliveryFee: 3000, total: 18000 });
    const far = await placeOrder(slug, productId, { location: north(3.5) }).expect(201);
    expect(far.body.data.order).toMatchObject({ deliveryFee: 5000, total: 20000 });
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: far.body.data.order.id }, select: { deliveryDistanceM: true } });
    expect(stored.deliveryDistanceM).toBeGreaterThan(3450);
    expect(stored.deliveryDistanceM).toBeLessThan(3550);

    // Recoger en el local no necesita ubicación ni cobra domicilio.
    const pickup = await placeOrder(slug, productId, { deliveryType: "PICKUP", address: undefined }).expect(201);
    expect(pickup.body.data.order).toMatchObject({ deliveryFee: 0, total: 15000 });

    expect(await prisma.order.count({ where: { businessId } })).toBe(3);
  });

  it("llega a toda la ciudad cobrando cada km adicional, hasta el máximo que elija el negocio", async () => {
    const { agent, slug, productId } = await setupStore({ deliveryPricing: "DISTANCE", location: SHOP, deliveryTiers: TIERS, deliveryExtraKmFee: 1000 });
    const store = (await newAgent().get(`/api/v1/store/${slug}`).expect(200)).body.data;
    expect(store.settings).toMatchObject({ deliveryExtraKmFee: 1000, deliveryReachKm: 50, deliveryWholeCity: true });

    // A 9 km: el último rango ($7.000 hasta 6 km) más 3 km adicionales.
    const far = await placeOrder(slug, productId, { location: north(9) }).expect(201);
    expect(far.body.data.order).toMatchObject({ deliveryFee: 10_000, total: 25_000 });
    const tooFar = await placeOrder(slug, productId, { location: north(60) }).expect(400);
    expect(tooFar.body.error.message).toBe("Tu ubicación está a 60 km y Sabores del Caribe lleva domicilios hasta 50 km. Puedes elegir recoger en el local.");

    // El negocio decide no ir más allá de 8 km.
    const settings = await agent.patch("/api/v1/businesses/current/settings").send({ deliveryMaxKm: 8 }).expect(200);
    expect(settings.body.data).toMatchObject({ deliveryExtraKmFee: 1000, deliveryMaxKm: 8 });
    expect((await newAgent().get(`/api/v1/store/${slug}`)).body.data.settings).toMatchObject({ deliveryReachKm: 8, deliveryWholeCity: false });
    const outside = await placeOrder(slug, productId, { location: north(9) }).expect(400);
    expect(outside.body.error.code).toBe("DELIVERY_OUT_OF_RANGE");
    await agent.patch("/api/v1/businesses/current/settings").send({ deliveryMaxKm: 51 }).expect(400);
  });

  it("pide la ubicación y no acepta domicilios fuera del último rango", async () => {
    const { slug, productId } = await setupStore({ deliveryPricing: "DISTANCE", location: SHOP, deliveryTiers: TIERS });

    const missing = await placeOrder(slug, productId).expect(400);
    expect(missing.body.error).toMatchObject({ code: "LOCATION_REQUIRED", message: "Comparte tu ubicación para calcular el valor del domicilio." });

    const outside = await placeOrder(slug, productId, { location: north(9) }).expect(400);
    expect(outside.body.error).toMatchObject({
      code: "DELIVERY_OUT_OF_RANGE",
      message: "Tu ubicación está a 9 km y Sabores del Caribe lleva domicilios hasta 6 km. Puedes elegir recoger en el local.",
    });
  });

  it("con tarifa fija cobra lo mismo en cualquier lugar (la distancia queda como dato)", async () => {
    const { slug, productId } = await setupStore({ deliveryFee: 4000, location: SHOP });
    const store = (await newAgent().get(`/api/v1/store/${slug}`).expect(200)).body.data;
    expect(store.settings).toMatchObject({ deliveryPricing: "FIXED", deliveryFee: 4000, deliveryTiers: [], location: null });

    const res = await placeOrder(slug, productId, { location: north(12) }).expect(201);
    expect(res.body.data.order).toMatchObject({ deliveryFee: 4000, total: 19000 });
    const withoutLocation = await placeOrder(slug, productId).expect(201);
    expect(withoutLocation.body.data.order.deliveryFee).toBe(4000);
  });
});
