import { z } from "zod";
import { SupportKind } from "../../generated/prisma/enums.js";
import { paginationQuerySchema } from "../../utils/pagination.js";
import { phoneSchema } from "../../utils/phone.js";
import { emailSchema, personNameSchema } from "../auth/auth.schemas.js";

const text = (min: number, max: number, what: string) =>
  z
    .string({ error: `Escribe ${what}.` })
    .trim()
    .min(min, `Escribe ${what} (mínimo ${min} caracteres).`)
    .max(max, `No puede superar ${max} caracteres.`);

export const supportKindSchema = z.enum(SupportKind, { error: "Elige qué tipo de solicitud es." });

/** Desde el panel del negocio: el nombre y el correo salen de la cuenta. */
export const createTicketSchema = z.object({
  kind: supportKindSchema,
  subject: text(3, 120, "el asunto"),
  message: text(10, 4000, "tu mensaje"),
});

/** Desde /soporte, sin cuenta. */
export const publicTicketSchema = createTicketSchema.extend({
  name: personNameSchema,
  email: emailSchema,
  phone: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), phoneSchema.optional()),
  acceptPrivacy: z.literal(true, { error: "Para enviarla debes autorizar el tratamiento de tus datos." }),
});

export const supportMessageSchema = z.object({ body: text(2, 4000, "tu mensaje") });
export const adminReplySchema = supportMessageSchema.extend({ close: z.boolean().optional() });
export const ticketParamsSchema = z.object({ id: z.uuid("No encontramos esa solicitud.") });
export const adminTicketsQuerySchema = paginationQuerySchema.extend({ status: z.enum(["OPEN", "ANSWERED", "CLOSED", "ALL"]).default("OPEN") });
export const ticketStatusSchema = z.object({ status: z.enum(["OPEN", "CLOSED"]) });

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type PublicTicketInput = z.infer<typeof publicTicketSchema>;
export type AdminTicketsQuery = z.infer<typeof adminTicketsQuerySchema>;
