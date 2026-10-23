import type { DeliveryType } from "../generated/prisma/enums.js";
import { multiplyCOP } from "../utils/currency.js";

/**
 * Cálculo del pedido (secciones 4 y 8 del documento): siempre con los precios actuales
 * de la base de datos, nunca con valores enviados por el navegador.
 *
 * - Subtotal = suma de precio unitario × cantidad.
 * - Domicilio: solo cuando la entrega es a domicilio; tarifa fija o según la distancia (feeForDistance).
 * - Descuento: 0 en esta versión; la estructura queda lista para promociones.
 * - Total = subtotal + domicilio − descuento (la base de datos lo verifica con un CHECK).
 *
 * Todo en pesos enteros (COP), sin redondeos intermedios.
 */
export interface PricedProduct {
  id: string;
  name: string;
  price: number;
}

export interface PricedLine {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
}

export interface OrderTotals {
  lines: PricedLine[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
}

export function calculateOrder(input: {
  items: { product: PricedProduct; quantity: number }[];
  deliveryType: DeliveryType;
  deliveryFee: number;
  discount?: number;
}): OrderTotals {
  const lines = input.items.map(({ product, quantity }) => ({
    productId: product.id,
    name: product.name,
    unitPrice: product.price,
    quantity,
    subtotal: multiplyCOP(product.price, quantity),
  }));
  const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const deliveryFee = input.deliveryType === "DELIVERY" ? input.deliveryFee : 0;
  // El descuento nunca deja el total por debajo de cero.
  const discount = Math.min(Math.max(0, input.discount ?? 0), subtotal + deliveryFee);
  const total = subtotal + deliveryFee - discount;
  if (!Number.isSafeInteger(total)) throw new RangeError("El valor del pedido excede el límite permitido.");
  return { lines, subtotal, deliveryFee, discount, total };
}

/** Rango de la tarifa por distancia: hasta `upToKm` kilómetros (en línea recta) se cobra `fee`. */
export interface DeliveryTier {
  upToKm: number;
  fee: number;
}

/** Rangos guardados en la configuración (JSON), ordenados de menor a mayor distancia. */
export function parseDeliveryTiers(value: unknown): DeliveryTier[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((tier): tier is DeliveryTier => typeof tier?.upToKm === "number" && Number.isInteger(tier?.fee))
    .sort((a, b) => a.upToKm - b.upToKm);
}

/** Tope de Pedify para un domicilio: cubre de punta a punta hasta las ciudades más grandes del país. */
export const MAX_DELIVERY_KM = 50;

/**
 * Cobro por distancia: los rangos y, más allá del último, un valor por cada km adicional (o nada si
 * `extraKmFee` es null). `maxKm` limita el alcance; null = toda la ciudad (hasta MAX_DELIVERY_KM).
 */
export interface DistancePricing {
  tiers: DeliveryTier[];
  extraKmFee: number | null;
  maxKm: number | null;
}

/** Hasta cuántos km llega el domicilio con esta configuración. */
export function deliveryReachKm({ tiers, extraKmFee, maxKm }: DistancePricing): number {
  const limit = maxKm ?? MAX_DELIVERY_KM;
  return extraKmFee === null ? Math.min(tiers.at(-1)?.upToKm ?? 0, limit) : limit;
}

/**
 * Valor del domicilio para una distancia: el del primer rango que la cubre; más lejos, el último rango
 * más el valor por cada km adicional (contando el km empezado). null si queda fuera del alcance.
 * La distancia se toma de a 100 m (el GPS no es más preciso): 2,04 km cuenta como 2 km.
 */
export function feeForDistance(pricing: DistancePricing, meters: number): number | null {
  const km = Math.round(meters / 100) / 10;
  if (km > deliveryReachKm(pricing)) return null;
  const tier = pricing.tiers.find((item) => km <= item.upToKm);
  if (tier) return tier.fee;
  const last = pricing.tiers.at(-1);
  if (!last || pricing.extraKmFee === null) return null;
  return last.fee + Math.ceil(km - last.upToKm) * pricing.extraKmFee;
}
