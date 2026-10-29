import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import type { PlanCode, PlanTransferStatus } from "../../generated/prisma/enums.js";
import { mailer } from "../../services/mail.service.js";
import { notifications } from "../../services/notification.service.js";
import { imageFingerprint, receiptReader } from "../../services/receipt-reader.service.js";
import { deleteImage, savePrivateImage, storage } from "../../services/storage.service.js";
import type { TenantContext } from "../../types/common.js";
import { clock } from "../../utils/clock.js";
import { formatCOP } from "../../utils/currency.js";
import { conflict, notFound } from "../../utils/errors.js";
import { escapeHtml } from "../../utils/html.js";
import { logger } from "../../utils/logger.js";
import { buildPage, type PaginationQuery } from "../../utils/pagination.js";
import { PAYMENT_ACCOUNT_LABEL } from "../payment-accounts/payment-accounts.schemas.js";
import { quickReading, READ_WAIT_MS, RECEIPT_TEXT_MAX } from "../payment-accounts/payment-proofs.service.js";
import { evaluateProof, parseReceipt } from "../payment-accounts/proof-check.js";
import { pushService } from "../push/push.service.js";
import { platformAccountsService, type PlatformAccountKind } from "./platform-accounts.service.js";
import { planOf, priceFor } from "./plans.js";
import { subscriptionsService } from "./subscriptions.service.js";

/** Un pago aprobado o rechazado se sigue mostrando en «Mi plan» durante una semana. */
const SHOW_REVIEWED_MS = 7 * 86_400_000;

const select = {
  id: true,
  businessId: true,
  plan: true,
  months: true,
  amount: true,
  method: true,
  status: true,
  reference: true,
  checkStatus: true,
  checks: true,
  rejectReason: true,
  reviewedAt: true,
  createdAt: true,
} as const;

interface Transfer {
  id: string;
  businessId: string;
  plan: PlanCode;
  months: number;
  amount: number;
  method: string;
  status: PlanTransferStatus;
  reference: string | null;
  checkStatus: string;
  checks: unknown;
  rejectReason: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

const period = (months: number) => (months === 12 ? "1 año" : months === 1 ? "1 mes" : `${months} meses`);
const methodLabel = (method: string) => (method === "BRE_B" ? "Llave Bre-B" : (PAYMENT_ACCOUNT_LABEL[method as PlatformAccountKind] ?? method));
const dayLabel = (date: Date) => new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", timeZone: "America/Bogota" }).format(date);

/** Lo que ve el propietario en «Mi plan». */
const ownerView = (transfer: Transfer) => ({
  id: transfer.id,
  status: transfer.status,
  plan: transfer.plan,
  planName: planOf(transfer.plan).name,
  months: transfer.months,
  amount: transfer.amount,
  method: transfer.method,
  methodLabel: methodLabel(transfer.method),
  rejectReason: transfer.rejectReason,
  reviewedAt: transfer.reviewedAt,
  createdAt: transfer.createdAt,
});

/** El plan del negocio cambió: el panel abierto en el computador y en el celular lo muestra al instante. */
const announce = (businessId: string) => notifications.businessChanged({ businessId, scope: "subscription", clientId: null });

/** Propietario del negocio (a quien se le avisa por correo si el pago se aprobó o no). */
async function ownerOf(businessId: string) {
  const membership = await prisma.businessMembership.findFirst({
    where: { businessId, role: "OWNER" },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { name: true, email: true } } },
  });
  return membership?.user ?? null;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * Avisa a los administradores de Pedify que hay un pago por revisar, con el resultado de la revisión:
 * por correo y al celular (a los que activaron los avisos en el panel central).
 */
async function notifyAdmins(transfer: Transfer, headline: string, short: string) {
  const [admins, business] = await Promise.all([
    prisma.user.findMany({ where: { isPlatformAdmin: true }, select: { email: true } }),
    prisma.business.findUnique({ where: { id: transfer.businessId }, select: { name: true } }),
  ]);
  const what = `${business?.name ?? "Un negocio"} · plan ${planOf(transfer.plan).name} ${period(transfer.months)} · ${formatCOP(transfer.amount)} por ${methodLabel(transfer.method)}`;
  const link = new URL("/admin#pagos", env.APP_URL).toString();
  await pushService
    .notifyAdmins({
      title: `Pago por revisar · ${formatCOP(transfer.amount)}`,
      body: `${business?.name ?? "Un negocio"} · plan ${planOf(transfer.plan).name} ${period(transfer.months)} por ${methodLabel(transfer.method)}. ${short}`,
      url: "/admin#pagos",
      tag: `pago-plan-${transfer.id}`,
    })
    .catch((err: unknown) => logger.error({ err }, "No se pudo enviar el aviso del pago por revisar al celular"));
  await Promise.all(
    admins.map((admin) =>
      mailer.send({
        to: admin.email,
        subject: `Pago por revisar: ${what}`,
        text: [`Nuevo pago de un plan por revisar: ${what}.`, `Revisión automática: ${headline}`, "", `Apruébalo o recházalo en ${link}`].join("\n"),
        html: `<p>Nuevo pago de un plan por revisar: <strong>${escapeHtml(what)}</strong>.</p>
<p>Revisión automática: ${escapeHtml(headline)}</p>
<p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#17161c;color:#ffffff;border-radius:10px;text-decoration:none;font-weight:600">Revisar el pago</a></p>
<p style="color:#5c5a63">Antes de aprobarlo, mira en tu app que el dinero haya llegado.</p>`,
      }),
    ),
  );
}

const HEADLINE = {
  VERIFIED: "todo coincide (valor, cuenta, fecha y no repetido).",
  REVIEW: "no pudimos leerlo todo; revísalo.",
  MISMATCH: "algo no coincide; revísalo con cuidado.",
} as const;
/** El resultado de la revisión en el aviso del celular (corto). */
const SHORT = { VERIFIED: "Todo coincide.", REVIEW: "Revísalo: no pudimos leerlo todo.", MISMATCH: "Algo no coincide: revísalo." } as const;

/**
 * Lee el comprobante (OCR), lo revisa contra el plan y las cuentas de Pedify (valor, destinatario,
 * fecha y que no se haya usado en otro pago) y avisa a los administradores. Devuelve el texto leído.
 */
async function readAndCheck(transfer: Transfer, image: Buffer, imageHash: string): Promise<string | null> {
  let text: string | null = null;
  try {
    text = (await receiptReader.read(image)).trim().slice(0, RECEIPT_TEXT_MAX);
  } catch (err) {
    logger.warn({ err, transferId: transfer.id }, "No se pudo leer el comprobante del pago del plan");
  }
  const reference = text ? (parseReceipt(text, clock.now()).references[0] ?? null) : null;
  // Otro pago de un plan (de cualquier negocio, sin contar los rechazados) con el mismo pantallazo o referencia.
  const earlier = { id: { not: transfer.id }, status: { not: "REJECTED" as const }, createdAt: { lt: transfer.createdAt } };
  const reusedSelect = { createdAt: true, business: { select: { name: true } } } as const;
  const [accounts, sameImage, sameReference] = await Promise.all([
    platformAccountsService.forProofCheck(),
    prisma.planTransfer.findFirst({ where: { ...earlier, imageHash }, select: reusedSelect }),
    reference ? prisma.planTransfer.findFirst({ where: { ...earlier, reference }, select: reusedSelect }) : null,
  ]);
  const where = (found: { createdAt: Date; business: { name: string } }) => `otro pago de ${found.business.name} (${dayLabel(found.createdAt)})`;
  const result = evaluateProof({
    text,
    total: transfer.amount,
    accounts,
    uploadedAt: transfer.createdAt,
    reusedImageIn: sameImage ? where(sameImage) : null,
    reusedReferenceIn: reference && sameReference ? { reference, orderNumber: where(sameReference) } : null,
    subject: "plan",
  });
  await prisma.planTransfer.updateMany({
    where: { id: transfer.id },
    data: { receiptText: text, reference, readAt: new Date(), checkStatus: result.status, checks: result.checks as object[] },
  });
  logger.info({ businessId: transfer.businessId, transferId: transfer.id, status: result.status }, "Comprobante del pago del plan verificado");
  await notifyAdmins(transfer, HEADLINE[result.status], SHORT[result.status]).catch((err: unknown) => logger.error({ err }, "No se pudo avisar del pago por revisar"));
  return text;
}

/**
 * Pago directo de los planes: el propietario paga a la cuenta Nequi o a la llave Bre-B de Pedify desde
 * «Mi plan» y sube el comprobante. Pedify lo lee y lo revisa (como los comprobantes de los pedidos) y
 * avisa a los administradores por correo; un administrador mira que el dinero llegó y lo aprueba (el
 * plan se extiende sin perder días) o lo rechaza con el motivo. El negocio ve el resultado al instante.
 */
export const planTransfersService = {
  /** El propietario reporta su pago con el pantallazo del comprobante. */
  async create(tenant: TenantContext, userId: string, input: { plan: PlanCode; months: number; method: PlatformAccountKind }, file: Buffer) {
    const accounts = await platformAccountsService.usable();
    if (!accounts.some((account) => account.kind === input.method)) {
      throw conflict(`El pago por ${methodLabel(input.method)} no está disponible. Elige otra forma de pago.`, "DIRECT_PAYMENT_UNAVAILABLE");
    }
    const plan = planOf(input.plan);
    await subscriptionsService.assertPlanFits(tenant.businessId, plan);

    const imageKey = await savePrivateImage(file, "proof", `businesses/${tenant.businessId}/plan-payments`);
    const imageHash = imageFingerprint(file);
    let transfer: Transfer;
    try {
      transfer = await prisma.$transaction(async (tx) => {
        // Bloquea la suscripción: dos comprobantes al mismo tiempo no quedan los dos en revisión.
        await tx.$queryRaw`SELECT 1 FROM subscriptions WHERE business_id = ${tenant.businessId}::uuid FOR UPDATE`;
        if (await tx.planTransfer.findFirst({ where: { businessId: tenant.businessId, status: "PENDING" }, select: { id: true } })) {
          throw conflict("Ya tienes un pago en revisión. Espera la confirmación o cancélalo para subir otro.", "TRANSFER_PENDING");
        }
        return tx.planTransfer.create({
          data: {
            businessId: tenant.businessId,
            plan: plan.code,
            months: input.months,
            amount: priceFor(plan, input.months),
            method: input.method,
            imageKey,
            imageHash,
            createdById: userId,
          },
          select,
        });
      });
    } catch (error) {
      await deleteImage(imageKey);
      throw error;
    }
    announce(tenant.businessId);
    logger.info({ businessId: tenant.businessId, transferId: transfer.id, plan: plan.code, months: input.months }, "Pago directo del plan reportado");

    // La lectura sigue aunque se acabe la espera: su resultado llega al panel de administración.
    const reading = readAndCheck(transfer, file, imageHash).catch((err: unknown) => {
      logger.error({ err, transferId: transfer.id }, "Error al verificar el comprobante del pago del plan");
      return null;
    });
    let timer: NodeJS.Timeout | undefined;
    const text = await Promise.race([reading, new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), READ_WAIT_MS)))]);
    clearTimeout(timer);
    return { ...ownerView(transfer), reading: text ? quickReading(text, transfer.amount) : null };
  },

  /** El propietario cancela su pago en revisión (p. ej. subió el comprobante equivocado). */
  async cancel(tenant: TenantContext, id: string) {
    const transfer = await prisma.planTransfer.findFirst({ where: { id, businessId: tenant.businessId }, select: { status: true, imageKey: true } });
    if (!transfer) throw notFound("No encontramos ese pago.", "TRANSFER_NOT_FOUND");
    const { count } = await prisma.planTransfer.deleteMany({ where: { id, status: "PENDING" } });
    if (count === 0) throw conflict("Este pago ya fue revisado y no se puede cancelar.", "TRANSFER_REVIEWED");
    await deleteImage(transfer.imageKey);
    announce(tenant.businessId);
  },

  /** Para «Mi plan»: el pago en revisión o el último revisado en la semana (o null). */
  async latestFor(businessId: string) {
    const transfer = await prisma.planTransfer.findFirst({ where: { businessId }, orderBy: { createdAt: "desc" }, select });
    if (!transfer) return null;
    if (transfer.status !== "PENDING" && (!transfer.reviewedAt || clock.now().getTime() - transfer.reviewedAt.getTime() > SHOW_REVIEWED_MS)) return null;
    return ownerView(transfer);
  },

  // ─── Panel central de Pedify ───

  /** Pagos por revisar (o los ya aprobados o rechazados), con el negocio, quién pagó y la revisión automática. */
  async list(query: PaginationQuery & { status: PlanTransferStatus }) {
    const where = { status: query.status };
    const [items, total] = await Promise.all([
      prisma.planTransfer.findMany({
        where,
        orderBy: { createdAt: query.status === "PENDING" ? "asc" : "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          ...select,
          business: { select: { id: true, name: true, slug: true, phone: true } },
          createdBy: { select: { name: true, email: true } },
          reviewedBy: { select: { name: true } },
        },
      }),
      prisma.planTransfer.count({ where }),
    ]);
    return buildPage(
      items.map((item) => ({ ...ownerView(item), reference: item.reference, checkStatus: item.checkStatus, checks: item.checks, business: item.business, paidBy: item.createdBy, reviewedBy: item.reviewedBy })),
      total,
      query,
    );
  },

  /** Imagen del comprobante, solo para los administradores. */
  async image(id: string) {
    const transfer = await prisma.planTransfer.findUnique({ where: { id }, select: { imageKey: true } });
    const data = transfer ? await storage.get(transfer.imageKey) : null;
    if (!data) throw notFound("No encontramos ese comprobante.", "TRANSFER_NOT_FOUND");
    return data;
  },

  /** El dinero llegó: se registra el pago y se extiende el plan desde la fecha más tardía (sin perder días). */
  async approve(adminId: string, id: string) {
    const transfer = await prisma.$transaction(async (tx) => {
      const found = await tx.planTransfer.findUnique({ where: { id }, select });
      if (!found) throw notFound("No encontramos ese pago.", "TRANSFER_NOT_FOUND");
      const { count } = await tx.planTransfer.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "APPROVED", reviewedById: adminId, reviewedAt: clock.now() },
      });
      if (count === 0) throw conflict("Este pago ya fue revisado.", "TRANSFER_REVIEWED");
      const payment = await subscriptionsService.applyPayment(tx, found.businessId, {
        plan: found.plan,
        months: found.months,
        amount: found.amount,
        method: found.method,
        reference: found.reference,
        note: null,
        recordedById: adminId,
      });
      return tx.planTransfer.update({ where: { id }, data: { paymentId: payment.id }, select: { ...select, payment: { select: { periodEnd: true } } } });
    });
    announce(transfer.businessId);
    logger.info({ adminId, businessId: transfer.businessId, transferId: id, plan: transfer.plan, months: transfer.months }, "Pago directo del plan aprobado");

    const owner = await ownerOf(transfer.businessId);
    if (owner && transfer.payment) {
      const until = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Bogota" }).format(transfer.payment.periodEnd);
      const what = `plan ${planOf(transfer.plan).name} · ${period(transfer.months)} (${formatCOP(transfer.amount)})`;
      void mailer
        .send({
          to: owner.email,
          subject: "Confirmamos tu pago de Pedify",
          text: [`Hola, ${firstName(owner.name)}:`, "", `Confirmamos tu pago del ${what}.`, `Tu plan está pagado hasta el ${until}. ¡Gracias!`].join("\n"),
          html: `<p>Hola, ${escapeHtml(firstName(owner.name))}:</p>
<p>Confirmamos tu pago del <strong>${escapeHtml(what)}</strong>.</p>
<p>Tu plan está pagado hasta el <strong>${until}</strong>. ¡Gracias!</p>`,
        })
        .catch((err: unknown) => logger.error({ err }, "No se pudo enviar el correo del pago aprobado"));
    }
    return ownerView(transfer);
  },

  /** El dinero no llegó (o el comprobante no sirve): el plan no cambia y el negocio ve el motivo. */
  async reject(adminId: string, id: string, reason: string) {
    const found = await prisma.planTransfer.findUnique({ where: { id }, select });
    if (!found) throw notFound("No encontramos ese pago.", "TRANSFER_NOT_FOUND");
    const { count } = await prisma.planTransfer.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "REJECTED", rejectReason: reason, reviewedById: adminId, reviewedAt: clock.now() },
    });
    if (count === 0) throw conflict("Este pago ya fue revisado.", "TRANSFER_REVIEWED");
    announce(found.businessId);
    logger.info({ adminId, businessId: found.businessId, transferId: id }, "Pago directo del plan rechazado");

    const owner = await ownerOf(found.businessId);
    if (owner) {
      const what = `plan ${planOf(found.plan).name} · ${period(found.months)} (${formatCOP(found.amount)})`;
      const link = new URL("/panel/plan", env.APP_URL).toString();
      void mailer
        .send({
          to: owner.email,
          subject: "No pudimos confirmar tu pago de Pedify",
          text: [`Hola, ${firstName(owner.name)}:`, "", `No pudimos confirmar tu pago del ${what}.`, `Motivo: ${reason}`, "", `Si ya pagaste, sube el comprobante de nuevo en ${link}`].join("\n"),
          html: `<p>Hola, ${escapeHtml(firstName(owner.name))}:</p>
<p>No pudimos confirmar tu pago del <strong>${escapeHtml(what)}</strong>.</p>
<p>Motivo: ${escapeHtml(reason)}</p>
<p>Si ya pagaste, <a href="${link}">sube el comprobante de nuevo en Mi plan</a>.</p>`,
        })
        .catch((err: unknown) => logger.error({ err }, "No se pudo enviar el correo del pago rechazado"));
    }
    return ownerView({ ...found, status: "REJECTED", rejectReason: reason, reviewedAt: clock.now() });
  },

  /** Cuántos pagos esperan revisión (para el panel central). */
  pendingCount() {
    return prisma.planTransfer.count({ where: { status: "PENDING" } });
  },
};
