import { z } from "zod";
import { phoneSchema } from "../../utils/phone.js";

export const emailSchema = z
  .string({ error: "Escribe tu correo." })
  .trim()
  .toLowerCase()
  .max(254, "El correo es demasiado largo.")
  .pipe(z.email("Escribe un correo válido."));

export const newPasswordSchema = z
  .string({ error: "Escribe una contraseña." })
  .min(8, "La contraseña debe tener al menos 8 caracteres.")
  .max(128, "La contraseña no puede superar 128 caracteres.");

export const personNameSchema = z
  .string({ error: "Escribe tu nombre." })
  .trim()
  .min(2, "El nombre debe tener al menos 2 caracteres.")
  .max(80, "El nombre no puede superar 80 caracteres.");

export const businessNameSchema = z
  .string({ error: "Escribe el nombre del negocio." })
  .trim()
  .min(2, "El nombre del negocio debe tener al menos 2 caracteres.")
  .max(80, "El nombre del negocio no puede superar 80 caracteres.");

/** Crear cuenta de comerciante y registrar su negocio en un solo paso. */
export const registerSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  password: newPasswordSchema,
  businessName: businessNameSchema,
  businessPhone: phoneSchema,
  /** Autorización del tratamiento de datos personales (Ley 1581 de 2012). */
  acceptPrivacy: z.literal(true, { error: "Para crear la cuenta debes aceptar la política de tratamiento de datos." }),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: "Escribe tu contraseña." }).min(1, "Escribe tu contraseña.").max(128),
  /**
   * Rol con el que la persona dice entrar ("Soy el dueño" / "Soy empleado"). No da permisos:
   * el rol real lo define la cuenta; si no coincide, no se abre la sesión.
   */
  as: z.enum(["OWNER", "EMPLOYEE"]).optional(),
});

export const updateProfileSchema = z.object({
  name: personNameSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string({ error: "Escribe tu contraseña actual." }).min(1, "Escribe tu contraseña actual.").max(128),
    newPassword: newPasswordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "La nueva contraseña debe ser distinta de la actual.",
    path: ["newPassword"],
  });

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string({ error: "El enlace no es válido." }).regex(/^[A-Za-z0-9_-]{32,128}$/, "El enlace no es válido."),
  newPassword: newPasswordSchema,
});

export const switchBusinessSchema = z.object({
  businessId: z.uuid("Negocio inválido."),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type SwitchBusinessInput = z.infer<typeof switchBusinessSchema>;
