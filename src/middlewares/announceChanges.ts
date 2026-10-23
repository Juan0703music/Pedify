import type { RequestHandler } from "express";
import { notifications, type ChangeScope } from "../services/notification.service.js";

const READ_ONLY = new Set(["GET", "HEAD", "OPTIONS"]);
const VALID_CLIENT = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Avisa en vivo a los demás dispositivos del negocio (Socket.IO) cuando una petición del panel cambia
 * algo con éxito: el menú, la tienda o el equipo. Así el panel abierto en el computador y en el celular
 * muestra lo mismo sin recargar. La pestaña que hizo el cambio se identifica con X-Pedify-Client.
 */
export const announceChanges =
  (scope: ChangeScope): RequestHandler =>
  (req, res, next) => {
    if (READ_ONLY.has(req.method)) return next();
    res.on("finish", () => {
      // requireBusiness deja el negocio verificado en req.tenant (sin él no hubo cambio en un negocio).
      if (res.statusCode >= 400 || !req.tenant) return;
      const client = req.get("x-pedify-client");
      notifications.businessChanged({
        businessId: req.tenant.businessId,
        scope,
        clientId: client && VALID_CLIENT.test(client) ? client : null,
      });
    });
    next();
  };
