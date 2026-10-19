import type { MembershipRole } from "../generated/prisma/enums.js";
import type { Permissions } from "../modules/businesses/permissions.js";

/** Usuario autenticado por la cookie de sesión. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  /** Negocio seleccionado en el panel; puede ser null si el usuario no pertenece a ninguno. */
  activeBusinessId: string | null;
}

/** Negocio verificado para la petición: el usuario pertenece a él con este rol. */
export interface TenantContext {
  businessId: string;
  role: MembershipRole;
  /** Lo que puede hacer en este negocio (el propietario, todo). */
  permissions: Permissions;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
