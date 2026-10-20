import jsqrModule from "jsqr";
import QRCode from "qrcode";
import sharp from "sharp";
import { prisma } from "../../config/database.js";
import type { PaymentAccountKind, PaymentMethod } from "../../generated/prisma/enums.js";
import { deleteImage, saveImage } from "../../services/storage.service.js";
import type { TenantContext } from "../../types/common.js";
import { AppError, notFound } from "../../utils/errors.js";
import { PAYMENT_ACCOUNT_LABEL, type UpdatePaymentAccountInput } from "./payment-accounts.schemas.js";

/**
 * Cuentas para cobrar por transferencia (Nequi, Bre-B de cualquier banco, Daviplata). El negocio sube
 * el QR que le da su app; Pedify lee el código de la imagen (aunque sea un pantallazo) y lo vuelve a
 * dibujar nítido en la pantalla del domiciliario. Pedify no genera códigos de pago propios: usa
 * exactamente el que emitió el banco, así que lo leen Nequi y las apps de los bancos.
 */
const ORDER: PaymentAccountKind[] = ["NEQUI", "BRE_B", "DAVIPLATA"];

/** Cuenta sugerida según cómo dijo el cliente que pagaría. */
export const ACCOUNT_FOR_METHOD: Partial<Record<PaymentMethod, PaymentAccountKind>> = {
  NEQUI: "NEQUI",
  DAVIPLATA: "DAVIPLATA",
  BANK_TRANSFER: "BRE_B",
};

const select = { kind: true, accountKey: true, holderName: true, qrPayload: true, qrImageUrl: true, updatedAt: true } as const;
type Stored = { kind: PaymentAccountKind; accountKey: string | null; holderName: string | null; qrPayload: string | null; qrImageUrl: string | null };

/** Para mostrar: el QR vuelto a dibujar (SVG) a partir del código leído. */
async function present(account: Stored) {
  const qrSvg = account.qrPayload
    ? await QRCode.toString(account.qrPayload, { type: "svg", margin: 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
    : null;
  return {
    kind: account.kind,
    label: PAYMENT_ACCOUNT_LABEL[account.kind],
    accountKey: account.accountKey,
    holderName: account.holderName,
    qrSvg,
    qrImageUrl: account.qrImageUrl,
  };
}

// jsQR es CommonJS: según el cargador, la función llega como default o como default.default.
type ReadQr = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: string }) => { data: string } | null;
const jsQR = ((jsqrModule as unknown as { default?: ReadQr }).default ?? jsqrModule) as unknown as ReadQr;

/** Lee el código QR de una imagen (pantallazo o foto). Prueba varios tamaños. */
export async function readQr(input: Buffer): Promise<string | null> {
  for (const size of [1600, 1000, 2400]) {
    try {
      const { data, info } = await sharp(input, { limitInputPixels: 50_000_000 })
        .rotate()
        .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const found = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, {
        inversionAttempts: "attemptBoth",
      });
      if (found?.data) return found.data;
    } catch {
      return null;
    }
  }
  return null;
}

export const paymentAccountsService = {
  async list(businessId: string) {
    const accounts = await prisma.paymentAccount.findMany({ where: { businessId }, select });
    accounts.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
    return Promise.all(accounts.map(present));
  },

  /** Número o llave y titular (crea la cuenta si no existía). */
  async update(tenant: TenantContext, kind: PaymentAccountKind, input: UpdatePaymentAccountInput) {
    const data = { accountKey: input.accountKey, holderName: input.holderName };
    const account = await prisma.paymentAccount.upsert({
      where: { businessId_kind: { businessId: tenant.businessId, kind } },
      create: { businessId: tenant.businessId, kind, accountKey: input.accountKey ?? null, holderName: input.holderName ?? null },
      update: data,
      select,
    });
    return present(account);
  },

  /** Sube la imagen del QR: se lee el código y se guarda la imagen (la anterior se borra). */
  async setQr(tenant: TenantContext, kind: PaymentAccountKind, file: Buffer) {
    const payload = await readQr(file);
    if (!payload) {
      throw new AppError(
        422,
        "QR_NOT_FOUND",
        "No encontramos un código QR en esa imagen. Sube el pantallazo del QR para recibir pagos que te da la app (que se vea completo y nítido).",
      );
    }
    if (payload.length > 1000) throw new AppError(422, "QR_TOO_LONG", "Ese código QR no parece de cobro. Sube el QR para recibir pagos.");

    const current = await prisma.paymentAccount.findUnique({ where: { businessId_kind: { businessId: tenant.businessId, kind } }, select: { qrImageKey: true } });
    const saved = await saveImage(file, "qr", `businesses/${tenant.businessId}/payments`);
    let account;
    try {
      account = await prisma.paymentAccount.upsert({
        where: { businessId_kind: { businessId: tenant.businessId, kind } },
        create: { businessId: tenant.businessId, kind, qrPayload: payload, qrImageUrl: saved.url, qrImageKey: saved.key },
        update: { qrPayload: payload, qrImageUrl: saved.url, qrImageKey: saved.key },
        select,
      });
    } catch (error) {
      await deleteImage(saved.key);
      throw error;
    }
    await deleteImage(current?.qrImageKey);
    return present(account);
  },

  async remove(tenant: TenantContext, kind: PaymentAccountKind) {
    const current = await prisma.paymentAccount.findUnique({ where: { businessId_kind: { businessId: tenant.businessId, kind } }, select: { qrImageKey: true } });
    if (!current) throw notFound("Esa cuenta de cobro no existe.", "PAYMENT_ACCOUNT_NOT_FOUND");
    await prisma.paymentAccount.delete({ where: { businessId_kind: { businessId: tenant.businessId, kind } } });
    await deleteImage(current.qrImageKey);
  },
};
