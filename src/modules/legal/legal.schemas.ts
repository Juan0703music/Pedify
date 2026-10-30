import { z } from "zod";
import { idNumberSchema, idTypeSchema } from "../../utils/id-document.js";
import { phoneSchema } from "../../utils/phone.js";
import { emailSchema } from "../auth/auth.schemas.js";

/** Datos legales de Pedify (panel central). */
export const updateLegalSchema = z.object({
  legalName: z.string({ error: "Escribe el nombre o la razón social." }).trim().min(3, "Escribe el nombre o la razón social.").max(120),
  idType: idTypeSchema,
  idNumber: idNumberSchema,
  address: z.string({ error: "Escribe la dirección." }).trim().min(5, "Escribe la dirección completa.").max(160),
  city: z.string({ error: "Escribe la ciudad." }).trim().min(2, "Escribe la ciudad.").max(80),
  email: emailSchema,
  phone: phoneSchema.nullable().optional(),
});

export type UpdateLegalInput = z.infer<typeof updateLegalSchema>;
