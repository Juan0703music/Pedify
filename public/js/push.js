// Avisos push en este dispositivo (celular o computador), aunque el panel esté cerrado: los pedidos nuevos
// del negocio y, para los administradores de Pedify, los pagos de los planes por revisar. El servidor envía
// el aviso con Web Push; public/sw.js lo muestra y abre la página al tocarlo.
import { api } from "./api.js";

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

/** Avisos que comparten la suscripción del navegador (una por dispositivo): se recuerda cuáles están activos. */
const CHANNEL_KEYS = ["pedify:push", "pedify:push-admin"];

const remembered = (key) => {
  try {
    return localStorage.getItem(key) === "on";
  } catch {
    return false;
  }
};

function keyToBytes(base64url) {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

/**
 * Un tipo de avisos: `base` es la ruta de la API (`/push` del negocio o `/admin/push`), `config` la que
 * da la llave pública, `storageKey` dónde se recuerda en este dispositivo y `event` el evento que avisa
 * del cambio a las demás partes de la página. `strict`: solo cuenta como activo si se activó aquí
 * (la suscripción del navegador puede existir por el otro tipo de avisos).
 */
function pushChannel({ base, config: configPath, storageKey, event, strict = false }) {
  const announce = (state) => window.dispatchEvent(new CustomEvent(event, { detail: state }));
  const remember = (on) => {
    try {
      if (on) localStorage.setItem(storageKey, "on");
      else localStorage.removeItem(storageKey);
    } catch {
      // Sin almacenamiento: solo afecta el aviso duplicado con la pestaña abierta.
    }
  };

  let serverConfig = null;
  const config = async () => (serverConfig ??= await api(configPath));

  return {
    /** ¿Este dispositivo ya recibe estos avisos? */
    remembered: () => remembered(storageKey),

    /**
     * Estado de los avisos en este dispositivo:
     *   "on" · "off" · "denied" (bloqueados en el navegador) · "ios-install" (en iPhone hay que agregar
     *   Pedify a la pantalla de inicio) · "insecure" (solo funcionan con https) · "unsupported" · "disabled" (el servidor no los tiene).
     */
    async state() {
      if (isIOS() && !isStandalone()) return "ios-install";
      if (!window.isSecureContext) return "insecure";
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
      const { enabled } = await config();
      if (!enabled) return "disabled";
      if (Notification.permission === "denied") return "denied";
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription && Notification.permission === "granted" && (!strict || remembered(storageKey))) {
        remember(true);
        return "on";
      }
      remember(false);
      return "off";
    },

    /** Pide permiso, registra el service worker, crea la suscripción y la guarda en el servidor. */
    async enable() {
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
      await api(`${base}/subscriptions`, { method: "POST", body: { endpoint: json.endpoint, keys: json.keys } });
      remember(true);
      announce("on");
    },

    /** Deja de recibir estos avisos en este dispositivo (también se usa al cerrar sesión). */
    async disable() {
      remember(false);
      announce("off");
      if (!("serviceWorker" in navigator)) return;
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return;
      await api(`${base}/subscriptions`, { method: "DELETE", body: { endpoint: subscription.endpoint } }).catch(() => {});
      // La suscripción del navegador se borra solo si ningún otro tipo de avisos la usa en este dispositivo.
      if (!CHANNEL_KEYS.some((key) => key !== storageKey && remembered(key))) await subscription.unsubscribe().catch(() => {});
    },

    test: () => api(`${base}/test`, { method: "POST" }),
  };
}

/** Pedidos nuevos del negocio (panel del comerciante). */
const panelPush = pushChannel({ base: "/push", config: "/push/public-key", storageKey: "pedify:push", event: "pedify:push" });
/** Pagos de los planes por revisar (panel central de Pedify). */
export const adminPush = pushChannel({ base: "/admin/push", config: "/admin/push", storageKey: "pedify:push-admin", event: "pedify:push-admin", strict: true });

/** ¿Este dispositivo ya recibe avisos push? (para no mostrar dos avisos del mismo pedido). */
export const pushRemembered = panelPush.remembered;
export const pushState = panelPush.state;
export const enablePush = panelPush.enable;
export const disablePush = panelPush.disable;
export const sendTestPush = panelPush.test;

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
