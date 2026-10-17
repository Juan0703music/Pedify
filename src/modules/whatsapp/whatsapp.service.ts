import type { DeliveryType, PaymentMethod } from "../../generated/prisma/enums.js";
import { formatCOP } from "../../utils/currency.js";
import { AppError } from "../../utils/errors.js";

/**
 * Capa de WhatsApp de Pedify (secciones 9 y 10 del documento).
 *
 * Modo enlace (versión inicial): se arma un mensaje prellenado y un enlace wa.me con el número
 * del negocio. El cliente lo revisa y lo envía desde su propio WhatsApp. Abrir el enlace NO
 * confirma que el mensaje se haya enviado: por eso se distinguen la solicitud creada (PENDING),
 * el momento en que el cliente abrió WhatsApp (`whatsappOpenedAt`) y el pedido aceptado (CONFIRMED).
 *
 * Modo API oficial (futuro): implementará la misma interfaz con credenciales de Meta, verificación
 * de webhooks y tratamiento de eventos repetidos. Estas operaciones son abstracciones de Pedify,
 * no funciones oficiales de Meta.
 */

export interface OrderMessage {
  businessName: string;
  number: number;
  customerName: string;
  items: { name: string; quantity: number; subtotal: number }[];
  deliveryType: DeliveryType;
  deliveryAddress: string | null;
  addressReferences: string | null;
  paymentMethod: PaymentMethod | null;
  notes: string | null;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
}

export const DELIVERY_LABEL: Record<DeliveryType, string> = {
  DELIVERY: "Domicilio",
  PICKUP: "Recoger en el local",
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  CASH: "Efectivo",
  NEQUI: "Nequi",
  DAVIPLATA: "Daviplata",
  BANK_TRANSFER: "Transferencia bancaria",
  CARD: "Tarjeta (datáfono)",
};

/**
 * Mensaje del pedido con el formato de la sección 9 del documento. Se agregan el número de
 * pedido (el identificador que el comerciante ve en Pedify), el nombre del cliente y, cuando
 * existen, las referencias, el método de pago, las notas y el descuento.
 */
export function buildOrderMessage(order: OrderMessage): string {
  const lines: string[] = [
    "¡Hola! Quiero realizar el siguiente pedido:",
    "",
    `Negocio: ${order.businessName}`,
    `Pedido: #${order.number}`,
    `Nombre: ${order.customerName}`,
    "",
    "PRODUCTOS",
    ...order.items.map((item, index) => `${index + 1}. ${item.name} x${item.quantity} - ${formatCOP(item.subtotal)}`),
    "",
    `Entrega: ${DELIVERY_LABEL[order.deliveryType]}`,
  ];
  if (order.deliveryType === "DELIVERY" && order.deliveryAddress) lines.push(`Dirección: ${order.deliveryAddress}`);
  if (order.deliveryType === "DELIVERY" && order.addressReferences) lines.push(`Referencias: ${order.addressReferences}`);
  if (order.paymentMethod) lines.push(`Pago: ${PAYMENT_LABEL[order.paymentMethod]}`);
  if (order.notes) lines.push(`Notas: ${order.notes}`);

  lines.push("", `Subtotal: ${formatCOP(order.subtotal)}`);
  if (order.deliveryFee > 0) lines.push(`Domicilio: ${formatCOP(order.deliveryFee)}`);
  if (order.discount > 0) lines.push(`Descuento: -${formatCOP(order.discount)}`);
  lines.push(`TOTAL: ${formatCOP(order.total)}`, "", "¡Quedo atento a la confirmación!");

  return lines.join("\n");
}

/** Enlace wa.me con el número (formato internacional sin "+") y el texto codificado. */
export function waLink(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export type SendResult = { mode: "link"; url: string; message: string };

/** Operaciones de la capa de WhatsApp (sección 10). */
export interface WhatsAppChannel {
  readonly mode: "link" | "official-api";
  /** Modo enlace: prepara el mensaje y el enlace; quien envía es el cliente. */
  sendOrderMessage(to: string, order: OrderMessage): Promise<SendResult>;
  processIncomingMessage(payload: unknown): Promise<void>;
  /** Devuelve el desafío a responder si el webhook es válido; null si no. */
  verifyWebhook(query: Record<string, unknown>): string | null;
  handleDeliveryStatus(payload: unknown): Promise<void>;
}

const notAvailable = () =>
  new AppError(501, "WHATSAPP_API_NOT_CONFIGURED", "La integración con la API oficial de WhatsApp aún no está disponible.");

export const linkChannel: WhatsAppChannel = {
  mode: "link",
  async sendOrderMessage(to, order) {
    const message = buildOrderMessage(order);
    return { mode: "link", url: waLink(to, message), message };
  },
  async processIncomingMessage() {
    throw notAvailable();
  },
  verifyWebhook() {
    return null;
  },
  async handleDeliveryStatus() {
    throw notAvailable();
  },
};

/** Canal activo. Cuando exista la integración oficial, se elegirá por configuración. */
export const whatsapp: WhatsAppChannel = linkChannel;
