// Valor del domicilio según la distancia, igual que src/services/pricing.service.ts (el servidor tiene la
// última palabra). Lo usan el carrito de la tienda y la vista previa de Configuración → Entrega.

/** Tope de Pedify para un domicilio: cubre de punta a punta hasta las ciudades más grandes del país. */
export const MAX_DELIVERY_KM = 50;

/** 2.5 → "2,5" */
export const formatKm = (km) => String(km).replace(".", ",");

/** Hasta cuántos km llega el domicilio: el último rango, o toda la ciudad si se cobra por km adicional. */
export function deliveryReachKm({ tiers, extraKmFee, maxKm }) {
  const limit = maxKm ?? MAX_DELIVERY_KM;
  return extraKmFee === null ? Math.min(tiers.at(-1)?.upToKm ?? 0, limit) : limit;
}

/**
 * Valor para una distancia en metros (de a 100 m): el primer rango que la cubre; más lejos, el último
 * rango más el valor por cada km adicional empezado. null si queda fuera del alcance.
 */
export function feeForDistance(pricing, meters) {
  const km = Math.round(meters / 100) / 10;
  if (km > deliveryReachKm(pricing)) return null;
  const tier = pricing.tiers.find((item) => km <= item.upToKm);
  if (tier) return tier.fee;
  const last = pricing.tiers.at(-1);
  if (!last || pricing.extraKmFee === null) return null;
  return last.fee + Math.ceil(km - last.upToKm) * pricing.extraKmFee;
}
