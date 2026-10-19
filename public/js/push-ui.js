// Interfaz de los avisos push del panel: tarjeta en Inicio, sección en Configuración y botón del menú.
import { disablePush, enablePush, pushState, PUSH_COPY, sendTestPush } from "./push.js";
import { html, icon, render, setBusy, toast } from "./ui.js";

const DISMISS_KEY = "pedify:push-card";
const UNAVAILABLE = new Set(["unsupported", "disabled", "insecure"]);

function cardDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "hidden";
  } catch {
    return false;
  }
}

/** Estado actual sin lanzar errores (sin conexión o API caída = no disponible). */
export async function safePushState() {
  try {
    return await pushState();
  } catch {
    return "unsupported";
  }
}

/**
 * Vista de los avisos:
 * - "card": tarjeta de Inicio para activarlos (se oculta si ya están activos, no se pueden o se descartó).
 * - "section": bloque de Configuración con activar, probar y desactivar.
 */
export function pushView(state, variant = "card") {
  const copy = PUSH_COPY[state] ?? PUSH_COPY.unsupported;
  if (variant === "card") {
    if (state === "on" || UNAVAILABLE.has(state) || cardDismissed()) return "";
    return html`<section class="relative overflow-hidden rounded-[18px] bg-ink p-5 text-paper sm:flex sm:items-center sm:gap-6" data-push aria-labelledby="push-card-title">
      <div class="dots-mustard pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden="true"></div>
      <div class="relative flex items-start gap-4 sm:flex-1 sm:items-center">
        <span class="bell-ring grid h-11 w-11 flex-none place-items-center rounded-full bg-mustard text-ink">${icon("bell-ring", "h-5 w-5")}</span>
        <div class="grid gap-1.5">
          <h2 id="push-card-title" class="text-[1.125rem] leading-tight font-[780]">Que ningún pedido se te pase</h2>
          <p class="text-[0.9375rem] text-paper/75">${copy.hint}</p>
        </div>
      </div>
      <div class="relative mt-4 flex flex-wrap gap-2 sm:mt-0 sm:flex-none">
        ${state === "off" ? html`<button type="button" class="btn btn-primary" data-push-enable>${icon("smartphone")} Activar avisos</button>` : ""}
        <button type="button" class="btn btn-quiet text-paper hover:bg-ink-3" data-push-dismiss>Ahora no</button>
      </div>
    </section>`;
  }
  const on = state === "on";
  return html`<div class="grid gap-3 rounded-[12px] border border-line p-4" data-push>
    <div class="flex items-start gap-3">
      <span class="grid h-10 w-10 flex-none place-items-center rounded-full ${on ? "bg-leaf-soft text-leaf" : "bg-ground text-muted"}">${icon(on ? "bell-ring" : "bell-off")}</span>
      <div class="grid gap-0.5">
        <p class="font-[700]">${copy.button}</p>
        <p class="text-sm text-muted">${copy.hint}</p>
      </div>
    </div>
    <div class="flex flex-wrap gap-2">
      ${state === "off" ? html`<button type="button" class="btn btn-ink btn-sm" data-push-enable>${icon("smartphone", "h-4 w-4")} Activar en este dispositivo</button>` : ""}
      ${on
        ? html`<button type="button" class="btn btn-ghost btn-sm" data-push-test>${icon("bell-ring", "h-4 w-4")} Enviar un aviso de prueba</button>
            <button type="button" class="btn btn-quiet btn-sm text-tomato" data-push-disable>Desactivar en este dispositivo</button>`
        : ""}
    </div>
    <p class="text-xs text-muted">Actívalos en cada celular o computador donde quieras recibir los pedidos. Cada persona del equipo activa los suyos.</p>
  </div>`;
}

/** Ejecuta la acción del botón tocado y devuelve el estado nuevo (o null si el clic no era de avisos). */
export async function handlePushClick(event, state) {
  const button = event.target.closest("[data-push] button");
  if (!button) return null;
  if (button.matches("[data-push-dismiss]")) {
    try {
      localStorage.setItem(DISMISS_KEY, "hidden");
    } catch {
      // Sin almacenamiento: vuelve a aparecer en la próxima visita.
    }
    return state;
  }
  setBusy(button, true);
  try {
    if (button.matches("[data-push-enable]")) {
      await enablePush();
      toast("Listo: te avisaremos de cada pedido nuevo en este dispositivo.");
      return "on";
    }
    if (button.matches("[data-push-test]")) {
      const result = await sendTestPush();
      if (result.sent > 0) toast("Te enviamos un aviso de prueba. Debe llegarte en unos segundos.");
      else toast("No pudimos enviar el aviso. Desactiva y vuelve a activar los avisos.", "error");
      return state;
    }
    if (button.matches("[data-push-disable]")) {
      await disablePush();
      toast("Desactivaste los avisos en este dispositivo.", "info");
      return "off";
    }
  } catch (error) {
    toast(error.message, "error");
    return safePushState();
  } finally {
    setBusy(button, false);
  }
  return state;
}

/** Monta la vista y la mantiene al día (para páginas que no se redibujan completas). */
export async function mountPush(container, variant = "section") {
  let state = await safePushState();
  render(container, pushView(state, variant));
  window.addEventListener("pedify:push", (event) => {
    state = event.detail;
    render(container, pushView(state, variant));
  });
  container.addEventListener("click", async (event) => {
    const next = await handlePushClick(event, state);
    if (next === null) return;
    state = next;
    render(container, pushView(state, variant));
  });
}
