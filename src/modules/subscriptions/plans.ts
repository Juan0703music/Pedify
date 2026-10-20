import type { PlanCode } from "../../generated/prisma/enums.js";

/**
 * Planes de Pedify (fase 5: comercialización). Precios en pesos colombianos: mes a mes o el año completo
 * con descuento. Todos los planes incluyen todas las funciones; cambian los límites de productos y de
 * personas del equipo. Para cambiar precios o límites basta con editar este archivo (no requiere
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
  maxProducts: number;
  /** Personas con acceso al panel, incluido el propietario. */
  maxMembers: number;
  summary: string;
}

export const PLANS: Record<PlanCode, Plan> = {
  EMPRENDEDOR: {
    code: "EMPRENDEDOR",
    name: "Emprendedor",
    priceMonthly: 99_900,
    annualDiscountPercent: 10,
    priceYearly: 1_078_920,
    maxProducts: 40,
    maxMembers: 2,
    summary: "Para empezar a vender por tu enlace: menú corto y una persona que te ayude.",
  },
  NEGOCIO: {
    code: "NEGOCIO",
    name: "Negocio",
    priceMonthly: 299_900,
    annualDiscountPercent: 8,
    priceYearly: 3_310_896,
    maxProducts: 300,
    maxMembers: 6,
    summary: "Para el negocio con carta completa y equipo en el mostrador.",
  },
  EMPRESA: {
    code: "EMPRESA",
    name: "Empresa",
    priceMonthly: 699_900,
    annualDiscountPercent: 5,
    priceYearly: 7_978_860,
    maxProducts: 1000,
    maxMembers: 20,
    summary: "Para el negocio grande o con varias líneas de producto y un equipo amplio.",
  },
};

/** Plan al que conviene pasarse cuando se llega a un límite (el siguiente en precio). */
export const UPGRADE: Partial<Record<PlanCode, PlanCode>> = { EMPRENDEDOR: "NEGOCIO", NEGOCIO: "EMPRESA" };

/** Valor de un pago: 12 meses se cobran al precio anual (con descuento); otros, mes a mes. */
export const priceFor = (plan: Plan, months: number) => (months === 12 ? plan.priceYearly : plan.priceMonthly * months);

/** Días de prueba gratis al registrar un negocio (con los límites del plan Negocio). */
export const TRIAL_DAYS = 14;

/** Días después del vencimiento en que la tienda sigue recibiendo pedidos mientras se paga. */
export const GRACE_DAYS = 5;

export const planOf = (code: PlanCode): Plan => PLANS[code];
