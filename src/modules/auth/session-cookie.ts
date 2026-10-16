import { parse } from "cookie";
import type { CookieOptions, Response } from "express";
import { env } from "../../config/env.js";

/**
 * Con HTTPS se usa el prefijo __Host-: el navegador exige Secure, Path=/ y sin Domain,
 * así la cookie no puede ser fijada por subdominios.
 */
export const SESSION_COOKIE = env.COOKIE_SECURE ? "__Host-pedify_sid" : "pedify_sid";

const baseOptions: CookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: "lax",
  path: "/",
};

/** Lee el token de sesión de una cabecera Cookie (sirve para Express y Socket.IO). */
export function readSessionToken(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  return parse(cookieHeader)[SESSION_COOKIE] || undefined;
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, { ...baseOptions, expires: expiresAt });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, baseOptions);
}
