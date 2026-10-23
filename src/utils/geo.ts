/** Punto en el mapa (grados decimales). */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Distancia en línea recta entre dos puntos, en metros (fórmula del haversine). */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** 3200 → "3,2 km"; 450 → "450 m". */
export function distanceLabel(meters: number): string {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} km`;
}
