// Avisos push de pedidos nuevos en este dispositivo (celular o computador), aunque el panel esté cerrado.
// El servidor envía el aviso con Web Push; public/sw.js lo muestra y abre el pedido al tocarlo.
import { api } from "./api.js";

const STORAGE_KEY = "pedify:push";

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

/** Avisa a las demás partes del panel (menú, Inicio, Configuración) que cambió el estado. */
function announce(state) {
  window.dispatchEvent(new CustomEvent("pedify:push", { detail: state }));
}

function remember(on) {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, "on");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Sin almacenamiento: solo afecta el aviso duplicado con la pestaña abierta.
  }
}

/** ¿Este dispositivo ya recibe avisos push? (para no mostrar dos avisos del mismo pedido). */
export function pushRemembered() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

let serverConfig = null;
async function config() {
  serverConfig ??= await api("/push/public-key");
  return serverConfig;
}

/**
 * Estado de los avisos en este dispositivo:
 *   "on" · "off" · "denied" (bloqueados en el navegador) · "ios-install" (en iPhone hay que agregar
 *   Pedify a la pantalla de inicio) · "insecure" (solo funcionan con https) · "unsupported" · "disabled" (el servidor no los tiene).
 */
export async function pushState() {
  if (isIOS() && !isStandalone()) return "ios-install";
  if (!window.isSecureContext) return "insecure";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  const { enabled } = await config();
  if (!enabled) return "disabled";
  if (Notification.permission === "denied") return "denied";
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription && Notification.permission === "granted") {
    remember(true);
    return "on";
  }
  remember(false);
  return "off";
}

function keyToBytes(base64url) {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

/** Pide permiso, registra el service worker, crea la suscripción y la guarda en el servidor. */
export async function enablePush() {
  const { enabled, publicKey } = await config();
  if (!enabled) throw new Error("Los avisos push no están disponibles en este servidor.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied" ? "Bloqueaste los avisos. Actívalos en la configuración del navegador para este sitio." : "No diste permiso para los avisos.");
  }
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
    } catch {
      // El navegador no pudo conectarse a su servicio de avisos (sin internet, modo privado o bloqueado).
      throw new Error("Este navegador no pudo activar los avisos. Revisa tu conexión e intenta de nuevo, o prueba con Chrome.");
    }
  }
  const json = subscription.toJSON();
  await api("/push/subscriptions", { method: "POST", body: { endpoint: json.endpoint, keys: json.keys } });
  remember(true);
  announce("on");
}

/** Deja de recibir avisos en este dispositivo (también se usa al cerrar sesión). */
export async function disablePush() {
  remember(false);
  announce("off");
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await api("/push/subscriptions", { method: "DELETE", body: { endpoint: subscription.endpoint } }).catch(() => {});
  await subscription.unsubscribe().catch(() => {});
}

export function sendTestPush() {
  return api("/push/test", { method: "POST" });
}

/** Textos para cada estado (botón y explicación). */
export const PUSH_COPY = {
  on: { button: "Avisos activados en este dispositivo", hint: "Te llega un aviso con cada pedido nuevo, aunque cierres el panel." },
  off: { button: "Activar avisos en este dispositivo", hint: "Recibe cada pedido nuevo en este celular o computador, aunque cierres el panel." },
  denied: { button: "Avisos bloqueados", hint: "Los bloqueaste en este navegador. Actívalos en la configuración del sitio (candado junto a la dirección)." },
  "ios-install": { button: "Avisos en iPhone", hint: "En iPhone, toca Compartir → «Agregar a pantalla de inicio», abre Pedify desde ese ícono y activa los avisos ahí." },
  insecure: { button: "Avisos no disponibles", hint: "Los avisos solo funcionan con la dirección segura (https) de Pedify." },
  unsupported: { button: "Avisos no disponibles", hint: "Este navegador no permite avisos. Prueba con Chrome, Edge, Firefox o Safari actualizados." },
  disabled: { button: "Avisos no configurados", hint: "El equipo de Pedify aún no activó los avisos en este servidor." },
};
