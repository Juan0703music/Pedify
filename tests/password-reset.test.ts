import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { mailer } from "../src/services/mail.service.js";
import { newAgent, PASSWORD, registerMerchant } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(async () => {
  await resetDatabase();
  mailer.outbox.length = 0;
});

const tokenFrom = (text: string) => /restablecer\?token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? "";

describe("Recuperación de contraseña (sección 12)", () => {
  it("responde igual exista o no la cuenta y solo envía correo si existe", async () => {
    const { input } = await registerMerchant();
    const unknown = await newAgent().post("/api/v1/auth/forgot-password").send({ email: "nadie@ejemplo.com" }).expect(200);
    const known = await newAgent().post("/api/v1/auth/forgot-password").send({ email: input.email.toUpperCase() }).expect(200);
    expect(unknown.body).toEqual(known.body);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mailer.outbox).toHaveLength(1);
    expect(mailer.outbox[0]).toMatchObject({ to: input.email.toLowerCase(), subject: "Restablece tu contraseña de PedifyAI" });
    expect(mailer.outbox[0]?.text).toContain("http://localhost:3000/restablecer?token=");
  });

  it("cambia la contraseña con el enlace, cierra las sesiones y el enlace no sirve dos veces", async () => {
    const { agent, input } = await registerMerchant();
    await newAgent().post("/api/v1/auth/forgot-password").send({ email: input.email }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const token = tokenFrom(mailer.outbox[0]?.text ?? "");
    // En la base solo está el hash del token.
    expect(await prisma.passwordResetToken.count({ where: { tokenHash: token } })).toBe(0);

    await newAgent().post("/api/v1/auth/reset-password").send({ token, newPassword: "nueva-clave-segura" }).expect(200);
    await agent.get("/api/v1/auth/me").expect(401);
    await newAgent().post("/api/v1/auth/login").send({ email: input.email, password: PASSWORD }).expect(401);
    await newAgent().post("/api/v1/auth/login").send({ email: input.email, password: "nueva-clave-segura" }).expect(200);

    const reused = await newAgent().post("/api/v1/auth/reset-password").send({ token, newPassword: "otra-clave-segura" }).expect(400);
    expect(reused.body.error.code).toBe("RESET_LINK_INVALID");
  });

  it("rechaza enlaces vencidos, inválidos y anteriores al último solicitado", async () => {
    const { input } = await registerMerchant();
    for (let i = 0; i < 2; i++) await newAgent().post("/api/v1/auth/forgot-password").send({ email: input.email }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const [first, second] = mailer.outbox.map((mail) => tokenFrom(mail.text));

    await newAgent().post("/api/v1/auth/reset-password").send({ token: first, newPassword: "nueva-clave-segura" }).expect(400);
    await prisma.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await newAgent().post("/api/v1/auth/reset-password").send({ token: second, newPassword: "nueva-clave-segura" }).expect(400);
    const invalid = await newAgent().post("/api/v1/auth/reset-password").send({ token: "corto", newPassword: "nueva-clave-segura" }).expect(400);
    expect(invalid.body.error.fields.token).toBeDefined();
  });
});
