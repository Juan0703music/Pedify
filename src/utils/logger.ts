import { pino } from "pino";
import { env, isTest } from "../config/env.js";

/**
 * Registro de eventos en JSON. Nunca se registran contraseñas, tokens ni cookies:
 * las rutas sensibles se reemplazan por "[oculto]".
 */
export const logger = pino({
  level: isTest ? "silent" : env.LOG_LEVEL,
  base: undefined,
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      'res.headers["set-cookie"]',
      "*.password",
      "*.passwordHash",
      "*.currentPassword",
      "*.newPassword",
      "*.token",
      "*.tokenHash",
    ],
    censor: "[oculto]",
  },
  ...(env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" } } }
    : {}),
});
