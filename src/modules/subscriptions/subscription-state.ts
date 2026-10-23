import { GRACE_DAYS } from "./plans.js";

export type SubscriptionStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "EXPIRED";

export interface SubscriptionState {
  status: SubscriptionStatus;
  /** Fin del periodo vigente (prueba o pago). */
  endsAt: Date;
  /** Días que faltan para `endsAt` (0 si ya pasó). */
  daysLeft: number;
  /** Si está vencida: hasta cuándo sigue recibiendo pedidos. */
  graceEndsAt: Date | null;
  /** La tienda puede recibir pedidos en línea. */
  canReceiveOrders: boolean;
}

const DAY = 86_400_000;

/**
 * Estado calculado con las fechas (no hace falta un proceso programado):
 * pagada → ACTIVE; si no, en prueba → TRIAL; luego GRACE_DAYS de gracia → PAST_DUE; después → EXPIRED.
 */
export function subscriptionState(subscription: { trialEndsAt: Date; paidUntil: Date | null }, now: Date): SubscriptionState {
  const { trialEndsAt, paidUntil } = subscription;
  const daysUntil = (date: Date) => Math.max(0, Math.ceil((date.getTime() - now.getTime()) / DAY));

  if (paidUntil && paidUntil > now) {
    return { status: "ACTIVE", endsAt: paidUntil, daysLeft: daysUntil(paidUntil), graceEndsAt: null, canReceiveOrders: true };
  }
  if (trialEndsAt > now) {
    return { status: "TRIAL", endsAt: trialEndsAt, daysLeft: daysUntil(trialEndsAt), graceEndsAt: null, canReceiveOrders: true };
  }
  const endsAt = paidUntil && paidUntil > trialEndsAt ? paidUntil : trialEndsAt;
  const graceEndsAt = new Date(endsAt.getTime() + GRACE_DAYS * DAY);
  return graceEndsAt > now
    ? { status: "PAST_DUE", endsAt, daysLeft: 0, graceEndsAt, canReceiveOrders: true }
    : { status: "EXPIRED", endsAt, daysLeft: 0, graceEndsAt, canReceiveOrders: false };
}

/** Suma meses calendario (31 de enero + 1 mes = 28/29 de febrero). */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** La fecha más tardía (ignora las vacías). */
export const latest = (...dates: (Date | null | undefined)[]) =>
  new Date(Math.max(...dates.filter((date): date is Date => Boolean(date)).map((date) => date.getTime())));
