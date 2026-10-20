import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { mapConfig } from "../../config/map.js";
import { notifications } from "../../services/notification.service.js";
import type { TenantContext } from "../../types/common.js";
import { conflict, notFound } from "../../utils/errors.js";
import { ordersRepository } from "../orders/orders.repository.js";
import { ACCOUNT_FOR_METHOD, paymentAccountsService } from "../payment-accounts/payment-accounts.service.js";
import type { CourierLocationInput } from "./courier.schemas.js";

/**
 * Seguimiento del domiciliario (pedidos a domicilio). El negocio genera un enlace secreto para el
 * pedido; el domiciliario lo abre en su celular, sin cuenta, y comparte su ubicación mientras el
 * pedido va en camino. El cliente ve la posición en su seguimiento. Solo se guarda la última
 * posición, el enlace vence en 12 horas y se borra todo al entregar o cancelar el pedido.
 */
const LINK_HOURS = 12;
/** Estados en los que se puede preparar el enlace (antes de salir) y compartir la ubicación (en camino). */
const LINK_STATUSES = new Set(["CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"]);

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const linkNotFound = () => notFound("Este enlace ya no funciona: el pedido se entregó, se canceló o el negocio generó otro.", "COURIER_LINK_INVALID");

export function courierUrl(token: string) {
  // La clave va después de "#": el navegador no la envía al servidor ni queda en registros.
  return new URL(`/domicilio#${token}`, env.APP_URL).toString();
}

/** Busca el seguimiento por la clave y lo valida (vigente y con el pedido aún activo). */
async function findByKey(key: string) {
  const tracking = await prisma.courierTracking.findUnique({
    where: { tokenHash: hash(key) },
    select: {
      orderId: true,
      businessId: true,
      tokenHash: true,
      expiresAt: true,
      lat: true,
      lng: true,
      updatedAt: true,
      order: {
        select: {
          id: true,
          number: true,
          status: true,
          deliveryType: true,
          customerName: true,
          customerPhone: true,
          deliveryAddress: true,
          addressReferences: true,
          deliveryLat: true,
          deliveryLng: true,
          paymentMethod: true,
          total: true,
          paidAt: true,
          notes: true,
          business: { select: { name: true, phone: true } },
          items: { orderBy: { id: "asc" }, select: { productName: true, quantity: true } },
        },
      },
    },
  });
  // Comparación en tiempo constante del hash (la búsqueda ya fue por igualdad; esto evita atajos).
  if (!tracking || !timingSafeEqual(Buffer.from(tracking.tokenHash), Buffer.from(hash(key)))) throw linkNotFound();
  if (tracking.expiresAt.getTime() <= Date.now()) throw linkNotFound();
  return tracking;
}

export const courierService = {
  /** Panel: crea (o cambia) el enlace del domiciliario de un pedido a domicilio. El anterior deja de servir. */
  async createLink(tenant: TenantContext, orderId: string) {
    const order = await ordersRepository.findDetail(orderId, tenant.businessId);
    if (!order) throw notFound("No encontramos ese pedido.", "ORDER_NOT_FOUND");
    if (order.deliveryType !== "DELIVERY") throw conflict("El seguimiento del domiciliario es solo para pedidos a domicilio.", "NOT_DELIVERY");
    if (!LINK_STATUSES.has(order.status)) {
      throw conflict("Este pedido ya terminó: no necesita enlace para el domiciliario.", "ORDER_FINISHED");
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + LINK_HOURS * 3_600_000);
    await prisma.courierTracking.upsert({
      where: { orderId },
      create: { orderId, businessId: tenant.businessId, tokenHash: hash(token), expiresAt },
      update: { tokenHash: hash(token), expiresAt },
    });
    const url = courierUrl(token);
    const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#17161c", light: "#ffffff" } });
    return { url, expiresAt, qrSvg };
  },

  /** Página del domiciliario: lo que necesita para llevar el pedido (como la comanda impresa). */
  async view(key: string) {
    const tracking = await findByKey(key);
    const { order } = tracking;
    return {
      number: order.number,
      status: order.status,
      business: order.business,
      customer: {
        name: order.customerName,
        phone: order.customerPhone,
        address: order.deliveryAddress,
        references: order.addressReferences,
        notes: order.notes,
      },
      destination: order.deliveryLat !== null && order.deliveryLng !== null ? { lat: order.deliveryLat, lng: order.deliveryLng } : null,
      items: order.items.map((item) => ({ name: item.productName, quantity: item.quantity })),
      total: order.total,
      paymentMethod: order.paymentMethod,
      paid: Boolean(order.paidAt),
      position: tracking.lat !== null && tracking.lng !== null ? { lat: tracking.lat, lng: tracking.lng, updatedAt: tracking.updatedAt } : null,
      // QR y llaves para que el cliente pague por transferencia al recibir (la sugerida, según su método).
      paymentAccounts: await paymentAccountsService.list(tracking.businessId),
      suggestedAccount: order.paymentMethod ? (ACCOUNT_FOR_METHOD[order.paymentMethod] ?? null) : null,
      expiresAt: tracking.expiresAt,
      map: mapConfig,
    };
  },

  /** El celular del domiciliario envía su posición (solo mientras el pedido va en camino). */
  async updateLocation(key: string, input: CourierLocationInput) {
    const tracking = await findByKey(key);
    if (tracking.order.status !== "OUT_FOR_DELIVERY") {
      throw conflict("El pedido todavía no va en camino. Espera a que el negocio lo despache.", "NOT_ON_THE_WAY");
    }
    await prisma.courierTracking.update({
      where: { orderId: tracking.orderId },
      data: {
        lat: input.lat,
        lng: input.lng,
        accuracy: input.accuracy !== undefined ? Math.round(input.accuracy) : null,
        heading: input.heading ?? null,
        updatedAt: new Date(),
      },
    });
  },

  /** El domiciliario confirma la entrega: el pedido pasa a «Entregado» y el seguimiento se cierra. */
  async markDelivered(key: string) {
    const tracking = await findByKey(key);
    const { order } = tracking;
    if (order.status !== "OUT_FOR_DELIVERY") {
      throw conflict("Solo se puede marcar como entregado un pedido que va en camino.", "NOT_ON_THE_WAY");
    }
    const changed = await prisma.$transaction((tx) =>
      ordersRepository.transition(
        {
          id: order.id,
          businessId: tracking.businessId,
          from: "OUT_FOR_DELIVERY",
          to: "DELIVERED",
          changedById: null,
          note: "Entregado por el domiciliario",
          cancelReason: null,
        },
        tx,
      ),
    );
    if (!changed) throw conflict("El pedido cambió mientras tanto. Recarga la página.", "STATUS_CHANGED");
    notifications.orderUpdated({
      businessId: tracking.businessId,
      orderId: order.id,
      number: order.number,
      status: "DELIVERED",
      paidAt: order.paidAt,
      changedBy: null,
    });
  },

  /** Posición para el seguimiento del cliente: solo mientras va en camino. */
  async positionFor(orderId: string, status: string) {
    if (status !== "OUT_FOR_DELIVERY") return null;
    const tracking = await prisma.courierTracking.findUnique({
      where: { orderId },
      select: { lat: true, lng: true, accuracy: true, heading: true, updatedAt: true, expiresAt: true },
    });
    if (!tracking || tracking.lat === null || tracking.lng === null || tracking.expiresAt.getTime() <= Date.now()) return null;
    return { lat: tracking.lat, lng: tracking.lng, accuracy: tracking.accuracy, heading: tracking.heading, updatedAt: tracking.updatedAt };
  },
};
