import { z } from "zod";

/** Clave secreta del enlace del domiciliario (viaja en la cabecera X-Courier-Key, nunca en la URL del servidor). */
export const courierKeySchema = z.string().regex(/^[A-Za-z0-9_-]{40,60}$/);

/** Posición que envía el celular del domiciliario. */
export const courierLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Precisión en metros que reporta el GPS. */
  accuracy: z.number().min(0).max(100_000).optional(),
  /** Rumbo en grados (0 = norte), si el celular lo reporta. */
  heading: z.number().min(0).max(360).nullable().optional(),
});

export type CourierLocationInput = z.infer<typeof courierLocationSchema>;
