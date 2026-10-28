/**
 * Administradores de la plataforma (panel central /admin):
 *   npm run admin:create -- correo@ejemplo.com "Nombre"   (cuenta nueva de administrador, sin negocio)
 *   npm run admin:grant -- correo@ejemplo.com             (una cuenta que ya existe)
 *   npm run admin:revoke -- correo@ejemplo.com
 * Se asignan solo por consola: no hay forma de volverse administrador desde la web. `create` muestra
 * una contraseña inicial que conviene cambiar al entrar (Mi cuenta → Cambiar contraseña).
 */
import { randomInt } from "node:crypto";
import { prisma } from "../src/config/database.js";
import { hashPassword } from "../src/modules/auth/password.js";

const [action, rawEmail, ...nameParts] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();
const USAGE =
  'Uso: npm run admin:create -- correo@ejemplo.com "Nombre"  |  npm run admin:grant -- correo@ejemplo.com  |  npm run admin:revoke -- correo@ejemplo.com';

/** Contraseña inicial fácil de dictar: sin letras que se confunden (l, 1, O, 0). */
function initialPassword() {
  const letters = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 14 }, () => letters[randomInt(letters.length)]).join("");
}

try {
  if (!["create", "grant", "revoke"].includes(action ?? "") || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(USAGE);
    process.exitCode = 1;
  } else if (action === "create") {
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: { isPlatformAdmin: true } });
      console.log(`${email} ya tenía cuenta: ahora es administrador de Pedify (/admin). Entra con su contraseña de siempre.`);
    } else {
      const password = initialPassword();
      const name = nameParts.join(" ").trim() || email.split("@")[0]!;
      await prisma.user.create({ data: { name, email, passwordHash: await hashPassword(password), isPlatformAdmin: true } });
      console.log(`Cuenta de administrador creada.\n  Correo: ${email}\n  Contraseña inicial: ${password}\nEntra en /login y cámbiala en Mi cuenta.`);
    }
  } else {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      console.error(`No existe una cuenta con el correo ${email}. Créala con npm run admin:create o regístrala en /registro.`);
      process.exitCode = 1;
    } else {
      await prisma.user.update({ where: { id: user.id }, data: { isPlatformAdmin: action === "grant" } });
      console.log(action === "grant" ? `${email} ahora es administrador de Pedify (/admin).` : `${email} ya no es administrador.`);
    }
  }
} finally {
  await prisma.$disconnect();
}
