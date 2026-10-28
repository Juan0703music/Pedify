import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { pushService } from "../src/modules/push/push.service.js";
import { renewalReminders } from "../src/modules/subscriptions/renewal-reminders.service.js";
import { mailer } from "../src/services/mail.service.js";
import { registerMerchant } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

const DAY = 86_400_000;
/** Un martes a las 10:00 a. m. en Colombia. */
const NOW = new Date("2026-11-10T15:00:00.000Z");
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

type Sent = { endpoint: string; payload: { title: string; body: string; url: string } };
let pushed: Sent[] = [];
const realTransport = pushService.transport;

beforeEach(async () => {
  await resetDatabase();
  mailer.outbox.length = 0;
  pushed = [];
  pushService.transport = async (subscription, payload) => {
    pushed.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
  };
});
afterEach(() => {
  pushService.transport = realTransport;
});

/** Negocio con su plan pagado hasta `paidUntil` (o en prueba hasta `trialEndsAt`) y el celular del dueño con avisos. */
async function business(dates: { trialEndsAt: Date; paidUntil?: Date | null }, name = "Café El Puente") {
  const merchant = await registerMerchant({ businessName: name });
  await prisma.subscription.update({ where: { businessId: merchant.businessId }, data: { trialEndsAt: dates.trialEndsAt, paidUntil: dates.paidUntil ?? null } });
  await prisma.pushSubscription.create({
    data: { userId: merchant.profile.user.id, businessId: merchant.businessId, endpoint: `https://fcm.googleapis.com/fcm/send/${merchant.businessId}`, p256dh: "B".repeat(87), auth: "a".repeat(22) },
  });
  return merchant;
}

const mailsTo = (email: string) => mailer.outbox.filter((mail) => mail.to === email.toLowerCase());

describe("Recordatorios de vencimiento del plan", () => {
  it("avisa 5 días antes, 1 día antes y al vencer, una sola vez cada uno, por correo y al celular", async () => {
    const { input } = await business({ trialEndsAt: at(-20), paidUntil: at(4) });

    expect(await renewalReminders.run(NOW)).toBe(1);
    expect(await renewalReminders.run(NOW)).toBe(0);
    const [first] = mailsTo(input.email);
    expect(first?.subject).toBe("Tu plan de Pedify vence en 4 días");
    expect(first?.text).toContain("El plan Negocio de Café El Puente vence en 4 días (14 de noviembre).");
    expect(first?.text).toContain("http://localhost:3000/panel/plan");
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.payload).toMatchObject({ title: "Tu plan vence en 4 días", url: "/panel/plan" });

    expect(await renewalReminders.run(at(3.2))).toBe(1); // 2:48 p. m. del día anterior
    expect(mailsTo(input.email)[1]?.subject).toBe("Tu plan de Pedify vence mañana");

    expect(await renewalReminders.run(at(5))).toBe(1);
    const expired = mailsTo(input.email)[2];
    expect(expired?.subject).toBe("Tu plan de Pedify venció: renuévalo para seguir recibiendo pedidos");
    expect(expired?.text).toContain("Tu tienda sigue recibiendo pedidos hasta el 19 de noviembre");
    expect(await renewalReminders.run(at(6))).toBe(0);
    expect(pushed).toHaveLength(3);
  });

  it("si renueva, los recordatorios vuelven a empezar con la nueva fecha", async () => {
    const { businessId } = await business({ trialEndsAt: at(-20), paidUntil: at(2) });
    expect(await renewalReminders.run(NOW)).toBe(1);

    await prisma.subscription.update({ where: { businessId }, data: { paidUntil: at(32) } });
    expect(await renewalReminders.run(NOW)).toBe(0);
    expect(await renewalReminders.run(at(28))).toBe(1);
    expect(mailer.outbox.at(-1)?.subject).toBe("Tu plan de Pedify vence en 4 días");
  });

  it("también avisa cuando termina la prueba gratis", async () => {
    const { input } = await business({ trialEndsAt: at(2) });
    expect(await renewalReminders.run(NOW)).toBe(1);
    expect(mailsTo(input.email)[0]?.subject).toBe("Tu prueba gratis de Pedify termina en 2 días");
  });

  it("no avisa de noche, con un pago en revisión, a un negocio suspendido ni si falta más de 5 días", async () => {
    const paid = await business({ trialEndsAt: at(-20), paidUntil: at(3) }, "Pagó y espera");
    await prisma.planTransfer.create({
      data: { businessId: paid.businessId, plan: "NEGOCIO", months: 1, amount: 399_900, method: "NEQUI", imageKey: "private/prueba.webp" },
    });
    const suspended = await business({ trialEndsAt: at(-20), paidUntil: at(3) }, "Suspendido");
    await prisma.business.update({ where: { id: suspended.businessId }, data: { status: "SUSPENDED" } });
    await business({ trialEndsAt: at(-20), paidUntil: at(9) }, "Le falta");
    const night = await business({ trialEndsAt: at(-20), paidUntil: at(3) }, "De noche");

    expect(await renewalReminders.run(new Date("2026-11-10T08:00:00.000Z"))).toBe(0); // 3:00 a. m. en Colombia
    expect(await renewalReminders.run(NOW)).toBe(1);
    expect(mailsTo(night.input.email)).toHaveLength(1);
    expect(mailsTo(paid.input.email)).toHaveLength(0);

    // En el panel, el dueño ve que su pago está en revisión.
    const summary = (await paid.agent.get("/api/v1/businesses/current").expect(200)).body.data.subscription;
    expect(summary).toMatchObject({ status: "ACTIVE", paymentInReview: true });
  });

  it("el panel central muestra los negocios por vencer, con el recordatorio enviado", async () => {
    const admin = await registerMerchant({ businessName: "Pedify Soporte" });
    await prisma.user.update({ where: { id: admin.profile.user.id }, data: { isPlatformAdmin: true } });
    await prisma.subscription.update({ where: { businessId: admin.businessId }, data: { trialEndsAt: new Date(Date.now() + 60 * DAY) } });
    const soon = await registerMerchant({ businessName: "Vence pronto" });
    const end = new Date(Date.now() + 3 * DAY);
    await prisma.subscription.update({
      where: { businessId: soon.businessId },
      data: { trialEndsAt: new Date(Date.now() - 20 * DAY), paidUntil: end, reminderStage: "DAYS_5", reminderEndsAt: end },
    });

    const metrics = (await admin.agent.get("/api/v1/admin/metrics").expect(200)).body.data;
    expect(metrics.businesses.expiring).toBe(1);
    const list = (await admin.agent.get("/api/v1/admin/businesses?status=EXPIRING").expect(200)).body.data;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ name: "Vence pronto", subscriptionStatus: "ACTIVE", lastReminder: "DAYS_5", paymentInReview: false });
  });
});
