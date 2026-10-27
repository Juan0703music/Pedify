import { EventEmitter } from "node:events";
import { logger } from "../utils/logger.js";

/**
 * Notificaciones internas de la aplicación (sección 7 del documento).
 * Los módulos publican eventos aquí; en la fase 4 Socket.IO los reenvía a la sala
 * `business:<id>` del panel. PostgreSQL sigue siendo la fuente de verdad: si el panel
 * pierde la conexión, vuelve a consultar la API.
 */
export interface OrderCreatedEvent {
  businessId: string;
  orderId: string;
  number: number;
  total: number;
  customerName: string;
  deliveryType: "DELIVERY" | "PICKUP" | "DINE_IN";
  /** Mesa, cuando el cliente come en el local. */
  tableNumber: string | null;
  createdAt: Date;
}

/** Cambio en un pedido (estado o pago) hecho desde el panel. */
export interface OrderUpdatedEvent {
  businessId: string;
  orderId: string;
  number: number;
  status: string;
  paidAt: Date | null;
  changedBy: string | null;
}

/**
 * Qué cambió en el negocio fuera de los pedidos, para que los demás dispositivos abiertos (el panel en
 * el computador y en el celular) se pongan al día: el menú, los datos de la tienda o el plan.
 */
export type ChangeScope = "catalog" | "business" | "subscription";

export interface BusinessChangedEvent {
  businessId: string;
  scope: ChangeScope;
  /** Pestaña del panel que hizo el cambio (cabecera X-Pedify-Client): ella no necesita el aviso. */
  clientId: string | null;
}

const emitter = new EventEmitter();

export const notifications = {
  orderCreated(event: OrderCreatedEvent) {
    logger.info({ businessId: event.businessId, orderId: event.orderId, number: event.number }, "Nuevo pedido");
    emitter.emit("order.created", event);
  },

  orderUpdated(event: OrderUpdatedEvent) {
    emitter.emit("order.updated", event);
  },

  businessChanged(event: BusinessChangedEvent) {
    emitter.emit("business.changed", event);
  },

  /** Suscribe un oyente; devuelve la función para cancelar la suscripción. */
  onOrderCreated(listener: (event: OrderCreatedEvent) => void) {
    emitter.on("order.created", listener);
    return () => emitter.off("order.created", listener);
  },

  onOrderUpdated(listener: (event: OrderUpdatedEvent) => void) {
    emitter.on("order.updated", listener);
    return () => emitter.off("order.updated", listener);
  },

  onBusinessChanged(listener: (event: BusinessChangedEvent) => void) {
    emitter.on("business.changed", listener);
    return () => emitter.off("business.changed", listener);
  },
};
