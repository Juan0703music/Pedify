import nodemailer, { type Transporter } from "nodemailer";
import { env, isProduction, isTest } from "../config/env.js";
import { logger } from "../utils/logger.js";

/**
 * Envío de correos (por ahora, solo recuperación de contraseña).
 * - Con SMTP_URL: se envía por ese servidor (cualquier proveedor SMTP).
 * - Sin SMTP_URL en desarrollo: el mensaje se muestra en el registro del servidor para poder probar.
 * - Sin SMTP_URL en producción: no se envía y se registra una advertencia (nunca el enlace).
 * - En pruebas: los correos quedan en `mailer.outbox`.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transport: Transporter | null = null;
const getTransport = () => (transport ??= nodemailer.createTransport(env.SMTP_URL));

export const mailer = {
  outbox: [] as Mail[],

  async send(mail: Mail): Promise<void> {
    if (isTest) {
      mailer.outbox.push(mail);
      return;
    }
    if (env.SMTP_URL) {
      await getTransport().sendMail({ from: env.MAIL_FROM, ...mail });
      return;
    }
    if (isProduction) {
      logger.warn({ subject: mail.subject }, "SMTP_URL no está configurado: el correo no se envió");
      return;
    }
    logger.info({ to: mail.to, subject: mail.subject }, `Correo (desarrollo, sin SMTP):\n${mail.text}`);
  },
};
