import { prisma, type DbClient } from "../../config/database.js";

/** Campos públicos del usuario: el hash de la contraseña nunca sale del repositorio salvo en `findCredentials`. */
export const publicUserSelect = { id: true, name: true, email: true, isPlatformAdmin: true, createdAt: true } as const;

export const authRepository = {
  findCredentialsByEmail(email: string) {
    return prisma.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } });
  },

  findCredentialsById(id: string) {
    return prisma.user.findUnique({ where: { id }, select: { id: true, passwordHash: true } });
  },

  findUserById(id: string) {
    return prisma.user.findUnique({ where: { id }, select: publicUserSelect });
  },

  findUserByEmail(email: string, db: DbClient = prisma) {
    return db.user.findUnique({ where: { email }, select: publicUserSelect });
  },

  createUser(data: { name: string; email: string; passwordHash: string; privacyAcceptedAt?: Date }, db: DbClient = prisma) {
    return db.user.create({ data, select: publicUserSelect });
  },

  updateUser(id: string, data: { name?: string; passwordHash?: string }, db: DbClient = prisma) {
    return db.user.update({ where: { id }, data, select: publicUserSelect });
  },

  createSession(
    data: { userId: string; tokenHash: string; activeBusinessId: string | null; userAgent?: string; expiresAt: Date },
    db: DbClient = prisma,
  ) {
    return db.session.create({ data, select: { id: true } });
  },

  findSessionByTokenHash(tokenHash: string) {
    return prisma.session.findUnique({ where: { tokenHash } });
  },

  touchSession(id: string, data: { lastUsedAt: Date; expiresAt?: Date }) {
    return prisma.session.update({ where: { id }, data, select: { id: true } });
  },

  setActiveBusiness(sessionId: string, activeBusinessId: string | null) {
    return prisma.session.update({ where: { id: sessionId }, data: { activeBusinessId }, select: { id: true } });
  },

  revokeSession(id: string) {
    return prisma.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  },

  /** Revoca todas las sesiones del usuario, salvo opcionalmente la actual. */
  revokeUserSessions(userId: string, exceptSessionId?: string, db: DbClient = prisma) {
    return db.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
  },

  // ─── Recuperación de contraseña ───

  /** Crea un enlace nuevo e invalida los anteriores que no se usaron. */
  async createPasswordReset(userId: string, tokenHash: string, expiresAt: Date) {
    await prisma.$transaction([
      prisma.passwordResetToken.deleteMany({ where: { userId, usedAt: null } }),
      prisma.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } }),
    ]);
  },

  findPasswordReset(tokenHash: string, db: DbClient = prisma) {
    return db.passwordResetToken.findUnique({ where: { tokenHash }, select: { id: true, userId: true, expiresAt: true, usedAt: true } });
  },

  /** Marca el enlace como usado solo si nadie lo usó antes (evita dos cambios con el mismo enlace). */
  async consumePasswordReset(id: string, db: DbClient = prisma) {
    const { count } = await db.passwordResetToken.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
    return count === 1;
  },

  /** Limpieza: borra sesiones vencidas o revocadas hace tiempo. */
  deleteStaleSessions(userId: string, before: Date) {
    return prisma.session.deleteMany({
      where: { userId, OR: [{ expiresAt: { lt: before } }, { revokedAt: { lt: before } }] },
    });
  },
};
