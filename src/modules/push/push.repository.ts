import { prisma } from "../../config/database.js";

export interface StoredPushSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const select = { id: true, endpoint: true, p256dh: true, auth: true } as const;

export const pushRepository = {
  /** Registra o actualiza el dispositivo (la URL del servicio de push es única por navegador). */
  upsert(data: { userId: string; businessId: string; endpoint: string; p256dh: string; auth: string; userAgent: string | null }) {
    const { endpoint, ...rest } = data;
    return prisma.pushSubscription.upsert({ where: { endpoint }, create: data, update: rest, select });
  },

  deleteByEndpoint(userId: string, endpoint: string) {
    return prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  },

  deleteById(id: string) {
    return prisma.pushSubscription.deleteMany({ where: { id } });
  },

  /** Al cerrar sesión en todos los dispositivos o cambiar la contraseña: ningún dispositivo sigue recibiendo avisos. */
  deleteByUser(userId: string) {
    return prisma.pushSubscription.deleteMany({ where: { userId } });
  },

  /** Dispositivos de las personas que siguen siendo del equipo del negocio. */
  forBusiness(businessId: string): Promise<StoredPushSubscription[]> {
    return prisma.pushSubscription.findMany({
      where: { businessId, user: { memberships: { some: { businessId } } } },
      select,
    });
  },

  /** Dispositivos de los propietarios del negocio (avisos del plan). */
  forOwners(businessId: string): Promise<StoredPushSubscription[]> {
    return prisma.pushSubscription.findMany({
      where: { businessId, user: { memberships: { some: { businessId, role: "OWNER" } } } },
      select,
    });
  },

  forUserInBusiness(userId: string, businessId: string): Promise<StoredPushSubscription[]> {
    return prisma.pushSubscription.findMany({ where: { userId, businessId }, select });
  },

  countForUserInBusiness(userId: string, businessId: string) {
    return prisma.pushSubscription.count({ where: { userId, businessId } });
  },

  markSent(id: string) {
    return prisma.pushSubscription.updateMany({ where: { id }, data: { lastSentAt: new Date() } });
  },
};

/** Dispositivos de los administradores de Pedify (avisos de los pagos de los planes por revisar). */
export const adminPushRepository = {
  upsert(data: { userId: string; endpoint: string; p256dh: string; auth: string; userAgent: string | null }) {
    const { endpoint, ...rest } = data;
    return prisma.adminPushSubscription.upsert({ where: { endpoint }, create: data, update: rest, select });
  },

  deleteByEndpoint(userId: string, endpoint: string) {
    return prisma.adminPushSubscription.deleteMany({ where: { userId, endpoint } });
  },

  deleteById(id: string) {
    return prisma.adminPushSubscription.deleteMany({ where: { id } });
  },

  deleteByUser(userId: string) {
    return prisma.adminPushSubscription.deleteMany({ where: { userId } });
  },

  /** Solo de quienes siguen siendo administradores (si se le quita el acceso, deja de recibirlos). */
  forAdmins(): Promise<StoredPushSubscription[]> {
    return prisma.adminPushSubscription.findMany({ where: { user: { isPlatformAdmin: true } }, select });
  },

  forUser(userId: string): Promise<StoredPushSubscription[]> {
    return prisma.adminPushSubscription.findMany({ where: { userId }, select });
  },

  countForUser(userId: string) {
    return prisma.adminPushSubscription.count({ where: { userId } });
  },

  markSent(id: string) {
    return prisma.adminPushSubscription.updateMany({ where: { id }, data: { lastSentAt: new Date() } });
  },
};
