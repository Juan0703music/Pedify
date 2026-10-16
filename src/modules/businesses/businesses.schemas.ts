import { z } from "zod";
import { MembershipRole, PaymentMethod, SalesPolicy } from "../../generated/prisma/enums.js";
import { copAmountSchema } from "../../utils/currency.js";
import { mobilePhoneSchema, phoneSchema } from "../../utils/phone.js";
import { businessNameSchema, emailSchema, newPasswordSchema, personNameSchema } from "../auth/auth.schemas.js";

/** Texto opcional: vacío se guarda como null. */
export const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} no puede superar ${max} caracteres.`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "El enlace debe tener al menos 3 caracteres.")
  .max(50, "El enlace no puede superar 50 caracteres.")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Usa solo letras minúsculas sin tildes, números y guiones (ej.: sabores-del-caribe).");

export const createBusinessSchema = z.object({
  name: businessNameSchema,
  phone: phoneSchema,
});

export const updateBusinessSchema = z
  .object({
    name: businessNameSchema,
    phone: phoneSchema,
    slug: slugSchema,
    description: optionalText(300, "La descripción"),
    city: optionalText(80, "La ciudad"),
    address: optionalText(160, "La dirección"),
  })
  .partial();

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Usa el formato de 24 horas HH:MM.");

/** Un día del horario. Si `close` es menor que `open`, el turno termina al día siguiente (ej.: 18:00–02:00). */
export const dayScheduleSchema = z
  .object({
    day: z.number().int().min(0).max(6),
    closed: z.boolean(),
    open: timeSchema,
    close: timeSchema,
  })
  .refine((day) => day.closed || day.open !== day.close, {
    message: "La hora de apertura y la de cierre no pueden ser iguales.",
    path: ["close"],
  });

export const openingHoursSchema = z
  .array(dayScheduleSchema)
  .length(7, "El horario debe incluir los 7 días de la semana.")
  .refine((days) => new Set(days.map((day) => day.day)).size === 7, "Cada día de la semana debe aparecer una vez.")
  .transform((days) => [...days].sort((a, b) => a.day - b.day));

export const updateSettingsSchema = z
  .object({
    openingHours: openingHoursSchema,
    acceptingOrders: z.boolean(),
    whatsappPhone: mobilePhoneSchema,
    deliveryEnabled: z.boolean(),
    deliveryFee: copAmountSchema,
    deliveryArea: optionalText(200, "La zona de cobertura"),
    pickupEnabled: z.boolean(),
    minimumOrder: copAmountSchema,
    paymentMethods: z
      .array(z.enum(PaymentMethod))
      .min(1, "Elige al menos un método de pago.")
      .transform((methods) => [...new Set(methods)]),
    /** Qué pedidos cuentan como venta en las analíticas. */
    salesPolicy: z.enum(SalesPolicy),
  })
  .partial();

export const addMemberSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  /** Solo se usa si el correo aún no tiene cuenta en PedifyAI. */
  password: newPasswordSchema.optional(),
  role: z.enum(MembershipRole).default("EMPLOYEE"),
});

export const updateMemberSchema = z.object({
  role: z.enum(MembershipRole),
});

export const membershipParamsSchema = z.object({
  membershipId: z.uuid("Miembro inválido."),
});

export const qrQuerySchema = z.object({
  format: z.enum(["svg", "png"]).default("svg"),
  download: z
    .enum(["1", "true"])
    .optional()
    .transform((value) => value !== undefined),
});

export type DaySchedule = z.infer<typeof dayScheduleSchema>;
export type QrQuery = z.infer<typeof qrQuerySchema>;
export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type MembershipParams = z.infer<typeof membershipParamsSchema>;
