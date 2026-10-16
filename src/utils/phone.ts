import { z } from "zod";

/**
 * Teléfonos colombianos normalizados al formato internacional sin "+": 573001234567.
 * Es el formato que usa wa.me y permite comparar números escritos de formas distintas
 * ("300 123 4567", "+57 300-123-4567", "3001234567").
 */
export function normalizeColombianPhone(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("0057")) digits = digits.slice(2);
  if (digits.length === 10) digits = `57${digits}`;
  if (digits.length !== 12 || !digits.startsWith("57")) return null;

  const national = digits.slice(2);
  // Celulares (3xx) y fijos con indicativo de 10 dígitos (60x) desde 2021.
  if (!/^3\d{9}$/.test(national) && !/^60\d{8}$/.test(national)) return null;
  return digits;
}

export function isColombianMobile(normalized: string): boolean {
  return /^573\d{9}$/.test(normalized);
}

/** "573001234567" → "300 123 4567" */
export function formatColombianPhone(normalized: string): string {
  const national = normalized.startsWith("57") ? normalized.slice(2) : normalized;
  return national.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1 $2 $3");
}

export const phoneSchema = z
  .string({ error: "Escribe un número de teléfono." })
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizeColombianPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: "Escribe un número colombiano válido, por ejemplo 300 123 4567." });
      return z.NEVER;
    }
    return normalized;
  });

/** WhatsApp solo funciona con celulares. */
export const mobilePhoneSchema = phoneSchema.refine(isColombianMobile, {
  message: "El número de WhatsApp debe ser un celular (empieza por 3).",
});
