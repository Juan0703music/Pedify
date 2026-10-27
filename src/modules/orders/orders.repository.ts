import { prisma, type DbClient } from "../../config/database.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { DeliveryType, OrderStatus, PaymentMethod } from "../../generated/prisma/enums.js";
import { clock } from "../../utils/clock.js";
import { ACTIVE_STATUSES, FINAL_STATUSES, UNPAID_TABLE_HOURS } from "./order-status.js";

/** Campos del pedido que se devuelven (sin la clave de idempotencia). */
export const orderSelect = {
  id: true,
  number: true,
  status: true,
  deliveryType: true,
  tableNumber: true,
  customerName: true,
  customerPhone: true,
  deliveryAddress: true,
  addressReferences: true,
  paymentMethod: true,
  notes: true,
  subtotal: true,
  deliveryFee: true,
  discount: true,
  total: true,
  whatsappOpenedAt: true,
  paidAt: true,
  deliveryLat: true,
  deliveryLng: true,
  deliveryDistanceM: true,
  createdAt: true,
  /** Comprobante del pago por adelantado (la imagen se pide aparte) y el resultado de su verificación. */
  paymentProof: { select: { createdAt: true, checkStatus: true } },
  items: {
    orderBy: { id: "asc" },
    select: { productId: true, productName: true, unitPrice: true, quantity: true, subtotal: true },
  },
} as const;

/** Detalle para el panel: pedido, cliente e historial de estados. */
export const orderDetailSelect = {
  ...orderSelect,
  cancelReason: true,
  customerId: true,
  updatedAt: true,
  statusHistory: {
    orderBy: { createdAt: "asc" },
    select: { fromStatus: true, toStatus: true, note: true, createdAt: true, changedBy: { select: { name: true } } },
  },
  courier: { select: { lat: true, lng: true, accuracy: true, updatedAt: true } },
  /** En el detalle, también lo que revisó la verificación automática del comprobante. */
  paymentProof: { select: { createdAt: true, checkStatus: true, checks: true } },
} as const;

export interface HistoryFilters {
  skip: number;
  take: number;
  search?: string;
  from?: Date;
  to?: Date;
}

function historyWhere(businessId: string, filters: HistoryFilters): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = { businessId, status: { in: FINAL_STATUSES } };
  if (filters.from || filters.to) where.createdAt = { gte: filters.from, lt: filters.to };
  const search = filters.search?.trim();
  if (search) {
    const digits = search.replace(/\D/g, "");
    where.OR = [
      { customerName: { contains: search, mode: "insensitive" } },
      ...(digits.length >= 3 ? [{ customerPhone: { contains: digits } }] : []),
      ...(/^#?\d{1,9}$/.test(search) ? [{ number: Number(search.replace("#", "")) }] : []),
    ];
  }
  return where;
}

export const ordersRepository = {
  /** Pedidos en curso, del más antiguo al más reciente (el primero en llegar se atiende primero). */
  /** En curso, más las mesas ya servidas que aún no pagan (por cobrar). */
  listActive(businessId: string) {
    const since = new Date(clock.now().getTime() - UNPAID_TABLE_HOURS * 60 * 60 * 1000);
    return prisma.order.findMany({
      where: {
        businessId,
        OR: [{ status: { in: ACTIVE_STATUSES } }, { deliveryType: "DINE_IN", status: "DELIVERED", paidAt: null, createdAt: { gte: since } }],
      },
      orderBy: { createdAt: "asc" },
      select: orderSelect,
    });
  },

  async listHistory(businessId: string, filters: HistoryFilters) {
    const where = historyWhere(businessId, filters);
    const [items, total] = await Promise.all([
      prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, skip: filters.skip, take: filters.take, select: orderSelect }),
      prisma.order.count({ where }),
    ]);
    return { items, total };
  },

  findDetail(id: string, businessId: string, db: DbClient = prisma) {
    return db.order.findUnique({ where: { id_businessId: { id, businessId } }, select: orderDetailSelect });
  },

  /**
   * Cambia el estado solo si sigue en `from` (si otra persona lo cambió, no hace nada y devuelve false)
   * y registra el cambio en el historial.
   */
  async transition(
    data: {
      id: string;
      businessId: string;
      from: OrderStatus;
      to: OrderStatus;
      changedById: string | null;
      note: string | null;
      cancelReason: string | null;
    },
    db: DbClient,
  ) {
    const final = data.to === "DELIVERED" || data.to === "CANCELLED";
    const { count } = await db.order.updateMany({
      where: { id: data.id, businessId: data.businessId, status: data.from },
      data: {
        status: data.to,
        ...(data.to === "CANCELLED" ? { cancelReason: data.cancelReason } : {}),
        // Pedido terminado: ya no se necesita el punto GPS del cliente.
        ...(final ? { deliveryLat: null, deliveryLng: null } : {}),
      },
    });
    if (count === 0) return false;
    await db.orderStatusHistory.create({
      data: { orderId: data.id, fromStatus: data.from, toStatus: data.to, changedById: data.changedById, note: data.note },
    });
    // ...y el domiciliario deja de compartir su ubicación (el enlace deja de funcionar).
    if (final) await db.courierTracking.deleteMany({ where: { orderId: data.id, businessId: data.businessId } });
    return true;
  },

  setPaid(id: string, businessId: string, paidAt: Date | null) {
    return prisma.order.update({ where: { id_businessId: { id, businessId } }, data: { paidAt }, select: { id: true } });
  },

  findByIdempotencyKey(businessId: string, idempotencyKey: string, db: DbClient = prisma) {
    return db.order.findUnique({
      where: { businessId_idempotencyKey: { businessId, idempotencyKey } },
      select: orderSelect,
    });
  },

  /** Siguiente consecutivo del negocio. El UPDATE bloquea la fila hasta terminar la transacción. */
  async nextNumber(businessId: string, db: DbClient) {
    const business = await db.business.update({
      where: { id: businessId },
      data: { lastOrderNumber: { increment: 1 } },
      select: { lastOrderNumber: true },
    });
    return business.lastOrderNumber;
  },

  /** Crea el pedido, su detalle y el primer estado del historial en una sola operación. */
  create(
    data: {
      businessId: string;
      customerId: string;
      number: number;
      deliveryType: DeliveryType;
      customerName: string;
      customerPhone: string;
      deliveryAddress: string | null;
      addressReferences: string | null;
      tableNumber: string | null;
      deliveryLat: number | null;
      deliveryLng: number | null;
      deliveryDistanceM: number | null;
      paymentMethod: PaymentMethod;
      notes: string | null;
      subtotal: number;
      deliveryFee: number;
      discount: number;
      total: number;
      idempotencyKey: string;
      items: { productId: string; productName: string; unitPrice: number; quantity: number; subtotal: number }[];
    },
    db: DbClient,
  ) {
    const { items, ...order } = data;
    return db.order.create({
      data: {
        ...order,
        status: "PENDING",
        items: { create: items },
        statusHistory: { create: { fromStatus: null, toStatus: "PENDING", note: "Pedido creado desde la tienda" } },
      },
      select: orderSelect,
    });
  },

  /** Pedido para la pantalla de seguimiento del cliente (incluye la clave para comprobarla). */
  findForTracking(id: string, businessId: string) {
    return prisma.order.findFirst({
      where: { id, businessId },
      select: {
        id: true,
        idempotencyKey: true,
        number: true,
        status: true,
        deliveryType: true,
        tableNumber: true,
        subtotal: true,
        deliveryFee: true,
        discount: true,
        total: true,
        cancelReason: true,
        deliveryLat: true,
        deliveryLng: true,
        paidAt: true,
        paymentMethod: true,
        paymentProof: { select: { createdAt: true } },
        createdAt: true,
        updatedAt: true,
        items: { orderBy: { id: "asc" }, select: { productName: true, quantity: true, subtotal: true } },
        statusHistory: { orderBy: { createdAt: "asc" }, select: { toStatus: true, createdAt: true } },
      },
    });
  },

  /** Marca que el cliente abrió WhatsApp (solo la primera vez y con la clave del pedido). */
  async markWhatsappOpened(id: string, businessId: string, idempotencyKey: string) {
    const exists = await prisma.order.count({ where: { id, businessId, idempotencyKey } });
    if (exists === 0) return false;
    await prisma.order.updateMany({ where: { id, businessId, whatsappOpenedAt: null }, data: { whatsappOpenedAt: new Date() } });
    return true;
  },
};
