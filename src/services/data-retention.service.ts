import { prisma } from "../config/database.js";
import { clock } from "../utils/clock.js";
import { logger } from "../utils/logger.js";
import { deleteImage } from "./storage.service.js";

/**
 * Conservación de datos (política de datos, sección 7): los comprobantes de pago de los pedidos se borran
 * a los 180 días; los de los planes de Pedify se conservan 5 años como soporte contable y luego se borra
 * la imagen y su texto (el registro del pago se queda). Corre una vez al día en el servidor de producción.
 */
const DAY = 86_400_000;
export const ORDER_PROOF_DAYS = 180;
export const PLAN_PROOF_DAYS = 5 * 365;
const BATCH = 100;
const RUN_EVERY_MS = DAY;

let timer: NodeJS.Timeout | null = null;

export const dataRetention = {
  async run(now = clock.now()) {
    let orderProofs = 0;
    const orderCutoff = new Date(now.getTime() - ORDER_PROOF_DAYS * DAY);
    for (;;) {
      const old = await prisma.paymentProof.findMany({
        where: { orderId: { not: null }, createdAt: { lt: orderCutoff } },
        select: { id: true, imageKey: true },
        take: BATCH,
      });
      if (old.length === 0) break;
      await prisma.paymentProof.deleteMany({ where: { id: { in: old.map((proof) => proof.id) } } });
      await Promise.all(old.map((proof) => deleteImage(proof.imageKey)));
      orderProofs += old.length;
    }

    let planProofs = 0;
    const planCutoff = new Date(now.getTime() - PLAN_PROOF_DAYS * DAY);
    for (;;) {
      const old = await prisma.planTransfer.findMany({
        where: { createdAt: { lt: planCutoff }, imageKey: { not: "" } },
        select: { id: true, imageKey: true },
        take: BATCH,
      });
      if (old.length === 0) break;
      await prisma.planTransfer.updateMany({ where: { id: { in: old.map((transfer) => transfer.id) } }, data: { imageKey: "", receiptText: null } });
      await Promise.all(old.map((transfer) => deleteImage(transfer.imageKey)));
      planProofs += old.length;
    }

    if (orderProofs || planProofs) logger.info({ orderProofs, planProofs }, "Comprobantes de pago vencidos borrados");
    return { orderProofs, planProofs };
  },

  /** Programa la limpieza: cinco minutos después de arrancar y luego una vez al día. */
  start() {
    if (timer) return;
    const tick = () => void dataRetention.run().catch((err: unknown) => logger.error({ err }, "Error al borrar los comprobantes vencidos"));
    setTimeout(tick, 5 * 60_000).unref();
    timer = setInterval(tick, RUN_EVERY_MS);
    timer.unref();
  },

  stop() {
    if (timer) clearInterval(timer);
    timer = null;
  },
};
