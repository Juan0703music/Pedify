import QRCode from "qrcode";
import { prisma } from "../../config/database.js";
import { notFound } from "../../utils/errors.js";
import { PAYMENT_ACCOUNT_LABEL, type UpdatePaymentAccountInput } from "../payment-accounts/payment-accounts.schemas.js";
import { readPaymentQr } from "../payment-accounts/payment-accounts.service.js";

/**
 * Cuentas de Pedify para recibir el pago de los planes por transferencia directa: Nequi (número y QR)
 * y llave Bre-B (se paga desde cualquier banco o billetera). Las configura un administrador en /admin;
 * con al menos una, «Mi plan» ofrece pagar a esa cuenta y subir el comprobante. Los datos viven en la
 * base de datos, no en el código: el repositorio es público.
 */
export const PLATFORM_ACCOUNT_KINDS = ["NEQUI", "BRE_B"] as const;
export type PlatformAccountKind = (typeof PLATFORM_ACCOUNT_KINDS)[number];

const select = { kind: true, accountKey: true, holderName: true, qrPayload: true } as const;
type Stored = { kind: PlatformAccountKind; accountKey: string | null; holderName: string | null; qrPayload: string | null };

/** Para mostrar: el QR vuelto a dibujar (SVG) a partir del código leído. */
async function present(account: Stored) {
  const qrSvg = account.qrPayload
    ? await QRCode.toString(account.qrPayload, { type: "svg", margin: 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
    : null;
  return { kind: account.kind, label: PAYMENT_ACCOUNT_LABEL[account.kind], accountKey: account.accountKey, holderName: account.holderName, qrSvg };
}

async function stored(): Promise<Stored[]> {
  const accounts = (await prisma.platformPaymentAccount.findMany({ select })) as Stored[];
  return accounts.sort((a, b) => PLATFORM_ACCOUNT_KINDS.indexOf(a.kind) - PLATFORM_ACCOUNT_KINDS.indexOf(b.kind));
}

const isUsable = (account: Stored) => Boolean(account.accountKey || account.qrPayload);

export const platformAccountsService = {
  /** Todas las cuentas, para configurarlas en /admin. */
  async list() {
    return Promise.all((await stored()).map(present));
  },

  /** Las cuentas a las que se puede pagar (con número, llave o QR), para «Mi plan». */
  async usable() {
    return Promise.all((await stored()).filter(isUsable).map(present));
  },

  /** Número o llave y titular (crea la cuenta si no existía). */
  async update(kind: PlatformAccountKind, input: UpdatePaymentAccountInput) {
    const account = await prisma.platformPaymentAccount.upsert({
      where: { kind },
      create: { kind, accountKey: input.accountKey ?? null, holderName: input.holderName ?? null },
      update: { accountKey: input.accountKey, holderName: input.holderName },
      select,
    });
    return present(account as Stored);
  },

  /** Sube la imagen del QR de cobro: se guarda solo el código leído (se vuelve a dibujar nítido). */
  async setQr(kind: PlatformAccountKind, file: Buffer) {
    const qrPayload = await readPaymentQr(file);
    const account = await prisma.platformPaymentAccount.upsert({ where: { kind }, create: { kind, qrPayload }, update: { qrPayload }, select });
    return present(account as Stored);
  },

  async remove(kind: PlatformAccountKind) {
    const { count } = await prisma.platformPaymentAccount.deleteMany({ where: { kind } });
    if (count === 0) throw notFound("Esa cuenta de cobro no existe.", "PAYMENT_ACCOUNT_NOT_FOUND");
  },

  /** QR en PNG para guardarlo y pagar desde el mismo celular. */
  async qrPng(kind: PlatformAccountKind) {
    const account = await prisma.platformPaymentAccount.findUnique({ where: { kind }, select: { qrPayload: true } });
    if (!account?.qrPayload) throw notFound("Pedify no tiene ese QR de pago.", "PAYMENT_QR_NOT_FOUND");
    return QRCode.toBuffer(account.qrPayload, { type: "png", width: 900, margin: 4, errorCorrectionLevel: "M" });
  },

  /** Para la verificación automática: el nombre, el número o la llave de cada cuenta. */
  async forProofCheck() {
    return (await stored()).map((account) => ({ label: PAYMENT_ACCOUNT_LABEL[account.kind], accountKey: account.accountKey, holderName: account.holderName }));
  },
};
