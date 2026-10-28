import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { mailer } from "../../services/mail.service.js";
import { wompi } from "../../services/wompi.service.js";
import { clock } from "../../utils/clock.js";
import { formatCOP } from "../../utils/currency.js";
import { escapeHtml } from "../../utils/html.js";
import { logger } from "../../utils/logger.js";
import { pushService } from "../push/push.service.js";
import { platformAccountsService } from "./platform-accounts.service.js";
import { GRACE_DAYS, planOf } from "./plans.js";
import { subscriptionState, type SubscriptionState } from "./subscription-state.js";

/**
 * Recordatorios de vencimiento: al propietario le llega un correo y un aviso al celular 5 días antes
 * de que termine su plan (o su prueba gratis), 1 día antes y el día que vence (con los días de gracia
 * que le quedan). Cada uno se envía una sola vez por fecha de fin (`subscriptions.reminder_*`): si
 * renueva, la fecha cambia y vuelven a empezar. No se envían si ya tiene un pago en revisión ni a un
 * negocio suspendido, y solo de día (hora de Colombia). Corre cada hora en el servidor de producción;
 * si estuvo apagado, envía solo el recordatorio que corresponde ahora (no los atrasados).
 */
const STAGES = ["DAYS_5", "DAY_1", "EXPIRED"] as const;
type Stage = (typeof STAGES)[number];

const DAY = 86_400_000;
const DAYS_BEFORE = 5;
const RUN_EVERY_MS = 60 * 60_000;
/** Se envían entre las 8:00 a. m. y las 8:00 p. m. (hora de Colombia). */
const SEND_FROM_HOUR = 8;
const SEND_UNTIL_HOUR = 20;

const bogotaHour = (date: Date) => Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Bogota" }).format(date));
const bogotaDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(date);
const longDate = (date: Date) => new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", timeZone: "America/Bogota" }).format(date);

/** «hoy», «mañana» o «en 4 días», según el calendario de Colombia. */
function whenLabel(end: Date, now: Date) {
  const days = Math.round((Date.parse(bogotaDay(end)) - Date.parse(bogotaDay(now))) / DAY);
  return days <= 0 ? "hoy" : days === 1 ? "mañana" : `en ${days} días`;
}

/** El recordatorio que corresponde ahora (o null si aún falta o ya pasó la gracia). */
function dueStage(state: SubscriptionState, now: Date): Stage | null {
  if (state.status === "PAST_DUE") return "EXPIRED";
  if (state.status !== "ACTIVE" && state.status !== "TRIAL") return null;
  const left = state.endsAt.getTime() - now.getTime();
  if (left <= DAY) return "DAY_1";
  if (left <= DAYS_BEFORE * DAY) return "DAYS_5";
  return null;
}

/** Cómo renovar, según las formas de pago configuradas. */
async function howToPay(price: number) {
  const accounts = await platformAccountsService.usable();
  if (accounts.length > 0) {
    const names = accounts.map((account) => (account.kind === "BRE_B" ? "llave Bre-B" : account.label)).join(" o ");
    return `En Mi plan paga ${formatCOP(price)} por ${names} y sube el comprobante.`;
  }
  if (wompi.enabled()) return `Págalo en línea desde Mi plan (${formatCOP(price)} al mes).`;
  return "Entra a Mi plan para renovarlo.";
}

interface Reminder {
  subject: string;
  headline: string;
  detail: string;
  push: { title: string; body: string };
}

/** `trial`: lo que termina es la prueba gratis (nunca ha pagado un periodo más allá de ella). */
function compose(stage: Stage, state: SubscriptionState, trial: boolean, business: string, planName: string, now: Date): Reminder {
  if (stage === "EXPIRED") {
    const grace = longDate(state.graceEndsAt!);
    return {
      subject: "Tu plan de Pedify venció: renuévalo para seguir recibiendo pedidos",
      headline: `${trial ? "Tu prueba gratis" : `Tu plan ${planName}`} de ${business} terminó el ${longDate(state.endsAt)}.`,
      detail: `Tu tienda sigue recibiendo pedidos hasta el ${grace}; después deja de recibir pedidos en línea (tus datos no se pierden).`,
      push: { title: "Tu plan de Pedify venció", body: `${business} recibe pedidos hasta el ${grace}. Renueva tu plan.` },
    };
  }
  const when = whenLabel(state.endsAt, now);
  if (trial) {
    return {
      subject: `Tu prueba gratis de Pedify termina ${when}`,
      headline: `La prueba gratis de ${business} termina ${when} (${longDate(state.endsAt)}).`,
      detail: `Para seguir recibiendo pedidos sin interrupciones, elige tu plan y págalo.`,
      push: { title: `Tu prueba gratis termina ${when}`, body: `Elige tu plan para que ${business} siga recibiendo pedidos.` },
    };
  }
  return {
    subject: `Tu plan de Pedify vence ${when}`,
    headline: `El plan ${planName} de ${business} vence ${when} (${longDate(state.endsAt)}).`,
    detail: "Renuévalo para seguir recibiendo pedidos sin interrupciones. Los días que te queden no se pierden: el nuevo mes empieza cuando termina el actual.",
    push: { title: `Tu plan vence ${when}`, body: `Renueva el plan de ${business} para seguir recibiendo pedidos.` },
  };
}

/** Negocios activos cuyo plan o prueba termina en los próximos días o está en los días de gracia. */
async function candidates(now: Date) {
  const rows = await prisma.$queryRaw<{ businessId: string }[]>`
    SELECT s.business_id AS "businessId"
    FROM subscriptions s JOIN businesses b ON b.id = s.business_id
    WHERE b.status = 'ACTIVE'
      AND GREATEST(COALESCE(s.paid_until, s.trial_ends_at), s.trial_ends_at)
          BETWEEN ${now}::timestamptz - ${`${GRACE_DAYS} days`}::interval AND ${now}::timestamptz + ${`${DAYS_BEFORE} days`}::interval`;
  return rows.map((row) => row.businessId);
}

/** Envía el recordatorio que le toca a un negocio, una sola vez. Devuelve true si lo envió. */
async function remind(businessId: string, now: Date): Promise<boolean> {
  const subscription = await prisma.subscription.findUnique({
    where: { businessId },
    select: {
      plan: true,
      trialEndsAt: true,
      paidUntil: true,
      reminderStage: true,
      reminderEndsAt: true,
      business: { select: { name: true, planTransfers: { where: { status: "PENDING" }, select: { id: true }, take: 1 } } },
    },
  });
  if (!subscription) return false;
  const state = subscriptionState(subscription, now);
  const stage = dueStage(state, now);
  // Ya pagó y su comprobante está en revisión: no hace falta recordarle (si se rechaza, vuelve a contar).
  if (!stage || subscription.business.planTransfers.length > 0) return false;

  // Se marca antes de enviar, con una condición: si dos servidores corren a la vez, solo uno lo envía.
  const lower = STAGES.slice(0, STAGES.indexOf(stage));
  const { count } = await prisma.subscription.updateMany({
    where: {
      businessId,
      OR: [{ reminderStage: null }, { reminderEndsAt: null }, { reminderEndsAt: { not: state.endsAt } }, { reminderStage: { in: lower } }],
    },
    data: { reminderStage: stage, reminderEndsAt: state.endsAt },
  });
  if (count === 0) return false;

  const plan = planOf(subscription.plan);
  const trial = !subscription.paidUntil || subscription.paidUntil <= subscription.trialEndsAt;
  const reminder = compose(stage, state, trial, subscription.business.name, plan.name, now);
  const howTo = await howToPay(plan.priceMonthly);
  const link = new URL("/panel/plan", env.APP_URL).toString();
  const owners = await prisma.businessMembership.findMany({
    where: { businessId, role: "OWNER" },
    select: { user: { select: { name: true, email: true } } },
  });
  await Promise.all(
    owners.map(({ user }) => {
      const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;
      return mailer
        .send({
          to: user.email,
          subject: reminder.subject,
          text: [`Hola, ${firstName}:`, "", reminder.headline, reminder.detail, "", howTo, `Renuévalo aquí: ${link}`].join("\n"),
          html: `<p>Hola, ${escapeHtml(firstName)}:</p>
<p><strong>${escapeHtml(reminder.headline)}</strong></p>
<p>${escapeHtml(reminder.detail)}</p>
<p>${escapeHtml(howTo)}</p>
<p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#17161c;color:#ffffff;border-radius:10px;text-decoration:none;font-weight:600">Renovar mi plan</a></p>`,
        })
        .catch((err: unknown) => logger.error({ err, businessId }, "No se pudo enviar el recordatorio de vencimiento"));
    }),
  );
  await pushService
    .notifyOwners(businessId, { ...reminder.push, url: "/panel/plan", tag: `plan-${stage.toLowerCase()}` })
    .catch((err: unknown) => logger.error({ err, businessId }, "No se pudo enviar el aviso de vencimiento al celular"));
  logger.info({ businessId, stage, endsAt: state.endsAt }, "Recordatorio de vencimiento enviado");
  return true;
}

let timer: NodeJS.Timeout | null = null;

export const renewalReminders = {
  /** Revisa todos los negocios y envía los recordatorios que tocan. Devuelve cuántos envió. */
  async run(now = clock.now()): Promise<number> {
    const hour = bogotaHour(now);
    if (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) return 0;
    let sent = 0;
    for (const businessId of await candidates(now)) {
      try {
        if (await remind(businessId, now)) sent += 1;
      } catch (err) {
        logger.error({ err, businessId }, "Error al revisar el recordatorio de vencimiento");
      }
    }
    return sent;
  },

  /** Programa la revisión: un minuto después de arrancar y luego cada hora. */
  start() {
    if (timer) return;
    const tick = () => void renewalReminders.run().catch((err: unknown) => logger.error({ err }, "Error en los recordatorios de vencimiento"));
    setTimeout(tick, 60_000).unref();
    timer = setInterval(tick, RUN_EVERY_MS);
    timer.unref();
  },

  stop() {
    if (timer) clearInterval(timer);
    timer = null;
  },
};
