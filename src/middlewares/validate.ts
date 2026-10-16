import type { RequestHandler } from "express";
import type { ZodType } from "zod";

interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Valida y normaliza la entrada con Zod antes de llegar al controlador.
 * Los datos validados reemplazan a los originales (campos desconocidos descartados);
 * si fallan, el ZodError llega a `errorHandler` y se responde 400 con el detalle por campo.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
    if (schemas.query) {
      // En Express 5 `req.query` es un getter: se reemplaza con una propiedad propia.
      Object.defineProperty(req, "query", {
        value: schemas.query.parse(req.query),
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
    next();
  };
}
