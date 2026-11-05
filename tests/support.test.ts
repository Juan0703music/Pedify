import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { pushService } from "../src/modules/push/push.service.js";
import { captchaService, type CaptchaChallenge } from "../src/services/captcha.service.js";
import { mailer } from "../src/services/mail.service.js";
import { businessDaysAfter } from "../src/utils/holidays.js";
import { newAgent, registerMerchant } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

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
  captchaService.required = false;
});

const device = (name: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } });
const mailsTo = (email: string) => mailer.outbox.filter((mail) => mail.to === email.toLowerCase());

async function pedifyAdmin() {
  const admin = await registerMerchant({ name: "Juan Pedify", businessName: "Pedify Soporte" });
  await prisma.user.update({ where: { id: admin.profile.user.id }, data: { isPlatformAdmin: true } });
  await admin.agent.post("/api/v1/admin/push/subscriptions").send(device("celular-de-juan")).expect(201);
  return admin;
}

describe("Soporte y PQRS", () => {
  it("el negocio escribe desde su panel, Pedify responde y la conversación sigue hasta cerrarse", async () => {
    const admin = await pedifyAdmin();
    const cafe = await registerMerchant({ name: "Karina Martínez", businessName: "Café El Puente" });
    await cafe.agent.post("/api/v1/push/subscriptions").send(device("celular-de-karina")).expect(201);

    const invalid = await cafe.agent.post("/api/v1/support/tickets").send({ kind: "OTRO", subject: "", message: "corto" }).expect(400);
    expect(Object.keys(invalid.body.error.fields)).toEqual(expect.arrayContaining(["kind", "subject", "message"]));

    const created = (
      await cafe.agent
        .post("/api/v1/support/tickets")
        .send({ kind: "RECLAMO", subject: "No me llegan los pedidos", message: "Desde ayer los pedidos no suenan en el panel del celular." })
        .expect(201)
    ).body.data;
    expect(created).toMatchObject({ code: "PQRS-00001", kind: "RECLAMO", kindLabel: "Reclamo", status: "OPEN", name: "Karina Martínez", business: { name: "Café El Puente" }, unread: false });
    expect(created.messages).toHaveLength(1);
    expect(created).not.toHaveProperty("accessKey");

    // Acuse para el negocio; aviso por correo y al celular para Pedify.
    expect(mailsTo(cafe.input.email)[0]?.subject).toBe("Recibimos tu solicitud PQRS-00001");
    expect(mailsTo(admin.input.email)[0]?.subject).toBe("Nueva solicitud PQRS-00001 · Reclamo: No me llegan los pedidos");
    expect(pushed.find((sent) => sent.endpoint.endsWith("celular-de-juan"))?.payload).toMatchObject({ title: "Nueva solicitud · Reclamo", url: "/admin#soporte" });

    // Solo los administradores entran al panel de soporte; cada persona ve solo sus casos.
    await cafe.agent.get("/api/v1/admin/support").expect(403);
    const other = await registerMerchant({ businessName: "Otro negocio" });
    await other.agent.get(`/api/v1/support/tickets/${created.id}`).expect(404);

    const metrics = (await admin.agent.get("/api/v1/admin/metrics").expect(200)).body.data;
    expect(metrics.support).toEqual({ open: 1, overdue: 0 });
    const list = (await admin.agent.get("/api/v1/admin/support?status=OPEN").expect(200)).body.data;
    expect(list.items[0]).toMatchObject({ code: "PQRS-00001", overdue: false, lastMessage: { author: "REQUESTER" } });

    // Pedify responde: le llega al negocio por correo y al celular, y queda «sin leer».
    pushed = [];
    const answered = (await admin.agent.post(`/api/v1/admin/support/${created.id}/messages`).send({ body: "Hola, Karina: activa de nuevo los avisos en Configuración." }).expect(201)).body.data;
    expect(answered).toMatchObject({ status: "ANSWERED" });
    expect(answered.messages.at(-1)).toMatchObject({ author: "PEDIFY", authorName: "Equipo de Pedify" });
    const reply = mailsTo(cafe.input.email).at(-1)!;
    expect(reply.subject).toBe("Respondimos tu solicitud PQRS-00001");
    expect(reply.text).toContain("activa de nuevo los avisos");
    expect(reply.text).toContain(`/panel/soporte#${created.id}`);
    expect(pushed.find((sent) => sent.endpoint.endsWith("celular-de-karina"))?.payload).toMatchObject({ title: "Respondimos tu solicitud PQRS-00001", url: `/panel/soporte#${created.id}` });
    expect((await cafe.agent.get("/api/v1/support/unread").expect(200)).body.data).toEqual({ unread: 1 });
    await cafe.agent.get(`/api/v1/support/tickets/${created.id}`).expect(200);
    expect((await cafe.agent.get("/api/v1/support/unread").expect(200)).body.data).toEqual({ unread: 0 });

    // El negocio vuelve a escribir: queda por responder otra vez.
    mailer.outbox.length = 0;
    const back = (await cafe.agent.post(`/api/v1/support/tickets/${created.id}/messages`).send({ body: "Ya funcionó, gracias." }).expect(201)).body.data;
    expect(back).toMatchObject({ status: "OPEN" });
    expect(mailsTo(admin.input.email)[0]?.subject).toBe("Nueva respuesta en PQRS-00001: No me llegan los pedidos");

    // Pedify cierra el caso.
    const closed = (await admin.agent.patch(`/api/v1/admin/support/${created.id}`).send({ status: "CLOSED" }).expect(200)).body.data;
    expect(closed).toMatchObject({ status: "CLOSED" });
    expect((await admin.agent.get("/api/v1/admin/support?status=CLOSED").expect(200)).body.data.total).toBe(1);
    expect((await cafe.agent.get("/api/v1/support/tickets").expect(200)).body.data).toHaveLength(1);
  });

  it("cualquier persona escribe desde /soporte (con «No soy un robot») y sigue el caso con su enlace", async () => {
    const admin = await pedifyAdmin();
    captchaService.required = true;
    const form = { name: "Laura Vergara", email: "Laura@Ejemplo.com", phone: "", kind: "PETICION", subject: "Quiero borrar mis datos", message: "Pedí en una tienda y quiero que borren mi número.", acceptPrivacy: true };
    expect((await newAgent().post("/api/v1/support/public").send(form).expect(400)).body.error.code).toBe("CAPTCHA_REQUIRED");

    const challenge = (await newAgent().get("/api/v1/captcha/challenge").expect(200)).body.data as CaptchaChallenge;
    let number = 0;
    while (createHash("sha256").update(`${challenge.salt}${number}`).digest("hex") !== challenge.challenge) number += 1;
    const captcha = Buffer.from(JSON.stringify({ salt: challenge.salt, number, signature: challenge.signature })).toString("base64url");
    const created = (await newAgent().post("/api/v1/support/public").set("X-Captcha", captcha).send(form).expect(201)).body.data;
    expect(created).toMatchObject({ code: "PQRS-00001", email: "laura@ejemplo.com", phone: null, kindLabel: "Petición" });
    expect(created.key).toMatch(/^[\w-]{30,}$/);
    expect(mailsTo("laura@ejemplo.com")[0]?.text).toContain(`/soporte#${created.id}.${created.key}`);

    captchaService.required = false;
    await newAgent().get(`/api/v1/support/public/${created.id}`).set("X-Support-Key", "x".repeat(32)).expect(404);
    const seen = (await newAgent().get(`/api/v1/support/public/${created.id}`).set("X-Support-Key", created.key).expect(200)).body.data;
    expect(seen.messages).toHaveLength(1);

    await admin.agent.post(`/api/v1/admin/support/${created.id}/messages`).send({ body: "Listo, Laura: le pedimos al negocio que los borre.", close: true }).expect(201);
    expect(mailsTo("laura@ejemplo.com").at(-1)?.text).toContain(`/soporte#${created.id}.${created.key}`);
    const again = (await newAgent().post(`/api/v1/support/public/${created.id}/messages`).set("X-Support-Key", created.key).send({ body: "Gracias." }).expect(201)).body.data;
    expect(again).toMatchObject({ status: "OPEN" });
  });

  it("el plazo es de 15 días hábiles (sin fines de semana ni festivos)", () => {
    // Viernes 13 de noviembre de 2026: el lunes 16 es festivo; el día 15 hábil es el lunes 7 de diciembre.
    expect(businessDaysAfter(new Date("2026-11-13T10:00:00-05:00"), 15).toISOString()).toBe("2026-12-08T04:59:59.999Z");
  });
});
