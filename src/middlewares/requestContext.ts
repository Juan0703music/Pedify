import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { metrics } from "../services/metrics.service.js";
import { logger } from "../utils/logger.js";

const VALID_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Identificador por petición (cabecera X-Request-Id; se respeta el que envíe un proxy si es válido),
 * registro de cada petición y métricas por ruta. Con el identificador, un error que ve el comerciante
 * se encuentra en los registros del servidor.
 */
export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.get("x-request-id");
  const requestId = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  req.requestId = requestId;
  res.set("X-Request-Id", requestId);

  const start = performance.now();
  res.on("finish", () => {
    const ms = performance.now() - start;
    const route = req.route ? `${req.baseUrl}${String(req.route.path)}` : res.statusCode === 404 ? "no_encontrada" : "archivo";
    metrics.observeRequest(req.method, route, res.statusCode, ms);
    logger.info(
      { requestId, method: req.method, url: req.originalUrl.split("?")[0], status: res.statusCode, ms: Math.round(ms) },
      "petición",
    );
  });
  next();
};
