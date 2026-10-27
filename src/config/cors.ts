import cors from "cors";
import type { RequestHandler } from "express";
import { forbidden } from "../utils/errors.js";
import { env } from "./env.js";

/** Orígenes autorizados: la propia aplicación (también por PUBLIC_URL) y los declarados en CORS_ORIGINS. */
export const allowedOrigins = new Set([
  new URL(env.APP_URL).origin,
  ...(env.PUBLIC_URL ? [new URL(env.PUBLIC_URL).origin] : []),
  ...env.CORS_ORIGINS,
]);

export function isAllowedOrigin(origin: string, requestHost?: string): boolean {
  if (allowedOrigins.has(origin)) return true;
  try {
    // Mismo origen que la petición (p. ej. la app abierta en 127.0.0.1 en lugar de localhost).
    return requestHost !== undefined && new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

export const corsMiddleware = cors({
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
  credentials: true,
});

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Protección CSRF para la API con cookie de sesión: rechaza peticiones que modifican datos
 * cuando vienen de otro sitio. Se complementa con la cookie SameSite=Lax y JSON obligatorio.
 */
export const originGuard: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  if (req.get("sec-fetch-site") === "cross-site") {
    return next(forbidden("Solicitud de otro sitio rechazada."));
  }
  const origin = req.get("origin");
  if (origin && !isAllowedOrigin(origin, req.host)) {
    return next(forbidden("Origen no permitido."));
  }
  next();
};
