import argon2 from "argon2";

/**
 * Contraseñas con Argon2id (parámetros mínimos recomendados por OWASP:
 * 19 MiB de memoria, 2 iteraciones, 1 hilo). Nunca se guarda la contraseña.
 */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// Hash de relleno: al iniciar sesión con un correo inexistente se verifica igual
// para que el tiempo de respuesta no revele qué correos tienen cuenta.
let dummyHash: Promise<string> | undefined;

export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("pedifyai-contraseña-de-relleno");
  await verifyPassword(await dummyHash, password);
  return false;
}
