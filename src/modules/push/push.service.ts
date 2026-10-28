import webpush, { WebPushError, type PushSubscription as BrowserSubscription } from "web-push";
import { env } from "../../config/env.js";
import { notifications, type OrderCreatedEvent } from "../../services/notification.service.js";
import type { TenantContext } from "../../types/common.js";
import { formatCOP } from "../../utils/currency.js";
import { conflict } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { pushRepository, type StoredPushSubscription } from "./push.repository.js";
import type { SubscribeInput } from "./push.schemas.js";

/**
 * Notificaciones push de pedidos nuevos (Web Push con llaves VAPID): llegan al celular o al
 * computador del negocio aunque el panel esté cerrado. El panel abierto sigue avisando con
 * sonido por Socket.IO; el push es para cuando nadie lo está mirando.
 */
export interface PushMessage {
  title: string;
  body: string;
  /** Página del panel que se abre al tocar el aviso. */
  url: string;
  /** Un aviso por pedido: si llega dos veces, el segundo reemplaza al primero. */
  tag: string;
}

const enabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
const subject = env.VAPID_SUBJECT ?? `mailto:${/<([^>]+)>/.exec(env.MAIL_FROM)?.[1] ?? "no-responder@pedifyai.com"}`;
if (enabled) webpush.setVapidDetails(subject, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);

type Transport = (subscription: BrowserSubscription, payload: string) => Promise<unknown>;

/** Envío real a los servicios de push; las pruebas lo reemplazan. */
const sendWithWebPush: Transport = (subscription, payload) =>
  webpush.sendNotification(subscription, payload, { TTL: 60 * 60, urgency: "high" });

let listening = false;

/** Cómo recibe el cliente el pedido, en el aviso del celular. */
const PUSH_DELIVERY_LABEL = { DELIVERY: "Domicilio", PICKUP: "Para recoger", DINE_IN: "En la mesa" } as const;

export const pushService = {
  transport: sendWithWebPush,

  get enabled() {
    return enabled;
  },

  publicKey() {
    return { enabled, publicKey: enabled ? env.VAPID_PUBLIC_KEY! : null };
  },

  async subscribe(userId: string, tenant: TenantContext, input: SubscribeInput, userAgent: string | undefined) {
    if (!enabled) throw conflict("Las notificaciones push no están configuradas en este servidor.", "PUSH_DISABLED");
    await pushRepository.upsert({
      userId,
      businessId: tenant.businessId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: userAgent?.slice(0, 300) ?? null,
    });
    return { devices: await pushRepository.countForUserInBusiness(userId, tenant.businessId) };
  },

  async unsubscribe(userId: string, endpoint: string) {
    await pushRepository.deleteByEndpoint(userId, endpoint);
  },

  removeAllForUser(userId: string) {
    return pushRepository.deleteByUser(userId);
  },

  /** Aviso de prueba a los dispositivos de esta persona en este negocio. */
  async sendTest(userId: string, tenant: TenantContext) {
    if (!enabled) throw conflict("Las notificaciones push no están configuradas en este servidor.", "PUSH_DISABLED");
    const devices = await pushRepository.forUserInBusiness(userId, tenant.businessId);
    const results = await Promise.all(
      devices.map((device) =>
        pushService.deliver(device, {
          title: "Pedify: avisos activados",
          body: "Así te llegará cada pedido nuevo, aunque tengas el panel cerrado.",
          url: "/panel/pedidos",
          tag: "pedify-prueba",
        }),
      ),
    );
    return { sent: results.filter(Boolean).length, devices: devices.length };
  },

  /** Avisa a todo el equipo del negocio que llegó un pedido. Nunca hace fallar la creación del pedido. */
  async notifyOrderCreated(event: OrderCreatedEvent) {
    if (!enabled) return;
    try {
      const devices = await pushRepository.forBusiness(event.businessId);
      const firstName = event.customerName.trim().split(/\s+/)[0] ?? event.customerName;
      const message: PushMessage = {
        title: `Nuevo pedido #${event.number}`,
        body: `${firstName} · ${PUSH_DELIVERY_LABEL[event.deliveryType]}${event.tableNumber ? ` ${event.tableNumber}` : ""} · ${formatCOP(event.total)}`,
        url: `/panel/pedidos?pedido=${event.orderId}`,
        tag: `pedido-${event.orderId}`,
      };
      await Promise.all(devices.map((device) => pushService.deliver(device, message)));
    } catch (error) {
      logger.error({ err: error, businessId: event.businessId }, "No se pudieron enviar los avisos push");
    }
  },

  /** Avisa a los propietarios del negocio (p. ej. que su plan está por vencer). Devuelve a cuántos dispositivos llegó. */
  async notifyOwners(businessId: string, message: PushMessage): Promise<number> {
    if (!enabled) return 0;
    const devices = await pushRepository.forOwners(businessId);
    return (await Promise.all(devices.map((device) => pushService.deliver(device, message)))).filter(Boolean).length;
  },

  /** Envía a un dispositivo. Si el navegador ya no lo acepta (se desinstaló o se quitó el permiso), lo borra. */
  async deliver(device: StoredPushSubscription, message: PushMessage): Promise<boolean> {
    const subscription = { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } };
    try {
      await pushService.transport(subscription, JSON.stringify(message));
      await pushRepository.markSent(device.id);
      return true;
    } catch (error) {
      const status = error instanceof WebPushError ? error.statusCode : (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await pushRepository.deleteById(device.id);
      } else {
        logger.warn({ err: error, status }, "Aviso push no entregado");
      }
      return false;
    }
  },

  /** Conecta los avisos al evento de pedido nuevo (una sola vez por proceso). */
  listen() {
    if (listening) return;
    listening = true;
    notifications.onOrderCreated((event) => void pushService.notifyOrderCreated(event));
  },
};
