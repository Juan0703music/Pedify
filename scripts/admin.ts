/**
 * Administradores de la plataforma (panel central /admin):
 *   npm run admin:grant -- correo@ejemplo.com
 *   npm run admin:revoke -- correo@ejemplo.com
 * Se asignan solo por consola: no hay forma de volverse administrador desde la web.
 */
import { prisma } from "../src/config/database.js";

const [action, rawEmail] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();

try {
  if (!["grant", "revoke"].includes(action ?? "") || !email) {
    console.error("Uso: npm run admin:grant -- correo@ejemplo.com  |  npm run admin:revoke -- correo@ejemplo.com");
    process.exitCode = 1;
  } else {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      console.error(`No existe una cuenta con el correo ${email}. Primero regístrala en /registro.`);
      process.exitCode = 1;
    } else {
      await prisma.user.update({ where: { id: user.id }, data: { isPlatformAdmin: action === "grant" } });
      console.log(action === "grant" ? `${email} ahora es administrador de PedifyAI (/admin).` : `${email} ya no es administrador.`);
    }
  }
} finally {
  await prisma.$disconnect();
}
