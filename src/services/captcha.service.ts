import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { env, isTest } from "../config/env.js";

/**
 * «No soy un robot» de la tienda, sin servicios de terceros. Antes de subir un comprobante de pago o de
 * hacer un pedido, el navegador resuelve un reto de cálculo (prueba de trabajo, como ALTCHA): encontrar el
 * número que, pegado al `salt`, da el SHA-256 del reto. Al celular le toma menos de un segundo; a un bot le
 * cuesta ese trabajo por cada envío, además de los límites por IP. El reto va firmado (HMAC), vence a los
 * 10 minutos y cada solución sirve una sola vez.
 */
const MAX_NUMBER = 100_000;
const TTL_MS = 10 * 60_000;
/** Soluciones usadas que se recuerdan como máximo (se olvidan al vencer). */
const MAX_REMEMBERED = 100_000;

const key = env.CAPTCHA_SECRET ?? randomBytes(32).toString("hex");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const sign = (challenge: string) => createHmac("sha256", key).update(challenge).digest("hex");

/** Retos ya resueltos y usados → cuándo vencen. */
const used = new Map<string, number>();
function forgetExpired(now: number) {
  for (const [challenge, expires] of used) if (expires <= now) used.delete(challenge);
}

export interface CaptchaChallenge {
  algorithm: "SHA-256";
  salt: string;
  challenge: string;
  maxnumber: number;
  signature: string;
}

export type CaptchaResult = "ok" | "missing" | "invalid";

export const captchaService = {
  /** En las pruebas automáticas va apagado (salvo en las del captcha) para no resolver un reto en cada pedido. */
  required: !isTest,

  challenge(now = Date.now()): CaptchaChallenge {
    const salt = `${randomBytes(12).toString("hex")}.${now + TTL_MS}`;
    const challenge = sha256(`${salt}${randomInt(0, MAX_NUMBER + 1)}`);
    return { algorithm: "SHA-256", salt, challenge, maxnumber: MAX_NUMBER, signature: sign(challenge) };
  },

  /** La solución que envía el navegador (base64url de `{ salt, number, signature }`): válida, sin vencer y sin usar. */
  verify(token: string | undefined, now = Date.now()): CaptchaResult {
    if (!token) return "missing";
    let payload: { salt?: unknown; number?: unknown; signature?: unknown };
    try {
      payload = JSON.parse(Buffer.from(token.slice(0, 400), "base64url").toString("utf8")) as typeof payload;
    } catch {
      return "invalid";
    }
    const { salt, number, signature } = payload;
    if (typeof salt !== "string" || salt.length > 80 || typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature)) return "invalid";
    if (typeof number !== "number" || !Number.isInteger(number) || number < 0 || number > MAX_NUMBER) return "invalid";
    const expires = Number(salt.split(".")[1]);
    if (!Number.isFinite(expires) || expires <= now) return "invalid";
    const challenge = sha256(`${salt}${number}`);
    if (!timingSafeEqual(Buffer.from(sign(challenge), "hex"), Buffer.from(signature, "hex"))) return "invalid";
    if (used.has(challenge)) return "invalid";
    if (used.size >= MAX_REMEMBERED) forgetExpired(now);
    used.set(challenge, expires);
    return "ok";
  },
};
