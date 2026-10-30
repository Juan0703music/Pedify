import type { NextFunction, Request, Response } from "express";
import { captchaService } from "../services/captcha.service.js";
import { badRequest } from "../utils/errors.js";

/** Exige «No soy un robot» resuelto (cabecera X-Captcha) para subir un comprobante o hacer un pedido en la tienda. */
export function requireCaptcha(req: Request, _res: Response, next: NextFunction) {
  if (!captchaService.required) return next();
  const result = captchaService.verify(req.get("x-captcha"));
  if (result === "missing") return next(badRequest("Marca «No soy un robot» antes de continuar.", "CAPTCHA_REQUIRED"));
  if (result === "invalid") return next(badRequest("La verificación «No soy un robot» venció. Márcala otra vez.", "CAPTCHA_INVALID"));
  next();
}
