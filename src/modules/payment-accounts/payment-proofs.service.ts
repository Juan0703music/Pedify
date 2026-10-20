import { prisma, type DbClient } from "../../config/database.js";
import type { PaymentMethod } from "../../generated/prisma/enums.js";
import { deleteImage, savePrivateImage, storage } from "../../services/storage.service.js";
import type { TenantContext } from "../../types/common.js";
import { clock } from "../../utils/clock.js";
import { badRequest, conflict, notFound } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { businessesRepository } from "../businesses/businesses.repository.js";
import { paymentAccountsService, prepayPlan } from "./payment-accounts.service.js";

/** Un comprobante sin pedido sirve por un día; después se borra. */
const UNCLAIMED_TTL_MS = 24 * 60 * 60 * 1000;

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
 * Comprobantes de pago: el cliente paga con el QR o la llave del negocio y sube el pantallazo del
 * comprobante antes de enviar su pedido. Se sube primero (queda suelto) y el pedido lo toma al
 * crearse. Las imágenes son privadas: solo el equipo del negocio las ve, por la API.
 */
export const paymentProofsService = {
  /** El cliente sube su comprobante desde la tienda (sin sesión). Devuelve el id para el pedido. */
  async upload(slug: string, file: Buffer) {
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
    const proof = await prisma.paymentProof.create({ data: { businessId: business.id, imageKey }, select: { id: true, createdAt: true } });
    void removeUnclaimed(business.id).catch((err: unknown) => logger.warn({ err }, "No se pudieron borrar comprobantes sin usar"));
    return proof;
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
    return db.paymentProof.findUniqueOrThrow({ where: { id: proofId }, select: { createdAt: true } });
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
