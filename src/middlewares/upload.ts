import express, { type RequestHandler } from "express";
import { MAX_IMAGE_BYTES } from "../services/storage.service.js";
import { AppError } from "../utils/errors.js";

const rawParser = express.raw({ type: () => true, limit: MAX_IMAGE_BYTES });

/**
 * Recibe una imagen como cuerpo binario de la petición (`fetch(url, { body: file })`).
 * El formato real se verifica al decodificarla en `storage.service`, no por el Content-Type.
 */
export const imageBody: RequestHandler = (req, res, next) => {
  rawParser(req, res, (err?: unknown) => {
    if (typeof err === "object" && err !== null && "type" in err && err.type === "entity.too.large") {
      return next(new AppError(413, "IMAGE_TOO_LARGE", "La foto pesa más de 8 MB. Elige una más liviana."));
    }
    if (err) return next(err);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return next(new AppError(400, "IMAGE_REQUIRED", "Selecciona una foto para subir."));
    }
    next();
  });
};
