import type { PlanCode } from "../../generated/prisma/enums.js";

/**
 * Planes de Pedify (fase 5: comercialización). Precios en pesos colombianos: mes a mes o el año completo
 * con descuento. Todos los planes incluyen todas las funciones; cambian los límites de productos, de
 * personas del equipo y de negocios que puede tener el propietario. Para cambiar precios o límites basta con editar este archivo (no requiere
 * migración; un plan nuevo sí, porque `PlanCode` es un enum de la base).
 */
export interface Plan {
  code: PlanCode;
  name: string;
  priceMonthly: number;
  /** Descuento (en %) por pagar los 12 meses de una vez. */
  annualDiscountPercent: number;
  /** Valor del año completo con el descuento ya aplicado: 12 × mensual − descuento. */
  priceYearly: number;
  /** Productos en el menú; null = ilimitados. */
  maxProducts: number | null;
  /** Personas con acceso al panel, incluido el propietario; null = ilimitadas. */
  maxMembers: number | null;
  /** Negocios que puede tener el propietario (incluido este); null = ilimitados. */
  maxBusinesses: number | null;
  summary: string;
}

export const PLANS: Record<PlanCode, Plan> = {
  EMPRENDEDOR: {
    code: "EMPRENDEDOR",
    name: "Emprendedor",
    priceMonthly: 119_900,
    annualDiscountPercent: 10,
    priceYearly: 1_294_920,
    maxProducts: 15,
    maxMembers: 1,
    maxBusinesses: 1,
    summary: "Para empezar a vender por tu enlace: un menú corto que manejas tú mismo.",
  },
  NEGOCIO: {
    code: "NEGOCIO",
    name: "Negocio",
    priceMonthly: 399_900,
    annualDiscountPercent: 8,
    priceYearly: 4_414_896,
    maxProducts: 100,
    maxMembers: 20,
    maxBusinesses: 3,
    summary: "Para el negocio con carta completa y equipo en el mostrador.",
  },
  EMPRESA: {
    code: "EMPRESA",
    name: "Empresa",
    priceMonthly: 799_900,
    annualDiscountPercent: 5,
    priceYearly: 9_118_860,
    maxProducts: null,
    maxMembers: null,
    maxBusinesses: null,
    summary: "Para el negocio grande: productos, equipo y negocios sin límite.",
  },
};

/** Plan al que conviene pasarse cuando se llega a un límite (el siguiente en precio). */
export const UPGRADE: Partial<Record<PlanCode, PlanCode>> = { EMPRENDEDOR: "NEGOCIO", NEGOCIO: "EMPRESA" };

/** Valor de un pago: 12 meses se cobran al precio anual (con descuento); otros, mes a mes. */
export const priceFor = (plan: Plan, months: number) => (months === 12 ? plan.priceYearly : plan.priceMonthly * months);

/**
 * Días de prueba gratis de cada plan. Al registrarse el negocio elige qué plan probar y la prueba
 * usa los límites de ese plan; si no elige, prueba Negocio.
 */
export const TRIAL_DAYS = 7;
export const DEFAULT_TRIAL_PLAN: PlanCode = "NEGOCIO";

/** Días después del vencimiento en que la tienda sigue recibiendo pedidos mientras se paga. */
export const GRACE_DAYS = 5;

export const planOf = (code: PlanCode): Plan => PLANS[code];

/** "1 negocio" · "hasta 3 negocios" · "negocios ilimitados". */
export const businessesLabel = (max: number | null) => (max === null ? "negocios ilimitados" : max === 1 ? "1 negocio" : `hasta ${max} negocios`);
