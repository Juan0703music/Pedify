import { z } from "zod";
import { daysBetween } from "../../utils/dates.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD.");

/** Periodo en fechas de calendario de Colombia; sin fechas = hoy. */
export const rangeQuerySchema = z
  .object({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
  })
  .refine((range) => !range.from || !range.to || range.from <= range.to, {
    path: ["to"],
    message: "La fecha final debe ser igual o posterior a la inicial.",
  })
  .refine((range) => !range.from || !range.to || daysBetween(range.from, range.to) <= 366, {
    path: ["to"],
    message: "El periodo puede ser de hasta un año.",
  });

export type RangeQuery = z.infer<typeof rangeQuerySchema>;
