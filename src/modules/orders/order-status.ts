import type { DeliveryType, OrderStatus } from "../../generated/prisma/enums.js";

/**
 * Estados del pedido (sección 7 del documento) y cambios permitidos.
 *
 *   PENDING → (CONFIRMED →) PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED
 *
 * - El panel acepta y manda a preparar con un toque (PENDING → PREPARING); CONFIRMED queda para
 *   quien prefiera confirmar primero y preparar después.
 * - "En preparación" se puede saltar (CONFIRMED → READY) en cocinas pequeñas.
 * - OUT_FOR_DELIVERY solo aplica a domicilios.
 * - Se puede cancelar en cualquier estado no final. DELIVERED y CANCELLED son finales.
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["PREPARING", "CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "READY", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

export const ACTIVE_STATUSES: OrderStatus[] = ["PENDING", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];
export const FINAL_STATUSES: OrderStatus[] = ["DELIVERED", "CANCELLED"];
/** Aceptados por el negocio: de confirmado en adelante, sin cancelados. */
export const ACCEPTED_STATUSES: OrderStatus[] = ["CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmado",
  PREPARING: "En preparación",
  READY: "Listo",
  OUT_FOR_DELIVERY: "En camino",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
};

export function allowedTransitions(from: OrderStatus, deliveryType: DeliveryType): OrderStatus[] {
  return TRANSITIONS[from].filter((to) => to !== "OUT_FOR_DELIVERY" || deliveryType === "DELIVERY");
}

export function canTransition(from: OrderStatus, to: OrderStatus, deliveryType: DeliveryType): boolean {
  return allowedTransitions(from, deliveryType).includes(to);
}
