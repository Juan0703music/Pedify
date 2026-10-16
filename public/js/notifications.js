// Pedidos en vivo en el panel (sección 7 del documento): Socket.IO, sonido de alerta,
// notificación visual y actualización de listas. Socket.IO solo avisa: cada pantalla vuelve
// a consultar la API al recibir un evento o al reconectarse (PostgreSQL es la fuente de verdad).
import { io } from "/socket.io/socket.io.esm.min.js";
import { formatCOP } from "./api.js";
import { escapeHtml, icon } from "./ui.js";

const SOUND_KEY = "pedify:sound";

const listeners = { created: new Set(), updated: new Set(), resync: new Set(), status: new Set() };
let socket = null;
let audio = null;
let connection = "connecting";

function preference() {
  try {
    return localStorage.getItem(SOUND_KEY);
  } catch {
    return null;
  }
}

function savePreference(value) {
  try {
    localStorage.setItem(SOUND_KEY, value);
  } catch {
    // Sin almacenamiento: el sonido queda activo solo en esta pestaña.
  }
}

// ───────────────────────────── Sonido ─────────────────────────────
// Los navegadores bloquean el audio automático: se activa con un clic del usuario.

export function soundReady() {
  return audio?.state === "running";
}

export function soundWanted() {
  return preference() === "on";
}

/** Activa el sonido (debe llamarse desde un clic) y pide permiso para avisos del sistema. */
export async function enableSound() {
  audio ??= new AudioContext();
  await audio.resume();
  savePreference("on");
  playChime();
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
  emit("status", connection);
}

export function disableSound() {
  savePreference("off");
  audio?.suspend();
  emit("status", connection);
}

/** Dos tonos cortos ("ding-dong") generados con Web Audio: no requiere archivos de sonido. */
export function playChime() {
  if (!soundReady()) return;
  const now = audio.currentTime;
  [
    [880, 0],
    [1318.5, 0.18],
  ].forEach(([frequency, delay]) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + delay);
    gain.gain.exponentialRampToValueAtTime(0.35, now + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.45);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(now + delay);
    oscillator.stop(now + delay + 0.5);
  });
}

/** Si el comerciante ya había activado el sonido, se reanuda con su primera interacción en la página. */
function resumeOnFirstGesture() {
  if (!soundWanted()) return;
  const resume = () => {
    audio ??= new AudioContext();
    audio.resume().then(() => emit("status", connection));
  };
  window.addEventListener("pointerdown", resume, { once: true, capture: true });
  window.addEventListener("keydown", resume, { once: true, capture: true });
}

// ───────────────────────────── Aviso visual ─────────────────────────────

let alertRegion;

function showOrderAlert(order) {
  if (!alertRegion) {
    alertRegion = document.createElement("div");
    alertRegion.className = "pointer-events-none fixed inset-x-0 top-3 z-50 grid justify-items-center gap-2 px-3 lg:top-5";
    alertRegion.setAttribute("role", "alert");
    document.body.append(alertRegion);
  }
  const card = document.createElement("a");
  card.href = "/panel/pedidos";
  card.className =
    "ticket ticket-shadow print-in pointer-events-auto flex w-full max-w-[24rem] items-center gap-3 px-4 pt-3.5 text-ink no-underline";
  card.innerHTML = `
    <span class="grid h-11 w-11 flex-none place-items-center rounded-full bg-mustard">${icon("bell-ring", "h-5 w-5")}</span>
    <span class="min-w-0 flex-1">
      <span class="block text-[0.8125rem] font-[650] text-muted">Nuevo pedido</span>
      <span class="display block text-[1.6rem]">#${escapeHtml(order.number)}</span>
      <span class="block truncate text-sm">${escapeHtml(order.customerName)} · <span class="num font-[700]">${formatCOP(order.total)}</span></span>
    </span>
    <span class="text-sm font-[700] underline">Ver</span>`;
  alertRegion.append(card);
  setTimeout(() => {
    card.classList.add("transition-opacity", "duration-300", "opacity-0");
    setTimeout(() => card.remove(), 320);
  }, 9000);
}

/** Aviso del sistema operativo si la pestaña no está a la vista y hay permiso. */
function systemNotification(order) {
  if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
  const notification = new Notification(`Nuevo pedido #${order.number}`, {
    body: `${order.customerName} · ${formatCOP(order.total)}`,
    icon: "/assets/icons/logo.svg",
    tag: `pedido-${order.orderId}`,
  });
  notification.onclick = () => {
    window.focus();
    location.assign("/panel/pedidos");
  };
}

// ───────────────────────────── Conexión ─────────────────────────────

function emit(event, payload) {
  listeners[event].forEach((listener) => {
    try {
      listener(payload);
    } catch (error) {
      console.error(error);
    }
  });
}

function setConnection(state) {
  connection = state;
  emit("status", state);
}

/** Conecta el panel a la sala de su negocio. Se llama una vez desde el shell del panel. */
export function connectLive() {
  if (socket) return socket;
  resumeOnFirstGesture();
  socket = io({ withCredentials: true, transports: ["websocket", "polling"] });

  socket.on("ready", () => {
    setConnection("online");
    // Al conectarse o reconectarse, cada pantalla vuelve a pedir los datos a la API.
    emit("resync");
  });
  socket.on("disconnect", () => setConnection("offline"));
  socket.on("connect_error", (error) => {
    if (error?.message === "UNAUTHORIZED") {
      socket.disconnect();
      setConnection("unauthorized");
    } else {
      setConnection("offline");
    }
  });

  socket.on("order:created", (order) => {
    playChime();
    showOrderAlert(order);
    systemNotification(order);
    emit("created", order);
  });
  socket.on("order:updated", (update) => emit("updated", update));

  // Volver a la pestaña después de un rato: se refrescan los datos.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) emit("resync");
  });
  return socket;
}

/**
 * Suscribe a eventos en vivo: "created" | "updated" | "resync" | "status".
 * Devuelve la función para cancelar la suscripción.
 */
export function onLive(event, listener) {
  listeners[event].add(listener);
  if (event === "status") listener(connection);
  return () => listeners[event].delete(listener);
}

export function liveStatus() {
  return connection;
}
