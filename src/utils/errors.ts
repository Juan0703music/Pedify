/**
 * Error de aplicación con estado HTTP y código estable para el frontend.
 * Los mensajes van en español porque se muestran directamente al usuario.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, code = "BAD_REQUEST", details?: unknown) =>
  new AppError(400, code, message, details);

export const unauthorized = (message = "Debes iniciar sesión.", code = "UNAUTHORIZED") =>
  new AppError(401, code, message);

export const forbidden = (message = "No tienes permiso para realizar esta acción.", code = "FORBIDDEN") =>
  new AppError(403, code, message);

export const notFound = (message = "No encontramos lo que buscas.", code = "NOT_FOUND") =>
  new AppError(404, code, message);

export const conflict = (message: string, code = "CONFLICT") => new AppError(409, code, message);
