import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import type { PlanCheckoutStatus, PlanCode } from "../../generated/prisma/enums.js";
import { paymentMethodLabel, transactionSchema, WOMPI_STATUSES, wompi, type WompiEvent, type WompiTransaction } from "../../services/wompi.service.js";
import type { TenantContext } from "../../types/common.js";
import { notifications } from "../../services/notification.service.js";
import { AppError, conflict, notFound } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { planOf, priceFor } from "./plans.js";
import { subscriptionsRepository } from "./subscriptions.repository.js";
import { subscriptionsService } from "./subscriptions.service.js";

const checkoutSelect = {
  id: true,
  businessId: true,
  plan: true,
  months: true,
  amount: true,
  status: true,
  transactionId: true,
  paymentMethod: true,
} as const;

interface Checkout {
  id: string;
  businessId: string;
  plan: PlanCode;
  months: number;
  amount: number;
  status: PlanCheckoutStatus;
  transactionId: string | null;
  paymentMethod: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const view = (checkout: Checkout) => ({
  id: checkout.id,
  status: checkout.status,
  plan: checkout.plan,
  planName: planOf(checkout.plan).name,
  months: checkout.months,
  amount: checkout.amount,
  paymentMethod: checkout.paymentMethod ? paymentMethodLabel(checkout.paymentMethod) : null,
});

/** El plan cambió: el panel abierto en el computador y en el celular lo muestra al instante. */
const announce = (businessId: string) => notifications.businessChanged({ businessId, scope: "subscription", clientId: null });

/**
 * Aplica a un pago del plan el estado de su transacción en Wompi. Es idempotente: el aviso de Wompi
 * y la consulta al volver a Pedify pueden llegar juntos o repetidos y el plan se extiende una sola vez.
 */
async function settle(checkout: Checkout, transaction: WompiTransaction) {
  if (transaction.amount_in_cents !== checkout.amount * 100 || transaction.currency !== "COP") {
    logger.error(
      { checkoutId: checkout.id, transactionId: transaction.id, amountInCents: transaction.amount_in_cents, currency: transaction.currency },
      "Pago de Wompi con un valor distinto al del plan: no se aplicó",
    );
    return;
  }
  if (!(WOMPI_STATUSES as readonly string[]).includes(transaction.status)) return; // estado nuevo de Wompi: se espera el siguiente aviso
  const status = transaction.status as PlanCheckoutStatus;
  const data = { status, transactionId: transaction.id, paymentMethod: transaction.payment_method_type ?? null };

  if (status !== "APPROVED") {
    // Un pago aprobado no se revierte con avisos posteriores (p. ej. un intento rechazado antes de pagar).
    const { count } = await prisma.planCheckout.updateMany({ where: { id: checkout.id, status: { not: "APPROVED" } }, data });
    if (count > 0) announce(checkout.businessId);
    if (count === 0 && status === "VOIDED") {
      logger.warn({ checkoutId: checkout.id, transactionId: transaction.id }, "Wompi anuló un pago del plan ya aplicado: revisa la suscripción en /admin");
    }
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const { count } = await tx.planCheckout.updateMany({ where: { id: checkout.id, status: { not: "APPROVED" } }, data });
    if (count === 0) {
      const applied = await tx.planCheckout.findUniqueOrThrow({ where: { id: checkout.id }, select: { transactionId: true } });
      return applied.transactionId === transaction.id ? "already-applied" : "duplicate";
    }
    const payment = await subscriptionsService.applyPayment(tx, checkout.businessId, {
      plan: checkout.plan,
      months: checkout.months,
      amount: checkout.amount,
      method: "WOMPI",
      reference: transaction.id,
      note: paymentMethodLabel(transaction.payment_method_type),
      recordedById: null,
    });
    await tx.planCheckout.update({ where: { id: checkout.id }, data: { paymentId: payment.id } });
    return "applied";
  });
  if (result === "applied") {
    announce(checkout.businessId);
    logger.info({ businessId: checkout.businessId, checkoutId: checkout.id, plan: checkout.plan, months: checkout.months }, "Pago del plan aprobado en Wompi");
  } else if (result === "duplicate") {
    logger.warn({ checkoutId: checkout.id, transactionId: transaction.id }, "Segundo pago aprobado para el mismo cobro del plan: revísalo y reembólsalo en Wompi");
  }
}

/**
 * Pago de los planes en línea con Wompi: el propietario elige plan y periodo, paga en el Web Checkout
 * y el plan se extiende solo cuando Wompi aprueba la transacción (con su aviso o al volver a Pedify).
 */
export const planCheckoutsService = {
  /** Crea el cobro y devuelve el enlace firmado para pagar en Wompi. */
  async start(tenant: TenantContext, userId: string, input: { plan: PlanCode; months: number }) {
    if (!wompi.enabled()) {
      throw conflict("El pago en línea todavía no está disponible. Escríbenos por WhatsApp para pagar tu plan.", "ONLINE_PAYMENT_UNAVAILABLE");
    }
    const plan = planOf(input.plan);
    // Un plan más pequeño solo sirve si el menú y el equipo caben en sus límites.
    const usage = await subscriptionsRepository.usage(tenant.businessId);
    if (plan.maxProducts !== null && usage.products > plan.maxProducts) {
      throw conflict(`Tienes ${usage.products} productos en el menú y el plan ${plan.name} permite ${plan.maxProducts}. Elimina algunos o elige un plan más grande.`, "PLAN_TOO_SMALL");
    }
    if (plan.maxMembers !== null && usage.members > plan.maxMembers) {
      const allowed = `${plan.maxMembers} ${plan.maxMembers === 1 ? "persona" : "personas"}`;
      throw conflict(`Tienes ${usage.members} personas en el equipo y el plan ${plan.name} permite ${allowed}. Quita algunas o elige un plan más grande.`, "PLAN_TOO_SMALL");
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } });
    const amount = priceFor(plan, input.months);
    const checkout = await prisma.planCheckout.create({
      data: { businessId: tenant.businessId, plan: plan.code, months: input.months, amount, createdById: userId },
      select: { id: true },
    });
    const url = wompi.checkoutUrl({
      reference: checkout.id,
      amountInCents: amount * 100,
      redirectUrl: `${env.APP_URL}/panel/plan?pago=${checkout.id}`,
      customer: user,
    });
    logger.info({ businessId: tenant.businessId, checkoutId: checkout.id, plan: plan.code, months: input.months }, "Pago del plan iniciado en Wompi");
    return { id: checkout.id, amount, url };
  },

  /**
   * Al volver de Wompi (que agrega el id de la transacción al enlace de regreso): consulta la
   * transacción con la llave privada y aplica su estado, por si el aviso de Wompi no ha llegado.
   */
  async confirm(tenant: TenantContext, id: string, transactionId?: string) {
    const checkout = await prisma.planCheckout.findFirst({ where: { id, businessId: tenant.businessId }, select: checkoutSelect });
    if (!checkout) throw notFound("No encontramos ese pago.", "CHECKOUT_NOT_FOUND");
    if (checkout.status === "APPROVED" || !transactionId || !wompi.enabled()) return view(checkout);
    try {
      const transaction = await wompi.getTransaction(transactionId);
      if (transaction?.reference === checkout.id) await settle(checkout, transaction);
      else logger.warn({ checkoutId: id, transactionId }, "La transacción de Wompi no corresponde a este pago del plan");
    } catch (err) {
      // Sin respuesta de Wompi el pago queda pendiente: su aviso lo completa.
      logger.warn({ err, checkoutId: id }, "No se pudo consultar el pago del plan en Wompi");
    }
    return view(await prisma.planCheckout.findUniqueOrThrow({ where: { id }, select: checkoutSelect }));
  },

  /** Aviso de Wompi (webhook): verifica la firma y aplica el estado de la transacción. */
  async handleEvent(event: WompiEvent) {
    if (!wompi.enabled()) throw notFound("Los pagos en línea no están activados.", "ONLINE_PAYMENT_UNAVAILABLE");
    if (!wompi.verifyEvent(event)) throw new AppError(401, "INVALID_SIGNATURE", "La firma del evento no es válida.");
    if (event.event !== "transaction.updated") return;
    const parsed = transactionSchema.safeParse(event.data.transaction);
    if (!parsed.success) {
      logger.warn({ event: event.event }, "Evento de Wompi sin una transacción válida");
      return;
    }
    const { reference } = parsed.data;
    const checkout = UUID.test(reference) ? await prisma.planCheckout.findUnique({ where: { id: reference }, select: checkoutSelect }) : null;
    if (!checkout) return; // otro cobro hecho con la misma cuenta de Wompi
    await settle(checkout, parsed.data);
  },
};
