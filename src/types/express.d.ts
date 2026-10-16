import type { AuthContext, TenantContext } from "./common.js";

declare global {
  namespace Express {
    interface Request {
      /** Identificador de la petición (cabecera X-Request-Id). */
      requestId?: string;
      /** Lo define el middleware `authenticate`. */
      auth?: AuthContext;
      /** Lo define el middleware `authorize` (requireBusiness). */
      tenant?: TenantContext;
    }
  }
}

export {};
