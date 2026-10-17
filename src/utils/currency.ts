import { z } from "zod";

/**
 * Dinero en Pedify: enteros en pesos colombianos (COP), sin centavos.
 *
 * Reglas de redondeo explícitas:
 * - Precios, domicilios y totales siempre son enteros ≥ 0.
 * - Cualquier cálculo que produzca fracciones (porcentajes, descuentos) se redondea
 *   al peso más cercano con mitades hacia arriba (`roundCOP`).
 */

/** Límite por valor individual para detectar errores de digitación (100 millones). */
export const MAX_COP = 100_000_000;

export const copAmountSchema = z
  .number({ error: "Escribe un valor en pesos." })
  .int("El valor debe ser un número entero de pesos (sin centavos).")
  .min(0, "El valor no puede ser negativo.")
  .max(MAX_COP, "El valor es demasiado alto.");

export function isValidCOP(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Redondea al peso más cercano; las mitades suben (12.5 → 13). */
export function roundCOP(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("Valor monetario inválido.");
  return Math.floor(value + 0.5);
}

/** Calcula un porcentaje de un valor en COP aplicando la regla de redondeo. */
export function percentOfCOP(amount: number, percent: number): number {
  return roundCOP((amount * percent) / 100);
}

/** Multiplica precio × cantidad verificando que el resultado siga siendo un entero seguro. */
export function multiplyCOP(unitPrice: number, quantity: number): number {
  const result = unitPrice * quantity;
  if (!Number.isSafeInteger(result)) throw new RangeError("El valor del pedido excede el límite permitido.");
  return result;
}

/** Formato colombiano: 18000 → "$18.000". */
export function formatCOP(value: number): string {
  const sign = value < 0 ? "-" : "";
  const digits = Math.abs(Math.trunc(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}$${digits}`;
}
