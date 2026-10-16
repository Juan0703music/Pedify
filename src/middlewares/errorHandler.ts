import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { Prisma } from "../generated/prisma/client.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

interface ErrorBody {
  error: { code: string; message: string; fields?: Record<string, string>; details?: unknown; requestId?: string };
}

/** Rutas de la API que no existen. */
export const apiNotFound: RequestHandler = (req, res) => {
  const body: ErrorBody = { error: { code: "NOT_FOUND", message: `No existe la ruta ${req.method} ${req.originalUrl}.` } };
  res.status(404).json(body);
};

/** Convierte los errores de Zod en un mapa campo → primer mensaje, fácil de mostrar en formularios. */
function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_";
    fields[key] ??= issue.message;
  }
  return fields;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let body: ErrorBody = {
    error: { code: "INTERNAL_ERROR", message: "Ocurrió un error inesperado. Intenta de nuevo." },
  };

  if (err instanceof AppError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } };
  } else if (err instanceof ZodError) {
    status = 400;
    body = { error: { code: "VALIDATION_ERROR", message: "Revisa los datos ingresados.", fields: zodFields(err) } };
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      status = 409;
      body = { error: { code: "DUPLICATE", message: "Ya existe un registro con esos datos." } };
    } else if (err.code === "P2025") {
      status = 404;
      body = { error: { code: "NOT_FOUND", message: "No encontramos lo que buscas." } };
    } else if (err.code === "P2034") {
      status = 409;
      body = { error: { code: "CONCURRENT_UPDATE", message: "Otra operación modificó estos datos. Intenta de nuevo." } };
    }
  } else if (typeof err === "object" && err !== null && "type" in err) {
    // Errores del lector de JSON de Express.
    if (err.type === "entity.parse.failed") {
      status = 400;
      body = { error: { code: "INVALID_JSON", message: "El cuerpo de la solicitud no es un JSON válido." } };
    } else if (err.type === "entity.too.large") {
      status = 413;
      body = { error: { code: "PAYLOAD_TOO_LARGE", message: "La solicitud es demasiado grande." } };
    }
  }

  if (status >= 500) {
    logger.error({ err, requestId: req.requestId, method: req.method, url: req.originalUrl }, "Error no controlado");
    // El código permite encontrar el error en los registros sin mostrar detalles internos.
    body.error.requestId = req.requestId;
  }

  res.status(status).json(body);
};
