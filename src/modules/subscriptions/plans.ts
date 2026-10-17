import type { PlanCode } from "../../generated/prisma/enums.js";

/**
 * Planes de Pedify (fase 5: comercialización). Los precios son mensuales en pesos colombianos.
 * Ambos planes incluyen todas las funciones; cambian los límites de productos y de personas del equipo.
 * Para cambiar precios o límites basta con editar este archivo (no requiere migración).
 */
export interface Plan {
  code: PlanCode;
  name: string;
  priceMonthly: number;
  maxProducts: number;
  /** Personas con acceso al panel, incluido el propietario. */
  maxMembers: number;
  summary: string;
}

export const PLANS: Record<PlanCode, Plan> = {
  EMPRENDEDOR: {
    code: "EMPRENDEDOR",
    name: "Emprendedor",
    priceMonthly: 39_900,
    maxProducts: 40,
    maxMembers: 2,
    summary: "Para empezar a vender por tu enlace: menú corto y una persona que te ayude.",
  },
  NEGOCIO: {
    code: "NEGOCIO",
    name: "Negocio",
    priceMonthly: 69_900,
    maxProducts: 300,
    maxMembers: 6,
    summary: "Para el negocio con carta completa y equipo en el mostrador.",
  },
};

/** Días de prueba gratis al registrar un negocio (con los límites del plan Negocio). */
export const TRIAL_DAYS = 14;

/** Días después del vencimiento en que la tienda sigue recibiendo pedidos mientras se paga. */
export const GRACE_DAYS = 5;

export const planOf = (code: PlanCode): Plan => PLANS[code];
