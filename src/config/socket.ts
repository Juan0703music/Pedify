import type http from "node:http";
import { Server } from "socket.io";
import { authService } from "../modules/auth/auth.service.js";
import { readSessionToken } from "../modules/auth/session-cookie.js";
import { businessesRepository } from "../modules/businesses/businesses.repository.js";
import { metrics } from "../services/metrics.service.js";
import { notifications, type ChangeScope } from "../services/notification.service.js";
import { logger } from "../utils/logger.js";
import { allowedOrigins, isAllowedOrigin } from "./cors.js";

/**
 * Actualización en vivo del panel (sección 7 del documento).
 *
 * - Autentica con la misma cookie de sesión del panel y verifica la membresía en la base de datos
 *   antes de unir el socket a la sala `business:<id>` del negocio activo.
 * - Rechaza conexiones desde otros sitios (cabecera Origin), igual que la API.
 * - Cada cierto tiempo vuelve a validar la sesión y la membresía: si la persona cerró sesión,
 *   la quitaron del equipo o cambió de negocio, se desconecta.
 * - Además de los pedidos, avisa los cambios del menú, la tienda y el plan (`business:changed`) para que
 *   el panel abierto en el computador y en el celular muestre lo mismo al mismo tiempo.
 * - Socket.IO solo avisa; PostgreSQL sigue siendo la fuente de verdad: al recibir un evento o al
 *   reconectarse, el panel vuelve a consultar la API.
 */

const REVALIDATE_MS = 60_000;

interface ServerToClientEvents {
  ready: (payload: { businessId: string }) => void;
  "order:created": (payload: { orderId: string; number: number; total: number; customerName: string; deliveryType: string; createdAt: Date }) => void;
  "order:updated": (payload: {
    orderId: string;
    number: number;
    status: string;
    paidAt: Date | null;
    changedBy: string | null;
    tablePayment?: { check: string; tableNumber: string | null; total: number };
  }) => void;
  "business:changed": (payload: { scope: ChangeScope; clientId: string | null }) => void;
}

interface SocketData {
  token: string;
  userId: string;
  businessId: string;
}

export const businessRoom = (businessId: string) => `business:${businessId}`;

/** Sesión válida + membresía activa en el negocio activo de la sesión. */
async function authorize(token: string): Promise<SocketData | null> {
  const resolved = await authService.resolveSession(token);
  const businessId = resolved?.auth.activeBusinessId;
  if (!resolved || !businessId) return null;
  const membership = await businessesRepository.findMembership(resolved.auth.userId, businessId);
  if (!membership || membership.business.status !== "ACTIVE") return null;
  return { token, userId: resolved.auth.userId, businessId };
}

export function attachSocket(server: http.Server) {
  const io = new Server<Record<string, never>, ServerToClientEvents, Record<string, never>, SocketData>(server, {
    cors: { origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)), credentials: true },
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, !origin || isAllowedOrigin(origin, req.headers.host));
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = readSessionToken(socket.request.headers.cookie);
      const data = token ? await authorize(token) : null;
      if (!data) return next(new Error("UNAUTHORIZED"));
      socket.data = data;
      next();
    } catch (error) {
      logger.error({ err: error }, "Error al autenticar un socket");
      next(new Error("SERVER_ERROR"));
    }
  });

  io.on("connection", (socket) => {
    const data = socket.data;
    metrics.socketConnected();
    void socket.join(businessRoom(data.businessId));
    socket.emit("ready", { businessId: data.businessId });

    const timer = setInterval(async () => {
      try {
        const current = await authorize(data.token);
        if (!current || current.businessId !== data.businessId) socket.disconnect(true);
      } catch {
        // Error temporal de base de datos: se intenta en la siguiente revisión.
      }
    }, REVALIDATE_MS);
    timer.unref();
    socket.on("disconnect", () => {
      clearInterval(timer);
      metrics.socketDisconnected();
    });
  });

  // Eventos de la aplicación → sala del negocio.
  const offCreated = notifications.onOrderCreated((event) => {
    io.to(businessRoom(event.businessId)).emit("order:created", {
      orderId: event.orderId,
      number: event.number,
      total: event.total,
      customerName: event.customerName,
      deliveryType: event.deliveryType,
      createdAt: event.createdAt,
    });
  });
  const offUpdated = notifications.onOrderUpdated((event) => {
    io.to(businessRoom(event.businessId)).emit("order:updated", {
      orderId: event.orderId,
      number: event.number,
      status: event.status,
      paidAt: event.paidAt,
      changedBy: event.changedBy,
      tablePayment: event.tablePayment,
    });
  });

  const offChanged = notifications.onBusinessChanged((event) => {
    io.to(businessRoom(event.businessId)).emit("business:changed", { scope: event.scope, clientId: event.clientId });
  });

  return {
    io,
    async close() {
      offCreated();
      offUpdated();
      offChanged();
      await io.close();
    },
  };
}
