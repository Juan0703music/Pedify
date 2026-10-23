// Cliente de la API de Pedify. La sesión viaja en una cookie httpOnly:
// el navegador la envía sola y el JavaScript nunca la ve.

/**
 * Identifica esta pestaña ante el servidor (cabecera X-Pedify-Client). Cuando la pestaña cambia el menú o
 * la tienda, el servidor avisa a los demás dispositivos del negocio y esta sabe que el aviso es suyo.
 */
export const CLIENT_ID = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export class ApiError extends Error {
  constructor(status, code, message, fields = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/**
 * Llama a /api/v1<path> y devuelve `data`. Lanza ApiError con el mensaje del servidor.
 * @param {string} path
 * @param {{ method?: string, body?: unknown, signal?: AbortSignal }} [options]
 */
export async function api(path, { method = "GET", body, signal } = {}) {
  return request(path, {
    method,
    headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
}

/**
 * Sube un archivo (foto) como cuerpo binario a /api/v1<path> y devuelve `data`.
 * El servidor valida y vuelve a codificar la imagen; el tipo del archivo es solo orientativo.
 * @param {string} path
 * @param {Blob} file
 */
export async function upload(path, file) {
  return request(path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
}

async function request(path, init) {
  let response;
  try {
    response = await fetch(`/api/v1${path}`, { credentials: "same-origin", ...init, headers: { ...init.headers, "X-Pedify-Client": CLIENT_ID } });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ApiError(0, "NETWORK_ERROR", "Sin conexión. Revisa tu internet e intenta de nuevo.");
  }

  if (response.status === 204) return null;

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Respuesta sin JSON (p. ej. un proxy caído).
  }

  if (!response.ok) {
    const error = payload?.error ?? {};
    let message = error.message ?? "No pudimos completar la solicitud. Intenta de nuevo.";
    // Errores del servidor: un código corto para que soporte encuentre el problema en los registros.
    if (response.status >= 500 && error.requestId) message += ` Código de soporte: ${String(error.requestId).slice(0, 8)}.`;
    throw new ApiError(response.status, error.code ?? "UNKNOWN_ERROR", message, error.fields ?? error.details?.fields ?? {});
  }
  return payload?.data;
}

/** Lleva al inicio de sesión y vuelve a esta página después. */
export function redirectToLogin() {
  const next = location.pathname + location.search + location.hash;
  location.replace(`/login?next=${encodeURIComponent(next)}`);
}

/** 18000 → "$18.000" (solo para mostrar; los cálculos los hace el servidor). */
export function formatCOP(value) {
  const sign = value < 0 ? "-" : "";
  const digits = Math.abs(Math.trunc(value)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}$${digits}`;
}

/** Pesos sin el signo: 18000 → "18.000" (campos de dinero). */
export const formatThousands = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** "18.000" → 18000 */
export function parseMoney(text) {
  const digits = String(text).replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

/** "573001234567" → "300 123 4567" */
export function formatPhone(normalized) {
  if (!normalized) return "";
  const national = normalized.startsWith("57") ? normalized.slice(2) : normalized;
  return national.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1 $2 $3");
}

/** Aproximación local del slug (el servidor decide el definitivo y garantiza que sea único). */
export function slugify(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " y ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
}
