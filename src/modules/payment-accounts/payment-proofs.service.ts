import { prisma, type DbClient } from "../../config/database.js";
import type { PaymentMethod } from "../../generated/prisma/enums.js";
import { notifications } from "../../services/notification.service.js";
import { imageFingerprint, receiptReader } from "../../services/receipt-reader.service.js";
import { deleteImage, savePrivateImage, storage } from "../../services/storage.service.js";
import type { TenantContext } from "../../types/common.js";
import { clock } from "../../utils/clock.js";
import { badRequest, conflict, notFound } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { businessesRepository } from "../businesses/businesses.repository.js";
import { PAYMENT_ACCOUNT_LABEL } from "./payment-accounts.schemas.js";
import { paymentAccountsService, prepayPlan } from "./payment-accounts.service.js";
import { evaluateProof, parseReceipt } from "./proof-check.js";

/** Un comprobante sin pedido sirve por un día; después se borra. */
const UNCLAIMED_TTL_MS = 24 * 60 * 60 * 1000;
/** Al subir, se espera la lectura hasta este tiempo; si tarda más, el resultado llega después al panel. */
const READ_WAIT_MS = 6_000;
const RECEIPT_TEXT_MAX = 4_000;

const storeNotFound = () => notFound("Esta tienda no existe o ya no está disponible.", "STORE_NOT_FOUND");

/** Borra los comprobantes que nunca se usaron en un pedido (en segundo plano, de a pocos). */
async function removeUnclaimed(businessId: string) {
  const stale = await prisma.paymentProof.findMany({
    where: { businessId, orderId: null, createdAt: { lt: new Date(clock.now().getTime() - UNCLAIMED_TTL_MS) } },
    select: { id: true, imageKey: true },
    take: 25,
  });
  if (stale.length === 0) return;
  await prisma.paymentProof.deleteMany({ where: { id: { in: stale.map((proof) => proof.id) }, orderId: null } });
  await Promise.all(stale.map((proof) => deleteImage(proof.imageKey)));
}

/**
 * Lee el texto del comprobante (OCR), guarda la referencia y, si el pedido ya existe, lo verifica.
 * Devuelve el texto leído (null si no se pudo).
 */
async function readProof(proofId: string, image: Buffer): Promise<string | null> {
  let text: string | null = null;
  try {
    text = (await receiptReader.read(image)).trim().slice(0, RECEIPT_TEXT_MAX);
  } catch (err) {
    logger.warn({ err, proofId }, "No se pudo leer el comprobante de pago");
  }
  const reference = text ? (parseReceipt(text, clock.now()).references[0] ?? null) : null;
  await prisma.paymentProof.updateMany({ where: { id: proofId }, data: { receiptText: text, reference, readAt: new Date() } });
  await paymentProofsService.verify(proofId);
  return text;
}

/** Lo que el cliente ve apenas sube el comprobante: el valor leído y si coincide con su pedido. */
function quickReading(text: string, expectedTotal: number | undefined) {
  const { amounts } = parseReceipt(text, clock.now());
  if (amounts.length === 0) return { amount: null, matchesTotal: null };
  if (expectedTotal === undefined) return { amount: amounts[0]!, matchesTotal: null };
  if (amounts.includes(expectedTotal)) return { amount: expectedTotal, matchesTotal: true };
  const closest = amounts.reduce((best, value) => (Math.abs(value - expectedTotal) < Math.abs(best - expectedTotal) ? value : best));
  return { amount: closest, matchesTotal: false };
}

/**
 * Comprobantes de pago: el cliente paga con el QR o la llave del negocio y sube el pantallazo del
 * comprobante antes de enviar su pedido. Se sube primero (queda suelto) y el pedido lo toma al
 * crearse. Las imágenes son privadas: solo el equipo del negocio las ve, por la API.
 *
 * Verificación automática: Pedify lee el comprobante y revisa que sea un pago exitoso, por el valor del
 * pedido, a una cuenta del negocio, de ese momento y no usado en otro pedido (proof-check.ts). El
 * panel muestra el resultado; la confirmación definitiva es ver el dinero en la cuenta.
 */
export const paymentProofsService = {
  /**
   * El cliente sube su comprobante desde la tienda (sin sesión). Devuelve el id para el pedido y, si la
   * lectura alcanza a terminar, el valor leído comparado con el total que espera pagar.
   */
  async upload(slug: string, file: Buffer, expectedTotal?: number) {
    const business = await businessesRepository.findStoreBySlug(slug);
    if (!business || business.status !== "ACTIVE" || !business.settings) throw storeNotFound();
    const accounts = await prisma.paymentAccount.findMany({
      where: { businessId: business.id },
      select: { kind: true, accountKey: true, qrPayload: true },
    });
    if (Object.keys(prepayPlan(accounts, business.settings.paymentMethods)).length === 0) {
      throw conflict("Este negocio no recibe pagos por adelantado. Paga al recibir tu pedido.", "PREPAY_NOT_AVAILABLE");
    }

    const imageKey = await savePrivateImage(file, "proof", `businesses/${business.id}/proofs`);
    const proof = await prisma.paymentProof.create({
      data: { businessId: business.id, imageKey, imageHash: imageFingerprint(file) },
      select: { id: true, createdAt: true },
    });
    void removeUnclaimed(business.id).catch((err: unknown) => logger.warn({ err }, "No se pudieron borrar comprobantes sin usar"));

    // La lectura sigue aunque se acabe la espera: su resultado llega al panel con la verificación.
    const reading = readProof(proof.id, file).catch((err: unknown) => {
      logger.error({ err, proofId: proof.id }, "Error al verificar el comprobante de pago");
      return null;
    });
    let timer: NodeJS.Timeout | undefined;
    const text = await Promise.race([reading, new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), READ_WAIT_MS)))]);
    clearTimeout(timer);
    return { ...proof, reading: text ? quickReading(text, expectedTotal) : null };
  },

  /**
   * Verifica el comprobante de un pedido contra el pedido (valor, cuentas del negocio, hora y repetidos)
   * y avisa al panel. Se llama al terminar la lectura y al crearse el pedido: actúa cuando ya están ambos.
   */
  async verify(proofId: string) {
    const proof = await prisma.paymentProof.findUnique({
      where: { id: proofId },
      select: {
        id: true,
        businessId: true,
        imageHash: true,
        reference: true,
        receiptText: true,
        readAt: true,
        createdAt: true,
        order: { select: { id: true, number: true, total: true, status: true, paidAt: true } },
      },
    });
    if (!proof?.order || !proof.readAt) return;
    const earlier = { businessId: proof.businessId, id: { not: proof.id }, orderId: { not: null }, createdAt: { lt: proof.createdAt } };
    const [accounts, sameImage, sameReference] = await Promise.all([
      prisma.paymentAccount.findMany({ where: { businessId: proof.businessId }, select: { kind: true, accountKey: true, holderName: true } }),
      proof.imageHash ? prisma.paymentProof.findFirst({ where: { ...earlier, imageHash: proof.imageHash }, select: { order: { select: { number: true } } } }) : null,
      proof.reference ? prisma.paymentProof.findFirst({ where: { ...earlier, reference: proof.reference }, select: { order: { select: { number: true } } } }) : null,
    ]);
    const result = evaluateProof({
      text: proof.receiptText,
      total: proof.order.total,
      accounts: accounts.map((account) => ({ label: PAYMENT_ACCOUNT_LABEL[account.kind], accountKey: account.accountKey, holderName: account.holderName })),
      uploadedAt: proof.createdAt,
      reusedImageIn: sameImage?.order?.number ?? null,
      reusedReferenceIn: proof.reference && sameReference?.order ? { reference: proof.reference, orderNumber: sameReference.order.number } : null,
    });
    await prisma.paymentProof.updateMany({ where: { id: proof.id }, data: { checkStatus: result.status, checks: result.checks as object[] } });
    logger.info({ businessId: proof.businessId, orderId: proof.order.id, status: result.status }, "Comprobante de pago verificado");
    // El panel abierto (en el computador y en el celular) muestra el resultado al instante.
    notifications.orderUpdated({
      businessId: proof.businessId,
      orderId: proof.order.id,
      number: proof.order.number,
      status: proof.order.status,
      paidAt: proof.order.paidAt,
      changedBy: null,
    });
  },

  /**
   * Valida que el pedido traiga el comprobante cuando el método se paga por adelantado.
   * Devuelve el id del comprobante a unir al pedido (o null si el método se paga al recibir).
   */
  async requireFor(businessId: string, methods: PaymentMethod[], method: PaymentMethod, proofId: string | undefined) {
    const kinds = await paymentAccountsService.prepayKindsFor(businessId, methods, method);
    if (kinds.length === 0) return null;
    if (!proofId) {
      throw badRequest("Paga con el QR o la llave del negocio y sube el comprobante para enviar tu pedido.", "PAYMENT_PROOF_REQUIRED", {
        fields: { paymentProof: "Sube el pantallazo del comprobante de pago." },
      });
    }
    return proofId;
  },

  /** Une el comprobante al pedido recién creado (dentro de la misma transacción). */
  async claim(db: DbClient, businessId: string, proofId: string, orderId: string) {
    const { count } = await db.paymentProof.updateMany({
      where: { id: proofId, businessId, orderId: null, createdAt: { gte: new Date(clock.now().getTime() - UNCLAIMED_TTL_MS) } },
      data: { orderId },
    });
    if (count === 0) {
      throw badRequest("Ese comprobante ya no sirve. Vuelve a subir el pantallazo de tu pago.", "PAYMENT_PROOF_INVALID", {
        fields: { paymentProof: "Vuelve a subir el comprobante." },
      });
    }
    return db.paymentProof.findUniqueOrThrow({ where: { id: proofId }, select: { createdAt: true, checkStatus: true } });
  },

  /** Imagen del comprobante de un pedido, para el equipo del negocio. */
  async image(tenant: TenantContext, orderId: string) {
    const proof = await prisma.paymentProof.findFirst({ where: { orderId, businessId: tenant.businessId }, select: { imageKey: true } });
    const data = proof ? await storage.get(proof.imageKey) : null;
    if (!data) throw notFound("Este pedido no tiene comprobante de pago.", "PAYMENT_PROOF_NOT_FOUND");
    return data;
  },

  /** Supresión de datos de un cliente: los comprobantes de sus pedidos se borran (tienen datos personales). */
  async eraseForCustomer(businessId: string, customerId: string) {
    const proofs = await prisma.paymentProof.findMany({ where: { businessId, order: { customerId } }, select: { id: true, imageKey: true } });
    if (proofs.length === 0) return;
    await prisma.paymentProof.deleteMany({ where: { id: { in: proofs.map((proof) => proof.id) } } });
    await Promise.all(proofs.map((proof) => deleteImage(proof.imageKey)));
  },
};
