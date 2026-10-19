import type { MembershipRole } from "../../generated/prisma/enums.js";

/**
 * Permisos de los empleados. El propietario siempre puede todo; a cada empleado el propietario
 * le elige estos permisos en Configuración → Equipo. Atender pedidos lo puede hacer cualquiera
 * del equipo; editar el menú, configurar el negocio, el plan, el equipo y borrar los datos de un
 * cliente son siempre solo del propietario.
 */
export const PERMISSIONS = ["markSoldOut", "viewSales", "viewCustomers", "viewAnalytics"] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type Permissions = Record<Permission, boolean>;

/** Valores iniciales de un empleado nuevo. */
export const DEFAULT_EMPLOYEE_PERMISSIONS: Permissions = {
  markSoldOut: true,
  viewSales: true,
  viewCustomers: true,
  viewAnalytics: false,
};

export const ALL_PERMISSIONS: Permissions = { markSoldOut: true, viewSales: true, viewCustomers: true, viewAnalytics: true };

/** Columna de la tabla business_memberships de cada permiso. */
export const PERMISSION_COLUMN = {
  markSoldOut: "canMarkSoldOut",
  viewSales: "canViewSales",
  viewCustomers: "canViewCustomers",
  viewAnalytics: "canViewAnalytics",
} as const satisfies Record<Permission, string>;

/** Lo que el empleado no puede hacer, en palabras (mensaje de error al intentarlo). */
export const PERMISSION_DENIED: Record<Permission, string> = {
  markSoldOut: "El propietario no te dio permiso para marcar productos agotados.",
  viewSales: "El propietario no te dio permiso para ver las ventas.",
  viewCustomers: "El propietario no te dio permiso para ver los clientes.",
  viewAnalytics: "El propietario no te dio permiso para ver las analíticas.",
};

export type PermissionColumns = { [K in Permission as (typeof PERMISSION_COLUMN)[K]]: boolean };

/** Permisos efectivos de una membresía (el propietario, todos). */
export function permissionsOf(membership: { role: MembershipRole } & PermissionColumns): Permissions {
  if (membership.role === "OWNER") return { ...ALL_PERMISSIONS };
  return {
    markSoldOut: membership.canMarkSoldOut,
    viewSales: membership.canViewSales,
    viewCustomers: membership.canViewCustomers,
    viewAnalytics: membership.canViewAnalytics,
  };
}

/** Convierte permisos (parciales) a las columnas de la tabla. */
export function toPermissionColumns(permissions: Partial<Permissions>): Partial<PermissionColumns> {
  const columns: Partial<PermissionColumns> = {};
  for (const permission of PERMISSIONS) {
    const value = permissions[permission];
    if (value !== undefined) columns[PERMISSION_COLUMN[permission]] = value;
  }
  return columns;
}

export const permissionColumnsSelect = {
  canMarkSoldOut: true,
  canViewSales: true,
  canViewCustomers: true,
  canViewAnalytics: true,
} as const;
