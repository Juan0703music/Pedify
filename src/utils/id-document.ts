import { z } from "zod";
import { IdDocumentType } from "../generated/prisma/enums.js";

/** Cómo se escribe cada documento en los textos legales y en la tienda. */
export const ID_TYPE_LABEL: Record<IdDocumentType, string> = { CC: "C.C.", NIT: "NIT", CE: "C.E.", PPT: "PPT", PA: "Pasaporte" };

export const idTypeSchema = z.enum(IdDocumentType, { error: "Elige el tipo de documento." });

/** Cédula, NIT (con o sin dígito de verificación) u otro documento: solo números, letras, puntos y guion. */
export const idNumberSchema = z
  .string({ error: "Escribe el número de documento." })
  .trim()
  .toUpperCase()
  .transform((value) => value.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^[0-9A-Z][0-9A-Z.-]{3,19}$/, "Escribe el número sin espacios (ej.: 1102345678 o 900123456-7)."));
