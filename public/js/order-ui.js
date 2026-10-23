// Piezas compartidas para mostrar pedidos en el panel (Inicio y Pedidos).
import { formatCOP } from "./api.js";
import { distanceLabel } from "./map.js";
import { html, icon } from "./ui.js";

export const STATUS = {
  PENDING: { label: "Pendiente", badge: "bg-mustard text-ink" },
  CONFIRMED: { label: "Confirmado", badge: "bg-sky-soft text-sky" },
  PREPARING: { label: "En preparación", badge: "bg-sky-soft text-sky" },
  READY: { label: "Listo", badge: "bg-leaf-soft text-leaf" },
  OUT_FOR_DELIVERY: { label: "En camino", badge: "bg-leaf-soft text-leaf" },
  DELIVERED: { label: "Entregado", badge: "bg-ground text-muted" },
  CANCELLED: { label: "Cancelado", badge: "bg-tomato-soft text-tomato" },
};

export const PAYMENT_LABEL = {
  CASH: "Efectivo",
  NEQUI: "Nequi",
  DAVIPLATA: "Daviplata",
  BANK_TRANSFER: "Transferencia",
  CARD: "Tarjeta",
};

/** Acción principal según el estado: lo que el negocio hace a continuación (sección 6: fácil de encontrar). */
export function nextAction(order) {
  switch (order.status) {
    case "PENDING":
      // Aceptar y mandar a cocina en un solo toque.
      return { status: "PREPARING", label: "Aceptar y preparar", icon: "chef-hat" };
    case "CONFIRMED":
      return { status: "PREPARING", label: "Empezar a preparar", icon: "chef-hat" };
    case "PREPARING":
      return { status: "READY", label: "Pedido listo", icon: "circle-check" };
    case "READY":
      return order.deliveryType === "DELIVERY"
        ? { status: "OUT_FOR_DELIVERY", label: "Enviar con domiciliario", icon: "bike" }
        : { status: "DELIVERED", label: "Entregado al cliente", icon: "shopping-bag" };
    case "OUT_FOR_DELIVERY":
      return { status: "DELIVERED", label: "Marcar entregado", icon: "circle-check" };
    default:
      return null;
  }
}

export function statusBadge(status) {
  const info = STATUS[status] ?? { label: status, badge: "bg-ground text-muted" };
  return html`<span class="badge ${info.badge}">${info.label}</span>`;
}

/** "7:05 p. m." en hora de Colombia. */
export function timeLabel(value) {
  return new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" }).format(new Date(value));
}

/** "16 oct · 7:05 p. m." */
export function dateTimeLabel(value) {
  const date = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "America/Bogota" }).format(new Date(value));
  return `${date.replace(".", "")} · ${timeLabel(value)}`;
}

/** Minutos desde que llegó el pedido. */
export function minutesSince(value) {
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
}

/** "ahora", "hace 4 min", "hace 1 h 5 min" */
export function elapsedLabel(value) {
  const minutes = minutesSince(value);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 24) return `hace ${Math.floor(hours / 24)} d`;
  return rest ? `hace ${hours} h ${rest} min` : `hace ${hours} h`;
}

/** «Domicilio · 3,2 km» (distancia en línea recta, si el cliente marcó su ubicación) o «Recoger». */
export function deliveryLabel(order) {
  return order.deliveryType === "DELIVERY"
    ? html`${icon("bike", "h-4 w-4")} Domicilio${order.deliveryDistanceM ? ` · ${distanceLabel(order.deliveryDistanceM)}` : ""}`
    : html`${icon("shopping-bag", "h-4 w-4")} Recoger`;
}

/** "573112223344" → wa.me para escribirle al cliente. */
export function customerWhatsapp(phone, text = "") {
  return `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export function itemsSummary(order, max = 4) {
  const shown = order.items.slice(0, max);
  const hidden = order.items.length - shown.length;
  return html`<ul class="grid gap-0.5 text-[0.9375rem]">
    ${shown.map((item) => html`<li class="flex gap-2"><span class="num w-7 flex-none font-[750]">${item.quantity}×</span><span class="min-w-0">${item.productName}</span></li>`)}
    ${hidden > 0 ? html`<li class="pl-9 text-sm text-muted">y ${hidden} ${hidden === 1 ? "producto más" : "productos más"}</li>` : ""}
  </ul>`;
}

export function moneyLabel(value) {
  return formatCOP(value);
}
