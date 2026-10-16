import type { Request, RequestHandler } from "express";
import { authService } from "../modules/auth/auth.service.js";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "../modules/auth/session-cookie.js";
import type { AuthContext } from "../types/common.js";
import { unauthorized } from "../utils/errors.js";

/**
 * Exige una sesión válida (cookie httpOnly). Deja el usuario en `req.auth`.
 * Si la sesión se renovó, reenvía la cookie con la nueva fecha de expiración.
 */
export const authenticate: RequestHandler = async (req, res, next) => {
  const token = readSessionToken(req.headers.cookie);
  if (!token) throw unauthorized();

  const resolved = await authService.resolveSession(token);
  if (!resolved) {
    clearSessionCookie(res);
    throw unauthorized("Tu sesión expiró. Inicia sesión de nuevo.", "SESSION_EXPIRED");
  }

  if (resolved.renewedExpiresAt) setSessionCookie(res, token, resolved.renewedExpiresAt);
  req.auth = resolved.auth;
  next();
};

/** Devuelve el usuario autenticado; falla si la ruta no pasó por `authenticate`. */
export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
