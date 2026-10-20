import { rateLimit, type Options } from "express-rate-limit";
import { isTest } from "../config/env.js";

const handler: Options["handler"] = (_req, res, _next, options) => {
  res.status(options.statusCode).json({
    error: { code: "TOO_MANY_REQUESTS", message: "Demasiados intentos. Espera unos minutos e intenta de nuevo." },
  });
};

const common = {
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler,
  skip: () => isTest,
} satisfies Partial<Options>;

/** Límite general de la API por IP. */
export const apiLimiter = rateLimit({ ...common, windowMs: 60_000, limit: 300 });

/** Inicio de sesión: solo cuentan los intentos fallidos (fuerza bruta de contraseñas). */
export const loginLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
});

/** Registro de cuentas y negocios. */
export const registerLimiter = rateLimit({ ...common, windowMs: 60 * 60_000, limit: 10 });

/** Subida de imágenes (procesarlas consume CPU). */
export const uploadLimiter = rateLimit({ ...common, windowMs: 15 * 60_000, limit: 60 });

/** Comprobantes de pago desde la tienda pública (imágenes sin sesión: pocas por IP). */
export const proofLimiter = rateLimit({ ...common, windowMs: 15 * 60_000, limit: 20 });

/** Errores de JavaScript que reportan los navegadores (solo van al log). */
export const clientErrorLimiter = rateLimit({ ...common, windowMs: 10 * 60_000, limit: 30 });

/** Pedidos desde la tienda pública (evita llenar el panel de solicitudes falsas). */
export const orderLimiter = rateLimit({ ...common, windowMs: 10 * 60_000, limit: 15 });

/** Página del domiciliario: envía su posición cada pocos segundos mientras va en camino. */
export const courierLimiter = rateLimit({ ...common, windowMs: 10 * 60_000, limit: 400 });

/** Seguimiento de un pedido desde la tienda: la pantalla consulta el estado cada pocos segundos. */
export const trackingLimiter = rateLimit({ ...common, windowMs: 10 * 60_000, limit: 300 });

/** Recuperación de contraseña: pocas solicitudes por IP (evita usarla para enviar correos masivos). */
export const passwordResetLimiter = rateLimit({ ...common, windowMs: 15 * 60_000, limit: 5 });
