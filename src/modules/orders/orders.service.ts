import { prisma } from "../../config/database.js";
import { Prisma } from "../../generated/prisma/client.js";
import { notifications } from "../../services/notification.service.js";
import { calculateOrder } from "../../services/pricing.service.js";
import { clock } from "../../utils/clock.js";
import { formatCOP } from "../../utils/currency.js";
import { AppError, badRequest, conflict, notFound } from "../../utils/errors.js";
import { businessesRepository } from "../businesses/businesses.repository.js";
import { describeNextOpening, getOpeningStatus, parseOpeningHours } from "../businesses/opening-hours.js";
import { customersService } from "../customers/customers.service.js";
import { subscriptionsService } from "../subscriptions/subscriptions.service.js";
import { whatsapp, type OrderMessage } from "../whatsapp/whatsapp.service.js";
import type { TenantContext } from "../../types/common.js";
import { addDays, startOfDay } from "../../utils/dates.js";
import { buildPage } from "../../utils/pagination.js";
import { allowedTransitions, canTransition, STATUS_LABEL } from "./order-status.js";
import { ordersRepository } from "./orders.repository.js";
import type { ChangeStatusInput, CreateOrderInput, ListOrdersQuery } from "./orders.schemas.js";

type StoredOrder = NonNullable<Awaited<ReturnType<typeof ordersRepository.findByIdempotencyKey>>>;

/** Producto del carrito que ya no se puede pedir: oculto/eliminado/de otro negocio o agotado. */
type UnavailableProduct = { productId: string; name: string | null; reason: "not_found" | "sold_out" };

const storeNotFound = () => notFound("Esta tienda no existe o ya no está disponible.", "STORE_NOT_FOUND");

const isUniqueError = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

async function loadStore(slug: string) {
  const business = await businessesRepository.findStoreBySlug(slug);
  if (!business || business.status !== "ACTIVE" || !business.settings) throw storeNotFound();
  return { ...business, settings: business.settings };
}

/** Mensaje y enlace de WhatsApp de un pedido guardado (sección 9). */
async function whatsappFor(order: StoredOrder, businessName: string, whatsappPhone: string) {
  const message: OrderMessage = {
    businessName,
    number: order.number,
    customerName: order.customerName,
    items: order.items.map((item) => ({ name: item.productName, quantity: item.quantity, subtotal: item.subtotal })),
    deliveryType: order.deliveryType,
    deliveryAddress: order.deliveryAddress,
    addressReferences: order.addressReferences,
    paymentMethod: order.paymentMethod,
    notes: order.notes,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    discount: order.discount,
    total: order.total,
  };
  const sent = await whatsapp.sendOrderMessage(whatsappPhone, message);
  return { url: sent.url, message: sent.message };
}

export const ordersService = {
  /**
   * Crea una solicitud de pedido desde la tienda pública (secciones 4, 8 y 9 del documento):
   * identifica el negocio, valida productos y disponibilidad, toma los precios actuales,
   * calcula subtotal y domicilio, guarda una copia del nombre y precio de cada producto en una
   * transacción y emite la notificación. Un reintento con la misma clave devuelve el mismo pedido.
   */
  async createFromStore(slug: string, input: CreateOrderInput) {
    const business = await loadStore(slug);
    const { settings } = business;

    // Reintento del navegador: se devuelve el pedido ya creado.
    const existing = await ordersRepository.findByIdempotencyKey(business.id, input.idempotencyKey);
    if (existing && settings.whatsappPhone) {
      return { created: false, order: existing, whatsapp: await whatsappFor(existing, business.name, settings.whatsappPhone) };
    }

    // ─── Reglas del negocio ───
    if (!settings.whatsappPhone) {
      throw conflict("Este negocio todavía no recibe pedidos en línea. Escríbele o llámalo directamente.", "WHATSAPP_NOT_CONFIGURED");
    }
    // Suscripción vencida (después de los días de gracia): la tienda no recibe pedidos en línea.
    if (!(await subscriptionsService.current(business.id)).state.canReceiveOrders) {
      throw conflict("Este negocio no está recibiendo pedidos en línea por ahora. Escríbele directamente.", "STORE_UNAVAILABLE");
    }
    if (!settings.acceptingOrders) {
      throw conflict("El negocio no está recibiendo pedidos en este momento. Intenta más tarde.", "ORDERS_PAUSED");
    }
    const opening = getOpeningStatus(parseOpeningHours(settings.openingHours), settings.timezone, clock.now());
    if (!opening.isOpen) {
      const next = describeNextOpening(opening.nextOpen);
      throw conflict(`El negocio está cerrado en este momento${next ? `; ${next}` : "."}`, "STORE_CLOSED");
    }
    if (input.deliveryType === "DELIVERY" && !settings.deliveryEnabled) {
      throw badRequest("Este negocio no hace domicilios. Elige recoger en el local.", "DELIVERY_UNAVAILABLE", {
        fields: { deliveryType: "Este negocio no hace domicilios." },
      });
    }
    if (input.deliveryType === "PICKUP" && !settings.pickupEnabled) {
      throw badRequest("Este negocio solo entrega a domicilio.", "PICKUP_UNAVAILABLE", {
        fields: { deliveryType: "Este negocio solo entrega a domicilio." },
      });
    }
    if (!settings.paymentMethods.includes(input.paymentMethod)) {
      throw badRequest("Ese método de pago no lo acepta el negocio.", "PAYMENT_METHOD_NOT_ACCEPTED", {
        fields: { paymentMethod: "Elige uno de los métodos de pago del negocio." },
      });
    }

    // Cantidades del mismo producto se suman.
    const quantities = new Map<string, number>();
    for (const item of input.items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    if ([...quantities.values()].some((quantity) => quantity > 99)) {
      throw badRequest("Puedes pedir hasta 99 unidades de un producto.", "QUANTITY_LIMIT");
    }

    try {
      const order = await prisma.$transaction(async (tx) => {
        // Precios y disponibilidad actuales, solo de productos de este negocio.
        const products = await tx.product.findMany({
          where: { id: { in: [...quantities.keys()] }, businessId: business.id },
          select: { id: true, name: true, price: true, isActive: true, isAvailable: true, archivedAt: true },
        });
        const byId = new Map(products.map((product) => [product.id, product]));
        const problems: UnavailableProduct[] = [];
        for (const productId of quantities.keys()) {
          const product = byId.get(productId);
          if (!product || !product.isActive || product.archivedAt) problems.push({ productId, name: product?.name ?? null, reason: "not_found" });
          else if (!product.isAvailable) problems.push({ productId, name: product.name, reason: "sold_out" });
        }
        if (problems.length > 0) {
          const names = problems.map((problem) => problem.name).filter(Boolean);
          throw new AppError(
            409,
            "PRODUCTS_UNAVAILABLE",
            names.length > 0
              ? `Ya no están disponibles: ${names.join(", ")}. Quítalos de tu pedido para continuar.`
              : "Algunos productos de tu pedido ya no están disponibles. Quítalos para continuar.",
            { products: problems },
          );
        }

        const totals = calculateOrder({
          items: [...quantities].map(([productId, quantity]) => ({ product: byId.get(productId)!, quantity })),
          deliveryType: input.deliveryType,
          deliveryFee: settings.deliveryFee,
        });

        // El pedido mínimo se compara con el subtotal (sin domicilio).
        if (totals.subtotal < settings.minimumOrder) {
          throw badRequest(
            `El pedido mínimo es ${formatCOP(settings.minimumOrder)} (sin domicilio). Te faltan ${formatCOP(settings.minimumOrder - totals.subtotal)}.`,
            "MINIMUM_ORDER",
            { minimumOrder: settings.minimumOrder, subtotal: totals.subtotal },
          );
        }

        const isDelivery = input.deliveryType === "DELIVERY";
        const customerId = await customersService.recordFromOrder(
          {
            businessId: business.id,
            name: input.name,
            phone: input.phone,
            address: isDelivery ? (input.address ?? null) : null,
            references: isDelivery ? (input.references ?? null) : null,
          },
          tx,
        );
        const number = await ordersRepository.nextNumber(business.id, tx);

        return ordersRepository.create(
          {
            businessId: business.id,
            customerId,
            number,
            deliveryType: input.deliveryType,
            customerName: input.name,
            customerPhone: input.phone,
            deliveryAddress: isDelivery ? (input.address ?? null) : null,
            addressReferences: isDelivery ? (input.references ?? null) : null,
            paymentMethod: input.paymentMethod,
            notes: input.notes ?? null,
            subtotal: totals.subtotal,
            deliveryFee: totals.deliveryFee,
            discount: totals.discount,
            total: totals.total,
            idempotencyKey: input.idempotencyKey,
            items: totals.lines.map((line) => ({
              productId: line.productId,
              productName: line.name,
              unitPrice: line.unitPrice,
              quantity: line.quantity,
              subtotal: line.subtotal,
            })),
          },
          tx,
        );
      });

      notifications.orderCreated({
        businessId: business.id,
        orderId: order.id,
        number: order.number,
        total: order.total,
        customerName: order.customerName,
        deliveryType: order.deliveryType,
        createdAt: order.createdAt,
      });

      return { created: true, order, whatsapp: await whatsappFor(order, business.name, settings.whatsappPhone) };
    } catch (error) {
      // Dos reintentos simultáneos con la misma clave: gana uno y el otro devuelve ese pedido.
      if (isUniqueError(error)) {
        const winner = await ordersRepository.findByIdempotencyKey(business.id, input.idempotencyKey);
        if (winner) return { created: false, order: winner, whatsapp: await whatsappFor(winner, business.name, settings.whatsappPhone) };
      }
      throw error;
    }
  },

  // ───────────────────────── Panel del comerciante ─────────────────────────

  /** En curso (todos) o historial paginado de entregados y cancelados. */
  async list(tenant: TenantContext, query: ListOrdersQuery) {
    if (query.view === "active") {
      const items = await ordersRepository.listActive(tenant.businessId);
      return buildPage(items, items.length, { page: 1, pageSize: Math.max(items.length, 1) });
    }
    const timeZone = (await businessesRepository.findSettings(tenant.businessId))?.timezone ?? "America/Bogota";
    const { items, total } = await ordersRepository.listHistory(tenant.businessId, {
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      search: query.search,
      from: query.from ? startOfDay(query.from, timeZone) : undefined,
      to: query.to ? startOfDay(addDays(query.to, 1), timeZone) : undefined,
    });
    return buildPage(items, total, query);
  },

  async get(tenant: TenantContext, id: string) {
    const order = await ordersRepository.findDetail(id, tenant.businessId);
    if (!order) throw notFound("No encontramos ese pedido.", "ORDER_NOT_FOUND");
    return { ...order, nextStatuses: allowedTransitions(order.status, order.deliveryType) };
  },

  /**
   * Cambia el estado (sección 7). Valida que el cambio esté permitido y, si el panel envía el estado
   * que tenía en pantalla (`from`), detecta si otra persona lo cambió primero.
   */
  async changeStatus(tenant: TenantContext, userId: string, id: string, input: ChangeStatusInput) {
    const current = await ordersRepository.findDetail(id, tenant.businessId);
    if (!current) throw notFound("No encontramos ese pedido.", "ORDER_NOT_FOUND");

    const changedMeanwhile = () =>
      conflict(`Alguien ya cambió este pedido a «${STATUS_LABEL[current.status]}». Revisa el estado actual.`, "STATUS_CHANGED");
    if (input.from && input.from !== current.status) throw changedMeanwhile();
    if (current.status === input.status) return ordersService.get(tenant, id);
    if (!canTransition(current.status, input.status, current.deliveryType)) {
      throw badRequest(
        `Un pedido «${STATUS_LABEL[current.status]}» no puede pasar a «${STATUS_LABEL[input.status]}».`,
        "INVALID_TRANSITION",
      );
    }

    const reason = input.reason ?? null;
    const changed = await prisma.$transaction((tx) =>
      ordersRepository.transition(
        {
          id,
          businessId: tenant.businessId,
          from: current.status,
          to: input.status,
          changedById: userId,
          note: input.status === "CANCELLED" ? reason : null,
          cancelReason: reason,
        },
        tx,
      ),
    );
    if (!changed) throw changedMeanwhile();

    const updated = await ordersService.get(tenant, id);
    notifications.orderUpdated({
      businessId: tenant.businessId,
      orderId: id,
      number: updated.number,
      status: updated.status,
      paidAt: updated.paidAt,
      changedBy: userId,
    });
    return updated;
  },

  /** Pago recibido: se distingue de aceptado y entregado (sección 11). */
  async setPaid(tenant: TenantContext, userId: string, id: string, paid: boolean) {
    const current = await ordersRepository.findDetail(id, tenant.businessId);
    if (!current) throw notFound("No encontramos ese pedido.", "ORDER_NOT_FOUND");
    if (paid && current.status === "CANCELLED") {
      throw badRequest("Un pedido cancelado no se puede marcar como pagado.", "ORDER_CANCELLED");
    }
    if (Boolean(current.paidAt) !== paid) {
      await ordersRepository.setPaid(id, tenant.businessId, paid ? new Date() : null);
    }
    const updated = await ordersService.get(tenant, id);
    notifications.orderUpdated({
      businessId: tenant.businessId,
      orderId: id,
      number: updated.number,
      status: updated.status,
      paidAt: updated.paidAt,
      changedBy: userId,
    });
    return updated;
  },

  /** El cliente tocó "Enviar por WhatsApp". No prueba que el mensaje se haya enviado. */
  async markWhatsappOpened(slug: string, orderId: string, idempotencyKey: string) {
    const business = await loadStore(slug);
    if (!(await ordersRepository.markWhatsappOpened(orderId, business.id, idempotencyKey))) {
      throw notFound("No encontramos ese pedido.", "ORDER_NOT_FOUND");
    }
  },
};
