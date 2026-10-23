// Pedify como app en el celular y en el computador (aplicación web instalable, PWA).
// Chrome, Edge y Samsung Internet la instalan con un botón (Android, Windows, Mac y Linux); en iPhone se
// agrega desde Compartir → «Agregar a inicio». Instalada abre en su propia ventana, con su ícono, y usa
// la misma cuenta: los pedidos, el menú y el plan se ven en vivo en todos los dispositivos a la vez.
import { html, icon, raw, render, toast } from "./ui.js";

let deferredPrompt = null;

const userAgent = navigator.userAgent;
export const isIOS = () => /iphone|ipad|ipod/i.test(userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = () => /android/i.test(userAgent);
const isFirefox = () => /firefox|fxios/i.test(userAgent);
const isMacSafari = () => /macintosh/i.test(userAgent) && /safari/i.test(userAgent) && !/chrome|chromium|edg|firefox/i.test(userAgent);

/** ¿Es un celular o una tableta? (para hablar de «este celular» o «este computador»). */
export const isPhone = () => isIOS() || isAndroid();

/** ¿Pedify está abierta como app instalada (su propia ventana) y no en una pestaña del navegador? */
export const isInstalled = () =>
  matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: window-controls-overlay)").matches || navigator.standalone === true;

/**
 * Cómo se instala en este dispositivo:
 *   "installed" · "ready" (el navegador ofrece instalarla con un botón) · "ios" · "mac-safari" ·
 *   "android-menu" · "desktop-menu" (desde el menú del navegador) · "other-browser" (Firefox en
 *   computador: hay que abrirla en Chrome o Edge) · "insecure" (solo se instala con https).
 */
export function installState() {
  if (isInstalled()) return "installed";
  if (deferredPrompt) return "ready";
  if (isIOS()) return "ios";
  if (!window.isSecureContext) return "insecure";
  if (isAndroid()) return "android-menu";
  if (isMacSafari()) return "mac-safari";
  if (isFirefox()) return "other-browser";
  return "desktop-menu";
}

function announce() {
  window.dispatchEvent(new CustomEvent("pedify:install", { detail: installState() }));
}

// El navegador avisa que se puede instalar: se guarda para ofrecerlo con el botón de Pedify.
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  announce();
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  announce();
  toast("Listo: Pedify quedó instalada. Ábrela desde su ícono.");
});

// El service worker muestra los avisos push y una pantalla propia cuando no hay internet; también es
// requisito para instalar la app.
if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
}

/** Pasos para instalarla a mano en cada tipo de dispositivo. */
const HELP = {
  ios: {
    title: "Instálala en tu iPhone",
    steps: [
      ["share", "Abre esta página en Safari y toca <strong>Compartir</strong> (el cuadro con la flecha hacia arriba)."],
      ["square-plus", "Busca y toca <strong>Agregar a inicio</strong>. Si no aparece, toca «Editar acciones» y agrégala."],
      ["smartphone", "Abre <strong>Pedify</strong> desde el ícono nuevo e inicia sesión. Ahí puedes activar los avisos de pedidos."],
    ],
  },
  "android-menu": {
    title: "Instálala en tu celular Android",
    steps: [
      ["ellipsis-vertical", "Abre esta página en <strong>Chrome</strong> y toca el menú <strong>⋮</strong> (arriba a la derecha)."],
      ["download", "Toca <strong>Instalar app</strong> o <strong>Agregar a la pantalla principal</strong>."],
      ["smartphone", "Abre <strong>Pedify</strong> desde el ícono nuevo. Tus pedidos llegan en vivo, igual que en el computador."],
    ],
  },
  "desktop-menu": {
    title: "Instálala en tu computador",
    steps: [
      ["monitor-down", "En <strong>Chrome</strong> o <strong>Edge</strong>, toca el ícono de instalar al final de la barra de direcciones."],
      ["ellipsis-vertical", "Si no lo ves: menú <strong>⋮</strong> → <strong>Transmitir, guardar y compartir</strong> → <strong>Instalar Pedify</strong> (en Edge: Aplicaciones → Instalar)."],
      ["laptop", "Pedify abre en su propia ventana y queda en el escritorio y la barra de tareas."],
    ],
  },
  "mac-safari": {
    title: "Instálala en tu Mac",
    steps: [
      ["share", "En Safari, abre el menú <strong>Archivo</strong> o toca <strong>Compartir</strong>."],
      ["square-plus", "Elige <strong>Agregar al Dock</strong>."],
      ["laptop", "Pedify abre en su propia ventana desde el Dock."],
    ],
  },
  "other-browser": {
    title: "Instálala desde Chrome o Edge",
    steps: [
      ["monitor-down", "Este navegador no instala apps web. Abre <strong>Pedify</strong> en <strong>Google Chrome</strong> o <strong>Microsoft Edge</strong>."],
      ["download", "Toca el ícono de instalar al final de la barra de direcciones."],
      ["laptop", "Pedify abre en su propia ventana y queda en el escritorio."],
    ],
  },
  insecure: {
    title: "Se instala desde la dirección segura",
    steps: [["lock", "La app solo se instala desde la dirección segura de Pedify (la que empieza por <strong>https://</strong>)."]],
  },
};

export const installHelp = (state) => HELP[state] ?? HELP["desktop-menu"];

/** Lista de pasos con su ícono (en la hoja de ayuda y en la página /app). */
export function installSteps(state, { onInk = false } = {}) {
  return html`<ol class="grid gap-3">
    ${installHelp(state).steps.map(
      ([name, text], index) => html`<li class="flex items-start gap-3">
        <span class="grid h-9 w-9 flex-none place-items-center rounded-full ${onInk ? "bg-ink-3 text-mustard" : "bg-mustard-soft text-ink"}" aria-hidden="true">${icon(name, "h-[18px] w-[18px]")}</span>
        <span class="pt-1.5 text-[0.9375rem] leading-snug"><span class="sr-only">Paso ${index + 1}: </span>${raw(text)}</span>
      </li>`,
    )}
  </ol>`;
}

/** Hoja con los pasos para instalarla a mano (cuando el navegador no ofrece el botón). */
export function openInstallHelp(state = installState()) {
  const dialog = document.createElement("dialog");
  dialog.className = "sheet";
  dialog.setAttribute("aria-labelledby", "install-help-title");
  render(
    dialog,
    html`<header class="flex items-center justify-between gap-3 border-b border-line py-3 pr-3 pl-5">
        <h2 id="install-help-title" class="text-lg font-[760] outline-none" tabindex="-1">${installHelp(state).title}</h2>
        <button type="button" class="btn btn-quiet btn-icon" data-close aria-label="Cerrar">${icon("x")}</button>
      </header>
      <div class="grid min-h-0 flex-auto gap-4 overflow-y-auto px-5 py-5">
        ${installSteps(state)}
        <p class="rounded-[10px] bg-ground px-3.5 py-2.5 text-sm text-muted">Es gratis y no ocupa espacio: siempre abre la versión más nueva de Pedify.</p>
      </div>
      <footer class="border-t border-line px-5 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))]">
        <button type="button" class="btn btn-ink w-full" data-close>Entendido</button>
      </footer>`,
  );
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target.closest("[data-close]")) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector("h2").focus();
}

/**
 * Instala la app: con el botón del navegador si lo ofrece y, si no, muestra los pasos.
 * @returns {Promise<boolean>} true si quedó instalada.
 */
export async function installApp() {
  if (!deferredPrompt) {
    openInstallHelp();
    return false;
  }
  const prompt = deferredPrompt;
  deferredPrompt = null;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  announce();
  return outcome === "accepted";
}

/** «Instalar en este celular» / «Instalar en este computador». */
export const installLabel = () => (isPhone() ? "Instalar en este celular" : "Instalar en este computador");
