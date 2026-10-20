import { env } from "./env.js";

/**
 * Mapas del seguimiento de domicilios (Leaflet + teselas raster). Por defecto OpenStreetMap,
 * que pide atribución y un uso moderado; con muchos pedidos conviene un proveedor propio
 * (MAP_TILE_URL y MAP_TILE_ATTRIBUTION), por ejemplo MapTiler o Stadia Maps.
 */
export const mapConfig = {
  tileUrl: env.MAP_TILE_URL,
  attribution: env.MAP_TILE_ATTRIBUTION,
};

/** Origen de las teselas, para la política de seguridad de contenido (img-src). */
export const mapTileOrigin = new URL(env.MAP_TILE_URL.replace(/\{[a-z]\}/g, "a")).origin;
