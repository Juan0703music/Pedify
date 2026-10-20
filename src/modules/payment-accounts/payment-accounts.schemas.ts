import { z } from "zod";
import { PaymentAccountKind } from "../../generated/prisma/enums.js";
import { optionalText } from "../businesses/businesses.schemas.js";

export const PAYMENT_ACCOUNT_LABEL: Record<PaymentAccountKind, string> = {
  NEQUI: "Nequi",
  BRE_B: "Bre-B",
  DAVIPLATA: "Daviplata",
};

export const paymentAccountParamsSchema = z.object({
  kind: z.enum(PaymentAccountKind, { error: "Cuenta inválida." }),
});

export const updatePaymentAccountSchema = z.object({
  /** Celular, correo, cédula o alias con @ (llave Bre-B). */
  accountKey: optionalText(80, "La llave o el número").refine((value) => value === undefined || value === null || value.length >= 3, {
    message: "Escribe el número o la llave completa.",
  }),
  holderName: optionalText(80, "El titular").refine((value) => value === undefined || value === null || value.length >= 2, {
    message: "Escribe el nombre del titular.",
  }),
});

export type PaymentAccountParams = z.infer<typeof paymentAccountParamsSchema>;
export type UpdatePaymentAccountInput = z.infer<typeof updatePaymentAccountSchema>;
