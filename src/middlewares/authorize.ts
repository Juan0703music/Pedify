import type { Request, RequestHandler } from "express";
import type { MembershipRole } from "../generated/prisma/enums.js";
import { prisma } from "../config/database.js";
import { businessesRepository } from "../modules/businesses/businesses.repository.js";
import type { TenantContext } from "../types/common.js";
import { forbidden } from "../utils/errors.js";
import { getAuth } from "./authenticate.js";

/**
 * Verifica en la base de datos, en cada petición, que el usuario pertenece al negocio
 * activo de su sesión (y opcionalmente que tiene uno de los roles indicados).
 * Deja el negocio verificado en `req.tenant`; los servicios filtran siempre por ese id.
 */
export function requireBusiness(...roles: MembershipRole[]): RequestHandler {
  return async (req, _res, next) => {
    const auth = getAuth(req);
    if (!auth.activeBusinessId) {
      throw forbidden("Primero registra o selecciona un negocio.", "NO_ACTIVE_BUSINESS");
    }

    const membership = await businessesRepository.findMembership(auth.userId, auth.activeBusinessId);
    if (!membership) {
      throw forbidden("No tienes acceso a este negocio.", "NOT_A_MEMBER");
    }
    if (membership.business.status !== "ACTIVE") {
      throw forbidden("Este negocio está suspendido. Comunícate con soporte de PedifyAI.", "BUSINESS_SUSPENDED");
    }
    if (roles.length > 0 && !roles.includes(membership.role)) {
      throw forbidden("Solo el propietario del negocio puede realizar esta acción.", "ROLE_REQUIRED");
    }

    req.tenant = { businessId: membership.businessId, role: membership.role };
    next();
  };
}

/** Devuelve el negocio verificado; falla si la ruta no pasó por `requireBusiness`. */
export function getTenant(req: Request): TenantContext {
  if (!req.tenant) throw forbidden();
  return req.tenant;
}

/**
 * Panel central de PedifyAI: solo usuarios marcados como administradores de la plataforma
 * (se asignan por consola con `npm run admin:grant`). Se verifica en la base en cada petición.
 */
export const requirePlatformAdmin: RequestHandler = async (req, _res, next) => {
  const auth = getAuth(req);
  const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { isPlatformAdmin: true } });
  if (!user?.isPlatformAdmin) throw forbidden("Esta sección es solo para el equipo de PedifyAI.", "ADMIN_REQUIRED");
  next();
};
