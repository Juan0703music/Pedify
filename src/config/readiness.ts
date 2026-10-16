import { env as currentEnv } from "./env.js";

type Env = typeof currentEnv;

/**
 * Lo que falta configurar para operar en producción (sección 15 del documento: secretos, HTTPS,
 * almacenamiento externo, correo y monitoreo). No impide arrancar: se registra al iniciar
 * y el panel central lo muestra al equipo de PedifyAI.
 */
export function productionWarnings(env: Env = currentEnv): string[] {
  const warnings: string[] = [];
  if (!env.APP_URL.startsWith("https://")) warnings.push("APP_URL no usa HTTPS.");
  if (!env.COOKIE_SECURE) warnings.push("COOKIE_SECURE=false: la cookie de sesión puede viajar sin HTTPS.");
  if (env.COOKIE_SECURE && env.TRUST_PROXY === 0) {
    warnings.push("TRUST_PROXY=0 detrás de un proxy: todos los visitantes comparten el mismo límite de solicitudes (usa TRUST_PROXY=1).");
  }
  if (env.STORAGE_DRIVER === "local") warnings.push("Las fotos se guardan en el disco del servidor; el documento pide almacenamiento externo (STORAGE_DRIVER=s3).");
  if (!env.SMTP_URL) warnings.push("Sin SMTP_URL no se envían los correos para recuperar la contraseña.");
  if (!env.SUPPORT_WHATSAPP) warnings.push("Sin SUPPORT_WHATSAPP, «Mi plan» no muestra el WhatsApp para pagar el plan.");
  if (!env.METRICS_TOKEN) warnings.push("Sin METRICS_TOKEN no hay métricas en /metrics.");
  return warnings;
}
