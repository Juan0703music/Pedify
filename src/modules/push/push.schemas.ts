import { z } from "zod";

/**
 * Servicios de push de los navegadores. El servidor hace peticiones a la URL que registra el
 * navegador: solo se aceptan estos dominios para que nadie la use para llegar a otras direcciones.
 */
const PUSH_HOSTS = [
  "fcm.googleapis.com", // Chrome, Edge (nuevo), Brave, Samsung Internet
  "android.googleapis.com",
  "push.services.mozilla.com", // Firefox
  "web.push.apple.com", // Safari (Mac y iPhone con la app en la pantalla de inicio)
  "notify.windows.com", // Edge (anterior)
];

export function isPushServiceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

const base64url = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+=*$/, "Llave inválida.");

const endpointSchema = z
  .string({ error: "Falta la dirección de la suscripción." })
  .max(1000)
  .refine(isPushServiceUrl, "Este navegador usa un servicio de notificaciones que no reconocemos.");

/** Suscripción tal como la entrega `PushManager.subscribe()` en el navegador. */
export const subscribeSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({ p256dh: base64url(40, 200), auth: base64url(12, 64) }),
});

export const unsubscribeSchema = z.object({ endpoint: z.string().max(1000) });

export type SubscribeInput = z.infer<typeof subscribeSchema>;
export type UnsubscribeInput = z.infer<typeof unsubscribeSchema>;
