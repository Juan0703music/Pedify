import { z } from "zod";
import { BusinessStatus, PlanCode } from "../../generated/prisma/enums.js";
import { paginationQuerySchema } from "../../utils/pagination.js";

export const SUBSCRIPTION_FILTERS = ["TRIAL", "ACTIVE", "PAST_DUE", "EXPIRED", "SUSPENDED"] as const;

export const listBusinessesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(80).optional(),
  status: z.enum(SUBSCRIPTION_FILTERS).optional(),
});

export const businessParamsSchema = z.object({
  id: z.uuid("Negocio inválido."),
});

export const updateBusinessAdminSchema = z
  .object({
    /** Suspender o reactivar el negocio (suspendido: sin panel ni tienda). */
    status: z.enum(BusinessStatus),
    plan: z.enum(PlanCode),
    /** Días adicionales de prueba (desde hoy o desde el fin de la prueba actual). */
    extendTrialDays: z.number().int().min(1).max(90),
  })
  .partial()
  .refine((value) => Object.values(value).some((item) => item !== undefined), "No hay cambios para aplicar.");

export const PAYMENT_METHODS = ["NEQUI", "DAVIPLATA", "TRANSFERENCIA", "EFECTIVO", "OTRO"] as const;

export const recordPaymentSchema = z.object({
  plan: z.enum(PlanCode).optional(),
  months: z.number({ error: "Indica cuántos meses paga." }).int().min(1).max(12),
  /** Valor recibido en pesos; por defecto, el precio del plan × meses (12 meses: el precio anual con descuento). */
  amount: z.number().int().min(0).max(10_000_000).optional(),
  method: z.enum(PAYMENT_METHODS, { error: "Elige el medio de pago." }),
  reference: z.string().trim().max(80).optional(),
  note: z.string().trim().max(200).optional(),
});

export type ListBusinessesQuery = z.infer<typeof listBusinessesQuerySchema>;
export type BusinessParams = z.infer<typeof businessParamsSchema>;
export type UpdateBusinessAdminInput = z.infer<typeof updateBusinessAdminSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
