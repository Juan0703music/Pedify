// Panel del comerciante: estructura común (navegación, selector de negocio, sesión) y página de Inicio.
import { api, formatCOP, redirectToLogin } from "./api.js";
import { connectLive, disableSound, enableSound, onLive, soundWaitingForTouch, soundWanted } from "./notifications.js";
import { deliveryLabel, elapsedLabel, nextAction, statusBadge } from "./order-ui.js";
import { disablePush, enablePush, PUSH_COPY, sendTestPush } from "./push.js";
import { handlePushClick, pushView, safePushState } from "./push-ui.js";
import { openCourierLink } from "./courier-link.js";
import { installApp, installLabel, installState, isPhone } from "./install.js";
import { brand, copyText, formAlert, html, icon, initials, raw, readForm, render, setBusy, showErrors, toast } from "./ui.js";

/**
 * Navegación del panel (sección 6 del documento de arquitectura). `ownerOnly`: solo el propietario;
 * `permission`: el propietario y los empleados a quienes él les dio ese permiso.
 */
export const NAV = [
  { id: "inicio", label: "Inicio", href: "/panel", icon: "house" },
  { id: "pedidos", label: "Pedidos", href: "/panel/pedidos", icon: "receipt", live: true },
  { id: "menu", label: "Mi menú", href: "/panel/menu", icon: "utensils" },
  { id: "clientes", label: "Clientes", href: "/panel/clientes", icon: "users", permission: "viewCustomers" },
  { id: "analiticas", label: "Analíticas", href: "/panel/analiticas", icon: "chart-column", permission: "viewAnalytics" },
  { id: "tienda", label: "Mi tienda", href: "/panel/tienda", icon: "store" },
  { id: "configuracion", label: "Configuración", href: "/panel/configuracion", icon: "settings" },
];

export const ROLE_LABEL = { OWNER: "Propietario", EMPLOYEE: "Empleado" };

/** ¿La persona puede esto en el negocio activo? El propietario, siempre. (El servidor también lo verifica.) */
export function can(business, permission) {
  return business?.role === "OWNER" || Boolean(business?.permissions?.[permission]);
}

const TABS = ["inicio", "pedidos", "menu"];

// ─────────────────────────────── Estructura ───────────────────────────────

/** Contador de pedidos pendientes (se actualiza en vivo). */
const pendingBadge = (extra = "") =>
  html`<span class="badge num hidden bg-mustard px-2 text-ink ${extra}" data-pending-count aria-label="Pedidos pendientes"></span>`;

function navLinks(page, business) {
  const role = business?.role;
  return NAV.filter((item) => (!item.ownerOnly || role === "OWNER") && (!item.permission || can(business, item.permission))).map(
    (item) => html`<a class="nav-item" href="${item.href}" ${item.id === page ? raw('aria-current="page"') : ""}>
      ${icon(item.icon)}<span class="flex-1">${item.label}</span>${item.live ? pendingBadge() : ""}
    </a>`,
  );
}

/** Interruptor de alertas con sonido y estado de la conexión en vivo. */
function liveControl({ compact = false } = {}) {
  return compact
    ? html`<button type="button" class="btn btn-quiet btn-icon relative text-paper hover:bg-ink-3" data-sound-toggle aria-label="Alertas con sonido">
        <span data-sound-icon>${icon("bell-off")}</span>
        <span class="absolute top-2 right-2 h-2 w-2 rounded-full bg-ink-soft" data-live-dot aria-hidden="true"></span>
      </button>`
    : html`<div class="grid gap-0.5 rounded-[12px] bg-ink-2 py-1.5">
        <p class="flex items-center gap-3 px-3 pt-1 pb-1.5 text-xs font-[620] text-ink-soft">
          <span class="grid w-5 flex-none place-items-center" aria-hidden="true"><span class="h-2 w-2 rounded-full bg-ink-soft" data-live-dot></span></span>
          <span data-live-text>Conectando…</span>
        </p>
        <button type="button" class="live-row" data-sound-toggle>
          <span class="live-row-icon" data-sound-icon>${icon("bell-off")}</span><span class="min-w-0 flex-1 truncate text-left">Sonido de pedidos</span>
          <span class="live-state" data-sound-state>Activar</span>
        </button>
        <p class="hidden pr-3 pb-1 pl-11 text-xs leading-snug text-mustard" data-sound-hint>Toca cualquier parte de la página para que suene aquí.</p>
        ${pushButton()}
      </div>`;
}

/** Fila de avisos push en este dispositivo (bloque «En vivo» del menú lateral y del cajón del celular). */
function pushButton() {
  return html`<button type="button" class="live-row hidden" data-push-toggle>
    <span class="live-row-icon" data-push-icon>${icon("smartphone")}</span><span class="min-w-0 flex-1 truncate text-left">Avisos de pedidos</span>
    <span class="live-state" data-push-state>Activar</span>
  </button>`;
}

function tabLinks(page) {
  const tabs = TABS.map((id) => NAV.find((item) => item.id === id)).map((item) => {
    const label = item.id === "menu" ? "Menú" : item.label;
    return html`<a class="tab-item" href="${item.href}" ${item.id === page ? raw('aria-current="page"') : ""}>
      <span class="tab-pill relative">${icon(item.icon)}${item.live ? pendingBadge("absolute -top-1.5 -right-1 min-w-5 justify-center px-1.5 py-0") : ""}</span>${label}
    </a>`;
  });
  const moreActive = !TABS.includes(page);
  return html`${tabs}
    <button type="button" class="tab-item" data-open-drawer ${moreActive ? raw('aria-current="page"') : ""}>
      <span class="tab-pill">${icon("menu")}</span>Más
    </button>`;
}

function userBlock(me) {
  return html`<div class="flex items-center gap-3 rounded-[12px] bg-ink-2 p-2.5 pl-3">
    <span class="grid h-9 w-9 flex-none place-items-center rounded-full bg-ink-3 text-sm font-bold" aria-hidden="true">
      ${initials(me.user.name)}
    </span>
    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm font-semibold">${me.user.name}</span>
      <span class="block truncate text-xs text-ink-soft">${me.user.email}</span>
    </span>
    <button type="button" class="btn btn-quiet btn-icon text-ink-soft hover:bg-ink-3 hover:text-paper" data-logout aria-label="Cerrar sesión" title="Cerrar sesión">
      ${icon("log-out")}
    </button>
  </div>`;
}

/**
 * «Crear otro negocio»: el formulario si el plan lo permite (con cuántos llevas) o el motivo si ya
 * llegaste al límite (Emprendedor: 1 negocio · Negocio: 3 · Empresa: ilimitados).
 */
function newBusinessBlock(me, business, id) {
  const limit = me.newBusiness;
  if (limit && !limit.allowed) {
    return html`<div class="mt-1 grid gap-2.5 border-t border-line px-3 pt-3 pb-2">
      <p class="flex items-start gap-2 text-sm text-muted">${icon("lock", "mt-0.5 h-4 w-4 flex-none")}<span>${limit.message}</span></p>
      ${business.role === "OWNER" ? html`<a class="btn btn-ink btn-sm w-fit" href="/panel/plan">Ver planes</a>` : ""}
    </div>`;
  }
  return html`<details class="group mt-1 border-t border-line pt-1">
    <summary class="flex cursor-pointer list-none items-center gap-3 rounded-[10px] px-3 py-2.5 font-semibold hover:bg-ground">
      ${icon("plus")} <span class="flex-1">Crear otro negocio</span>
      ${limit?.max ? html`<span class="num text-xs font-[600] text-muted" title="Negocios que tienes de los que permite tu plan">${limit.owned} de ${limit.max}</span>` : ""}
    </summary>
    <form class="grid gap-3 px-3 pt-2 pb-3" data-create-business novalidate>
      ${formAlert()}
      <div class="field">
        <label class="label" for="${id}-name">Nombre</label>
        <input class="input" id="${id}-name" name="name" required maxlength="80" />
      </div>
      <div class="field">
        <label class="label" for="${id}-phone">Celular</label>
        <input class="input" id="${id}-phone" name="phone" type="tel" inputmode="tel" placeholder="300 123 4567" required />
      </div>
      <button class="btn btn-ink w-full" type="submit">Crear negocio</button>
    </form>
  </details>`;
}

function businessSwitcher(me, business, id, { compact = false } = {}) {
  const others = me.businesses;
  return html`<button
      type="button"
      popovertarget="${id}"
      class="flex w-full min-w-0 items-center gap-3 rounded-[12px] ${compact ? "px-1 py-1" : "bg-ink-2 p-2.5 hover:bg-ink-3"} text-left transition-colors"
      aria-label="Negocio actual: ${business.name}. Cambiar de negocio"
    >
      ${business.logoUrl
        ? html`<img src="${business.logoUrl}" alt="" class="${compact ? "h-8 w-8" : "h-9 w-9"} flex-none rounded-[9px] bg-paper object-cover" data-business-logo />`
        : html`<span class="grid ${compact ? "h-8 w-8 text-xs" : "h-9 w-9 text-sm"} flex-none place-items-center rounded-[9px] bg-mustard font-[800] text-ink" aria-hidden="true">
            ${initials(business.name)}
          </span>`}
      <span class="min-w-0 flex-1">
        <span class="block truncate font-[680] ${compact ? "text-[0.9375rem]" : ""}" data-business-name>${business.name}</span>
        ${compact ? "" : html`<span class="block text-xs text-ink-soft">${ROLE_LABEL[business.role]}</span>`}
      </span>
      ${icon("chevrons-up-down", "text-ink-soft")}
    </button>
    <div popover id="${id}" class="business-popover w-[min(20rem,calc(100vw-2rem))] rounded-[14px] border border-line bg-paper p-2 text-ink shadow-[var(--shadow-pop)]">
      <p class="px-3 pt-2 pb-1.5 text-sm font-semibold text-muted">Tus negocios</p>
      <ul class="grid gap-0.5">
        ${others.map(
          (item) => html`<li>
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left hover:bg-ground"
              ${item.id === business.id ? raw('aria-current="true"') : html`data-switch="${item.id}"`}
            >
              <span class="grid h-8 w-8 flex-none place-items-center rounded-[8px] ${item.id === business.id ? "bg-mustard" : "bg-ground"} text-xs font-[800]" aria-hidden="true">
                ${initials(item.name)}
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate font-semibold">${item.name}</span>
                <span class="block text-xs text-muted">${ROLE_LABEL[item.role]}</span>
              </span>
              ${item.id === business.id ? icon("check") : ""}
            </button>
          </li>`,
        )}
      </ul>
      ${newBusinessBlock(me, business, id)}
    </div>`;
}

const shortDate = (value) =>
  new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", timeZone: "America/Bogota" }).format(new Date(value));

/** Aviso de la suscripción: prueba por terminar, plan vencido (con gracia) o tienda sin pedidos en línea. */
function planBanner(business) {
  const subscription = business?.subscription;
  if (!subscription) return "";
  const owner = business.role === "OWNER";
  const cta = (label) => (owner ? html`<a class="btn btn-ink btn-sm ml-auto" href="/panel/plan">${label}</a>` : "");
  const bar = (tone, iconName, text, action) => html`<div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 text-[0.9375rem] sm:px-6 lg:px-10 ${tone}" role="status">
    ${icon(iconName, "flex-none")}<p class="min-w-0 flex-1">${text}</p>${action}
  </div>`;

  if (subscription.status === "TRIAL" && subscription.daysLeft <= 5) {
    const when = subscription.daysLeft <= 1 ? "mañana" : `en ${subscription.daysLeft} días`;
    return bar("bg-mustard-soft text-mustard-deep", "clock", html`Tu prueba gratis termina <strong>${when}</strong>.`, cta("Ver planes"));
  }
  if (subscription.status === "PAST_DUE") {
    return bar(
      "bg-mustard text-ink",
      "circle-alert",
      html`Tu plan venció el ${shortDate(subscription.endsAt)}. Tu tienda recibe pedidos hasta el <strong>${shortDate(subscription.graceEndsAt)}</strong>.${owner ? "" : " Avísale al propietario."}`,
      cta("Renovar plan"),
    );
  }
  if (subscription.status === "EXPIRED") {
    return bar(
      "bg-tomato text-paper",
      "circle-alert",
      html`Tu tienda <strong>no está recibiendo pedidos en línea</strong> porque el plan venció.${owner ? "" : " Avísale al propietario del negocio."}`,
      owner ? html`<a class="btn btn-sm ml-auto border-paper bg-paper text-ink" href="/panel/plan">Renovar plan</a>` : "",
    );
  }
  return "";
}

const STATUS_TEXT = { TRIAL: "Prueba", ACTIVE: "Activo", PAST_DUE: "Vencido", EXPIRED: "Vencido" };

/** Plan en la barra lateral (propietario). */
function planLink(business) {
  const subscription = business?.subscription;
  if (!subscription || business.role !== "OWNER") return "";
  const detail =
    subscription.status === "TRIAL"
      ? `${subscription.daysLeft} ${subscription.daysLeft === 1 ? "día" : "días"} de prueba`
      : subscription.status === "ACTIVE"
        ? `hasta el ${shortDate(subscription.endsAt)}`
        : "renuévalo";
  return html`<a href="/panel/plan" class="flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm text-ink-soft no-underline hover:bg-ink-2 hover:text-paper">
    ${icon("receipt", "h-4 w-4")}
    <span class="min-w-0 flex-1 truncate">Plan ${subscription.planName} · ${detail}</span>
    <span class="badge ${subscription.status === "ACTIVE" || subscription.status === "TRIAL" ? "bg-ink-3 text-ink-soft" : "bg-tomato text-paper"}">${STATUS_TEXT[subscription.status]}</span>
  </a>`;
}

/** «Instalar la app» en el menú lateral y en el cajón (se oculta si ya abriste Pedify como app). */
function installLink() {
  return html`<button type="button" class="hidden w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-sm text-ink-soft hover:bg-ink-2 hover:text-paper" data-install-app>
    ${icon(isPhone() ? "smartphone" : "monitor-down", "h-4 w-4")}<span class="min-w-0 flex-1 truncate">Instalar la app</span>
  </button>`;
}

const INSTALLABLE = new Set(["ready", "ios", "android-menu", "desktop-menu", "mac-safari", "other-browser"]);

function paintInstall(root) {
  const available = INSTALLABLE.has(installState());
  root.querySelectorAll("button[data-install-app]").forEach((button) => {
    if (button.closest("[data-install-card]")) return;
    button.classList.toggle("hidden", !available);
    button.classList.toggle("flex", available);
  });
}

function adminLink(me) {
  return me.user.isPlatformAdmin
    ? html`<a href="/admin" class="flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm text-ink-soft no-underline hover:bg-ink-2 hover:text-paper">
        ${icon("shield", "h-4 w-4")} Panel de Pedify
      </a>`
    : "";
}

function shell(me, business, page) {
  const role = business?.role;
  return html`<div class="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
    <aside class="on-ink scroll-thin sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto bg-ink p-4 text-paper lg:flex">
      <a href="/panel" class="w-fit rounded-md px-2 pt-2 no-underline" aria-label="Pedify, inicio del panel">${brand({ onInk: true })}</a>
      ${business ? businessSwitcher(me, business, "business-menu") : ""}
      <nav aria-label="Secciones del panel" class="grid gap-1">${navLinks(page, business)}</nav>
      <div class="mt-auto grid grid-cols-[minmax(0,1fr)] gap-3">
        <div class="grid grid-cols-[minmax(0,1fr)] gap-0.5"><div class="contents" data-plan-link>${planLink(business)}</div> ${adminLink(me)} ${installLink()}</div>
        ${business ? liveControl() : ""} ${userBlock(me)}
      </div>
    </aside>

    <div class="flex min-w-0 flex-col">
      <header class="on-ink sticky top-0 z-30 flex items-center gap-2 bg-ink px-3 py-2.5 text-paper lg:hidden">
        <a href="/panel" class="flex-none rounded-md p-1" aria-label="Pedify, inicio del panel">
          <img src="/assets/icons/logo.svg" alt="" class="h-8 w-8" width="32" height="32" />
        </a>
        <div class="min-w-0 flex-1">${business ? businessSwitcher(me, business, "business-menu-mobile", { compact: true }) : ""}</div>
        ${business ? liveControl({ compact: true }) : ""}
      </header>

      <div data-plan-banner>${planBanner(business)}</div>
      <main id="main" tabindex="-1" class="mx-auto w-full max-w-[76rem] flex-1 px-4 pt-6 pb-[calc(6.5rem+env(safe-area-inset-bottom))] outline-none sm:px-6 lg:px-10 lg:pt-10 lg:pb-14"></main>
    </div>

    <nav aria-label="Secciones principales" class="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] lg:hidden">
      ${tabLinks(page)}
    </nav>

    <dialog id="drawer" class="on-ink drawer m-0 ml-auto h-dvh max-h-none w-[min(20rem,88vw)] bg-ink p-4 text-paper" aria-label="Menú del panel">
      <div class="flex h-full flex-col gap-6">
        <div class="flex items-center justify-between">
          ${brand({ onInk: true })}
          <button type="button" class="btn btn-quiet btn-icon text-paper hover:bg-ink-3" data-close-drawer aria-label="Cerrar menú">${icon("x")}</button>
        </div>
        <nav aria-label="Secciones del panel" class="grid gap-1">${navLinks(page, business)}</nav>
        <div class="mt-auto grid grid-cols-[minmax(0,1fr)] gap-3">
          <div class="grid grid-cols-[minmax(0,1fr)] gap-0.5"><div class="contents" data-plan-link>${planLink(business)}</div> ${adminLink(me)} ${installLink()}</div>
          ${business ? liveControl() : ""} ${userBlock(me)}
        </div>
      </div>
    </dialog>
  </div>`;
}

/** Ubica el menú emergente bajo su botón (el popover vive en la capa superior). */
function positionPopovers(root) {
  root.querySelectorAll(".business-popover").forEach((popover) => {
    popover.addEventListener("toggle", (event) => {
      if (event.newState !== "open") return;
      const anchor = root.querySelector(`[popovertarget="${popover.id}"]`);
      const rect = anchor.getBoundingClientRect();
      const width = popover.offsetWidth;
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      Object.assign(popover.style, { position: "fixed", inset: "auto", margin: "0", top: `${rect.bottom + 8}px`, left: `${left}px` });
    });
  });
}

function bindShell(root) {
  positionPopovers(root);
  const drawer = root.querySelector("#drawer");
  paintInstall(root);
  window.addEventListener("pedify:install", () => paintInstall(root));

  root.addEventListener("click", async (event) => {
    const target = event.target.closest("button");
    if (!target) return;

    if (target.matches("[data-open-drawer]")) drawer.showModal();
    if (target.matches("[data-close-drawer]")) drawer.close();
    if (target.matches("[data-install-app]")) {
      if (drawer.open) drawer.close();
      void installApp();
    }

    if (target.matches("[data-logout]")) {
      setBusy(target, true);
      try {
        // Este dispositivo deja de recibir avisos de pedidos de la cuenta (sin esperar más de 2 s).
        await Promise.race([disablePush().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 2000))]);
        await api("/auth/logout", { method: "POST" });
      } finally {
        location.assign("/login");
      }
    }

    if (target.matches("[data-switch]")) {
      setBusy(target, true);
      try {
        await api("/auth/switch-business", { method: "POST", body: { businessId: target.dataset.switch } });
        location.assign("/panel");
      } catch (error) {
        setBusy(target, false);
        toast(error.message, "error");
      }
    }
  });

  // Cerrar el cajón al tocar fuera del panel.
  drawer.addEventListener("click", (event) => {
    if (event.target === drawer) drawer.close();
  });

  // Delegado: también cubre el formulario de "sin negocio" que se dibuja después dentro de <main>.
  root.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-create-business]");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    setBusy(button, true);
    try {
      await api("/businesses", { method: "POST", body: readForm(form) });
      location.assign("/panel?bienvenida=1");
    } catch (error) {
      setBusy(button, false);
      showErrors(form, error);
    }
  });
}

/**
 * Carga la sesión y dibuja el panel. Si no hay sesión, envía al inicio de sesión.
 * @returns {Promise<{ me: any, business: any | null, main: HTMLElement } | null>}
 */
export async function initPanel(page) {
  const root = document.getElementById("app");
  let me;
  let business = null;
  try {
    me = await api("/auth/me");
    if (me.activeBusinessId) business = await api("/businesses/current");
  } catch (error) {
    if (error.status === 401) {
      redirectToLogin();
      return null;
    }
    render(root, fatalError(error));
    return null;
  }

  render(root, shell(me, business, page));
  bindShell(root);
  if (business) startLive(root);
  return { me, business, main: root.querySelector("#main") };
}

// ─────────────────────────────── En vivo ───────────────────────────────

const LIVE_TEXT = { online: "En vivo", connecting: "Conectando…", offline: "Reconectando…", unauthorized: "Sesión vencida" };
const LIVE_DOT = { online: "bg-leaf", connecting: "bg-ink-soft", offline: "bg-mustard", unauthorized: "bg-tomato" };
const baseTitle = document.title;

function paintLive(root, status) {
  root.querySelectorAll("[data-live-dot]").forEach((dot) => {
    dot.className = dot.className.replace(/bg-(leaf|ink-soft|mustard|tomato)/g, "") + " " + LIVE_DOT[status];
  });
  root.querySelectorAll("[data-live-text]").forEach((text) => (text.textContent = LIVE_TEXT[status]));
  // El botón muestra lo que la persona eligió (se guarda en el dispositivo para todas las secciones).
  const on = soundWanted();
  const waiting = soundWaitingForTouch();
  root.querySelectorAll("[data-sound-toggle]").forEach((button) => {
    button.setAttribute("aria-pressed", String(on));
    button.title = !on ? "Activar sonido de pedidos" : waiting ? "Sonido activado: toca la página una vez para que suene aquí" : "Sonido de pedidos activado";
    const iconSlot = button.querySelector("[data-sound-icon]");
    if (iconSlot) iconSlot.innerHTML = String(icon(on ? "bell-ring" : "bell-off", on ? "text-mustard" : ""));
    const pill = button.querySelector("[data-sound-state]");
    if (pill) pill.textContent = on ? "Activo" : "Activar";
  });
  root.querySelectorAll("[data-sound-hint]").forEach((hint) => {
    hint.classList.toggle("hidden", !waiting);
  });
}

/** Cantidad de pedidos pendientes: insignia en la navegación y en el título de la pestaña. */
async function refreshPendingCount(root) {
  try {
    const { items } = await api("/orders");
    const pending = items.filter((order) => order.status === "PENDING").length;
    root.querySelectorAll("[data-pending-count]").forEach((badge) => {
      badge.textContent = String(pending);
      badge.classList.toggle("hidden", pending === 0);
      badge.classList.toggle("inline-flex", pending > 0);
    });
    document.title = pending > 0 ? `(${pending}) ${baseTitle}` : baseTitle;
  } catch {
    // Sin conexión: se reintenta en el siguiente evento.
  }
}

/** Estado del botón de avisos push: "Activar" o "activados" (un toque envía una prueba). */
function paintPush(root, state) {
  const available = !["unsupported", "disabled", "insecure"].includes(state);
  root.querySelectorAll("[data-push-toggle]").forEach((button) => {
    button.classList.toggle("hidden", !available);
    button.classList.toggle("flex", available);
    const on = state === "on";
    button.setAttribute("aria-pressed", String(on));
    button.title = PUSH_COPY[state]?.hint ?? "";
    button.querySelector("[data-push-icon]").innerHTML = String(icon("smartphone", on ? "text-mustard" : ""));
    // Bloqueados o en iPhone sin instalar: el toque explica qué hacer.
    button.querySelector("[data-push-state]").textContent = on ? "Activo" : state === "off" ? "Activar" : state === "denied" ? "Bloqueados" : "Ver cómo";
    button.toggleAttribute("data-muted", !on && state !== "off");
  });
}

async function startPush(root) {
  let state = await safePushState();
  paintPush(root, state);
  root.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-push-toggle]");
    if (!button) return;
    setBusy(button, true);
    try {
      if (state === "on") {
        const result = await sendTestPush();
        toast(result.sent > 0 ? "Los avisos están activos. Te enviamos uno de prueba." : "No pudimos enviar el aviso. Vuelve a activarlos.", result.sent > 0 ? "success" : "error");
      } else if (state === "off") {
        await enablePush();
        state = "on";
        toast("Listo: te avisaremos de cada pedido nuevo en este dispositivo.");
      } else {
        toast(PUSH_COPY[state]?.hint ?? "Los avisos no están disponibles aquí.", "info");
      }
    } catch (error) {
      toast(error.message, "error");
      state = await safePushState();
    } finally {
      setBusy(button, false);
      paintPush(root, state);
    }
  });
  // La tarjeta de Inicio o Configuración también activan y desactivan.
  window.addEventListener("pedify:push", (event) => {
    state = event.detail;
    paintPush(root, state);
  });
  // Permisos cambiados en el navegador: se vuelve a leer al volver a la pestaña.
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) return;
    state = await safePushState();
    paintPush(root, state);
  });
}

/**
 * El plan o los datos del negocio cambiaron en otro dispositivo (o Wompi aprobó un pago): se
 * actualizan el aviso del plan, el plan del menú lateral y el nombre y logo del negocio.
 */
async function refreshBusiness(root) {
  let business;
  try {
    business = await api("/businesses/current");
  } catch {
    return; // Sin conexión: al reconectarse, cada pantalla vuelve a consultar.
  }
  root.querySelectorAll("[data-plan-banner]").forEach((slot) => render(slot, planBanner(business)));
  root.querySelectorAll("[data-plan-link]").forEach((slot) => render(slot, planLink(business)));
  root.querySelectorAll("[data-business-name]").forEach((name) => (name.textContent = business.name));
  root.querySelectorAll("[data-business-logo]").forEach((logo) => business.logoUrl && (logo.src = business.logoUrl));
}

function startLive(root) {
  connectLive();
  void startPush(root);
  onLive("changed", ({ scope }) => {
    if (scope === "subscription" || scope === "business") void refreshBusiness(root);
  });
  let liveState = "connecting";
  onLive("status", (status) => {
    liveState = status;
    paintLive(root, status);
  });
  const refresh = () => refreshPendingCount(root);
  onLive("resync", refresh);
  onLive("created", refresh);
  onLive("updated", refresh);
  refresh();

  root.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-sound-toggle]");
    if (!button) return;
    // Se decide por lo que eligió la persona, no por si el navegador ya dejó sonar esta página.
    if (soundWanted()) {
      disableSound();
      toast("Sonido de pedidos desactivado.", "info");
    } else {
      try {
        await enableSound();
        toast("Listo: sonará una alerta con cada pedido nuevo.");
      } catch {
        toast("Tu navegador no permitió activar el sonido.", "error");
      }
    }
    paintLive(root, liveState);
  });
}

/**
 * Aviso de que otro dispositivo guardó cambios en esta sección, con un botón para verlos. Se usa donde
 * redibujar solo podría borrar lo que la persona está escribiendo (p. ej. Configuración).
 */
export function showChangedElsewhere(text = "Se guardaron cambios desde otro dispositivo.") {
  if (document.querySelector("[data-changed-elsewhere]")) return;
  const bar = document.createElement("div");
  bar.dataset.changedElsewhere = "";
  bar.setAttribute("role", "status");
  bar.className =
    "fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-[30rem] items-center gap-3 rounded-[14px] bg-ink py-2.5 pr-2.5 pl-4 text-[0.9375rem] text-paper shadow-[var(--shadow-pop)] lg:bottom-6 lg:left-[calc(17rem+1.5rem)]";
  render(
    bar,
    html`${icon("monitor-smartphone", "flex-none text-mustard")}<p class="min-w-0 flex-1">${text}</p>
      <button type="button" class="btn btn-primary btn-sm flex-none" data-reload>${icon("refresh-cw", "h-4 w-4")} Actualizar</button>`,
  );
  bar.querySelector("[data-reload]").addEventListener("click", () => location.reload());
  document.body.append(bar);
}

function fatalError(error) {
  return html`<div class="grid min-h-dvh place-items-center p-6 text-center">
    <div class="grid max-w-sm justify-items-center gap-4">
      <span class="grid h-12 w-12 place-items-center rounded-full bg-tomato-soft text-tomato">${icon("circle-alert")}</span>
      <h1 class="text-xl font-[750]">No pudimos cargar tu panel</h1>
      <p class="text-muted">${error.message}</p>
      <a class="btn btn-ink" href="">Intentar de nuevo</a>
    </div>
  </div>`;
}

/** Usuario sin negocios (p. ej. lo quitaron del único negocio al que pertenecía). */
export function renderNoBusiness(main) {
  render(
    main,
    html`<section class="panel mx-auto mt-6 grid max-w-lg gap-5 p-6 sm:p-8">
      <span class="grid h-12 w-12 place-items-center rounded-full bg-mustard-soft text-ink">${icon("store")}</span>
      <div class="grid gap-2">
        <h1 class="text-2xl font-[780]">No tienes un negocio activo</h1>
        <p class="text-muted">Crea uno para empezar a recibir pedidos, o pide al propietario de un negocio que te agregue a su equipo.</p>
      </div>
      <form class="grid gap-4" data-create-business novalidate>
        ${formAlert()}
        <div class="field">
          <label class="label" for="nb-name">Nombre del negocio</label>
          <input class="input" id="nb-name" name="name" required maxlength="80" />
        </div>
        <div class="field">
          <label class="label" for="nb-phone">Celular del negocio</label>
          <input class="input" id="nb-phone" name="phone" type="tel" inputmode="tel" placeholder="300 123 4567" required />
        </div>
        <button class="btn btn-ink" type="submit">Crear negocio</button>
      </form>
    </section>`,
  );
}

// ───────────────────────────────── Inicio ─────────────────────────────────

const LINK_SHARED_KEY = "pedify:link-shared";

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Almacenamiento no disponible (modo privado): no es crítico.
  }
}

function todayLabel() {
  const text = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Bogota",
  }).format(new Date());
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function acceptingControl(business, settings) {
  const on = settings.acceptingOrders;
  const label = on ? "Recibiendo pedidos" : "Pedidos en pausa";
  const tone = on ? "text-leaf" : "text-tomato";
  if (business.role !== "OWNER") {
    return html`<span class="badge badge-dot border border-line bg-paper px-3 py-2 text-sm ${tone}">${label}</span>`;
  }
  return html`<label class="flex cursor-pointer items-center gap-3 rounded-full border border-line bg-paper py-1.5 pr-1.5 pl-4 shadow-[var(--shadow-lift)]">
    <span class="badge-dot inline-flex items-center gap-2 text-sm font-[650] ${tone}" data-accepting-label>${label}</span>
    <input type="checkbox" role="switch" class="switch" data-accepting ${on ? "checked" : ""} aria-label="Recibir pedidos" />
  </label>`;
}

const POLICY_TEXT = {
  ACCEPTED: "Ventas: pedidos aceptados por ti.",
  DELIVERED: "Ventas: pedidos entregados.",
  PAID: "Ventas: pedidos marcados como pagados.",
};

function summary(today) {
  const stat = (label, value) => html`<div class="flex min-w-0 flex-col justify-between gap-1 px-4 py-4 sm:px-6 sm:py-5">
    <dt class="text-[0.8125rem] font-medium text-muted sm:text-sm">${label}</dt>
    <dd class="num truncate text-[1.5rem] leading-none font-[800] [font-stretch:78%] sm:text-[2rem]">${value}</dd>
  </div>`;
  return html`<section aria-labelledby="summary-title" class="panel overflow-hidden">
    <div class="flex items-center justify-between gap-3 px-4 pt-4 sm:px-6">
      <h2 id="summary-title" class="text-lg font-[740]">Resumen de hoy</h2>
      <span class="text-xs font-medium text-muted">Hora de Colombia</span>
    </div>
    <dl class="grid grid-cols-3 divide-x divide-dashed divide-line-strong">
      ${stat("Ventas del día", formatCOP(today.sales))} ${stat("Pedidos del día", String(today.created))}
      ${stat("Ticket promedio", formatCOP(today.averageTicket))}
    </dl>
    <p class="border-t border-line bg-ground/70 px-4 py-2.5 text-[0.8125rem] text-muted sm:px-6">
      ${POLICY_TEXT[today.salesPolicy] ?? ""} Un pedido cancelado no cuenta como venta.
    </p>
  </section>`;
}

function liveOrderRow(order) {
  const action = nextAction(order);
  const isNew = order.status === "PENDING";
  return html`<li class="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 ${isNew ? "-mx-2 rounded-[10px] bg-mustard-soft px-2" : ""}" data-home-order="${order.id}">
    <span class="display w-14 flex-none text-[1.5rem]">#${order.number}</span>
    <span class="min-w-0 flex-1">
      <span class="block truncate font-[650]">${order.customerName}</span>
      <span class="flex flex-wrap items-center gap-x-2 text-sm text-muted">
        ${statusBadge(order.status)} <span>${elapsedLabel(order.createdAt)}</span>
        ${order.deliveryType === "DINE_IN" ? html`<span class="flex items-center gap-1">${deliveryLabel(order)}</span>` : ""}
        <span class="num font-[650] text-ink">${formatCOP(order.total)}</span>
      </span>
    </span>
    ${action
      ? html`<button type="button" class="btn ${isNew ? "btn-ink" : "btn-ghost"} btn-sm" data-advance="${order.id}" data-from="${order.status}" data-to="${action.status}">
          ${icon(action.icon, "h-4 w-4")} ${action.label}
        </button>`
      : ""}
  </li>`;
}

function liveOrders(orders) {
  const pending = orders.filter((order) => order.status === "PENDING").length;
  return html`<section aria-labelledby="live-title" class="panel p-4 sm:p-6" data-live-orders>
    <div class="flex items-center justify-between gap-3">
      <h2 id="live-title" class="text-lg font-[740]">Pedidos en vivo</h2>
      ${orders.length > 0
        ? html`<span class="badge ${pending ? "bg-mustard text-ink" : "bg-ground text-muted"}">${pending ? `${pending} por confirmar` : `${orders.length} en curso`}</span>`
        : html`<span class="badge bg-ground text-muted">Sin pedidos pendientes</span>`}
    </div>
    ${orders.length === 0
      ? html`<div class="mt-4 grid justify-items-center gap-3 rounded-[12px] border-2 border-dashed border-line px-6 py-10 text-center sm:py-12">
          <span class="grid h-14 w-14 place-items-center rounded-full bg-mustard-soft text-ink">${icon("receipt", "h-7 w-7")}</span>
          <p class="text-lg font-[720]">Aquí llegarán tus pedidos</p>
          <p class="max-w-[42ch] text-[0.9375rem] text-muted">
            Cuando un cliente haga un pedido en tu tienda, aparecerá en esta lista al instante. Activa el sonido para escuchar una
            alerta con cada pedido nuevo.
          </p>
        </div>`
      : html`<ul class="mt-2 divide-y divide-line">${orders.slice(0, 6).map(liveOrderRow)}</ul>
          <a class="btn btn-ghost mt-3 w-full" href="/panel/pedidos">Ver todos los pedidos ${icon("arrow-right", "h-4 w-4")}</a>`}
  </section>`;
}

function featuredProducts(today) {
  return html`<section aria-labelledby="featured-title" class="panel p-4 sm:p-6">
    <h2 id="featured-title" class="text-lg font-[740]">Productos destacados de hoy</h2>
    ${today.topProducts.length === 0
      ? html`<p class="mt-2 text-[0.9375rem] text-muted">Cuando tengas ventas hoy, aquí verás lo que más se vende.</p>`
      : html`<ol class="mt-3 grid gap-2.5">
          ${today.topProducts.map(
            (product, index) => html`<li class="flex items-center gap-3">
              <span class="grid h-8 w-8 flex-none place-items-center rounded-full ${index === 0 ? "bg-mustard" : "bg-ground"} text-sm font-[800]">${index + 1}</span>
              <span class="min-w-0 flex-1 truncate font-[620]">${product.name}</span>
              <span class="num text-sm text-muted">${product.quantity} und.</span>
            </li>`,
          )}
        </ol>`}
  </section>`;
}

function storeCard(business, catalog) {
  const url = new URL(business.storeUrl);
  const visible = catalog.visible;
  return html`<section aria-labelledby="store-title" class="panel overflow-hidden">
    <div class="bg-ink p-5 text-paper">
      <h2 id="store-title" class="flex items-center gap-2 text-lg font-[740]">${icon("store", "text-mustard")} Tu tienda</h2>
      <p class="mt-3 text-[1.0625rem] leading-snug [overflow-wrap:anywhere]">
        <span class="text-ink-soft">${url.host}/tienda/</span><span class="font-[750] text-mustard">${business.slug}</span>
      </p>
    </div>
    <div class="grid gap-3 p-4">
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-primary btn-sm" data-copy-link="${business.storeUrl}">${icon("copy")} Copiar enlace</button>
        <a class="btn btn-ghost btn-sm" href="${business.storeUrl}" target="_blank" rel="noopener">${icon("external-link")} Ver tienda</a>
        <a class="btn btn-ghost btn-sm" href="/panel/tienda">${icon("qr-code")} Código QR</a>
      </div>
      <p class="text-[0.8125rem] text-muted">
        ${visible === 0
          ? "Tu tienda aún no muestra productos. Agrega tu menú para que tus clientes vean qué vendes."
          : `${visible} ${visible === 1 ? "producto visible" : "productos visibles"} en tu tienda${catalog.soldOut ? ` · ${catalog.soldOut} agotado${catalog.soldOut === 1 ? "" : "s"}` : ""}.`}
      </p>
    </div>
  </section>`;
}

function checklist(business, settings, catalog) {
  const settingsReviewed = new Date(settings.updatedAt) - new Date(business.createdAt) > 5000;
  const owner = business.role === "OWNER";
  const items = [
    {
      done: Boolean(settings.whatsappPhone),
      title: "WhatsApp de contacto",
      text: "Para que tus clientes te escriban si tienen dudas. Los pedidos llegan directo a tu panel.",
      href: "/panel/configuracion#whatsapp",
    },
    {
      done: settingsReviewed,
      title: "Horario, domicilio y pagos",
      text: "Cuánto cobras de domicilio, a qué horas atiendes y cómo te pagan.",
      href: "/panel/configuracion#horario",
    },
    {
      done: Boolean(business.address && business.description),
      title: "Dirección y descripción del negocio",
      text: "Se muestran en tu tienda para que te encuentren y sepan qué vendes.",
      href: "/panel/configuracion#negocio",
    },
    {
      done: catalog.total > 0,
      title: "Tu menú con fotos y precios",
      text: "Organízalo por categorías: salchipapas, hamburguesas, bebidas…",
      href: "/panel/menu",
      action: "Agregar",
    },
    {
      done: Boolean(business.logoUrl),
      title: "Logo y portada de tu tienda",
      text: "Así tus clientes reconocen tu negocio apenas abren el enlace.",
      href: "/panel/tienda",
      action: "Subir",
    },
    {
      done: storageGet(LINK_SHARED_KEY) === business.id,
      title: "Comparte el enlace de tu tienda",
      text: "Ponlo en tu estado de WhatsApp, Instagram o Facebook.",
      copy: true,
    },
  ];
  const doneCount = items.filter((item) => item.done).length;

  return html`<section aria-labelledby="setup-title" class="panel p-4 sm:p-6">
    <div class="flex items-baseline justify-between gap-3">
      <h2 id="setup-title" class="text-lg font-[740]">Pon tu tienda a punto</h2>
      <span class="num text-sm font-semibold text-muted">${doneCount} de ${items.length}</span>
    </div>
    <div class="mt-3 grid grid-cols-6 gap-1" aria-hidden="true">
      ${items.map((item) => html`<span class="h-1.5 rounded-full ${item.done ? "bg-ink" : "bg-line"}"></span>`)}
    </div>
    <ol class="mt-3">
      ${items.map(
        (item) => html`<li class="flex items-start gap-3 border-t border-line py-3.5 first:border-t-0">
          <span
            class="mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full ${item.done ? "bg-leaf text-paper" : "border-2 border-line-strong"}"
            aria-hidden="true"
          >
            ${item.done ? icon("check", "h-3.5 w-3.5") : ""}
          </span>
          <div class="min-w-0 flex-1">
            <p class="font-[620] ${item.done ? "text-muted" : ""}">
              ${item.title}<span class="sr-only">${item.done ? " (listo)" : " (pendiente)"}</span>
            </p>
            <p class="text-[0.8125rem] text-muted">${item.text}</p>
          </div>
          ${item.done
            ? ""
            : item.copy
              ? html`<button type="button" class="btn btn-ghost btn-sm" data-copy-link="${business.storeUrl}">Copiar</button>`
              : owner
                ? html`<a class="btn btn-ghost btn-sm" href="${item.href}">${item.action ?? "Configurar"}</a>`
                : ""}
        </li>`,
      )}
    </ol>
  </section>`;
}

function homeSkeleton() {
  return html`<div class="grid gap-6" aria-busy="true" aria-label="Cargando">
    <div class="skeleton h-10 w-56"></div>
    <div class="skeleton h-36"></div>
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
      <div class="skeleton h-72"></div>
      <div class="skeleton h-72"></div>
    </div>
  </div>`;
}

const INSTALL_CARD_KEY = "pedify:install-card";

/**
 * Tarjeta de Inicio para instalar Pedify como app en este equipo. En el computador trae además el
 * código QR de /app para instalarla en el celular. No aparece si ya abriste Pedify como app.
 */
function installCard() {
  if (!INSTALLABLE.has(installState()) || storageGet(INSTALL_CARD_KEY) === "hidden") return "";
  const phone = isPhone();
  return html`<section class="panel grid gap-5 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center" data-install-card aria-labelledby="install-card-title">
    <div class="grid gap-4">
      <div class="flex items-start gap-4">
        <span class="grid h-11 w-11 flex-none place-items-center rounded-full bg-mustard text-ink">${icon("monitor-smartphone", "h-5 w-5")}</span>
        <div class="grid gap-1.5">
          <h2 id="install-card-title" class="text-[1.125rem] leading-tight font-[780]">Pedify como app, en tu celular y en tu computador</h2>
          <p class="max-w-[60ch] text-[0.9375rem] text-muted">
            Ábrela con un toque desde su ícono. Todo queda conectado: lo que aceptas en un equipo se ve al instante en el otro.
          </p>
        </div>
      </div>
      <div class="flex flex-wrap gap-2 sm:pl-15">
        <button type="button" class="btn btn-ink" data-install-app>${icon("download")} ${installLabel()}</button>
        <button type="button" class="btn btn-quiet" data-install-dismiss>Ahora no</button>
      </div>
    </div>
    ${phone
      ? ""
      : html`<a href="/app" class="hidden items-center gap-3 rounded-[14px] border border-line p-2.5 pr-4 text-ink no-underline hover:border-line-strong md:flex">
          <img src="/app/qr.svg" alt="" class="h-[5.5rem] w-[5.5rem] rounded-[8px]" width="88" height="88" />
          <span class="grid max-w-[11rem] gap-0.5 text-sm">
            <span class="font-[720]">¿Y en tu celular?</span>
            <span class="text-muted">Escanea el código con la cámara y sigue los pasos.</span>
          </span>
        </a>`}
  </section>`;
}

async function copyStoreLink(button, business) {
  const url = button.dataset.copyLink;
  if (await copyText(url)) {
    storageSet(LINK_SHARED_KEY, business.id);
    toast("Enlace copiado. Pégalo donde quieras compartirlo.");
  } else {
    toast(`Copia este enlace: ${url}`, "info");
  }
}

async function renderHome(context) {
  const { me, main } = context;
  let { business } = context;
  if (!business) return renderNoBusiness(main);

  render(main, homeSkeleton());
  // Las ventas del día solo las ve el propietario o un empleado con ese permiso.
  const seesSales = can(business, "viewSales");
  let pushStatus = await safePushState();
  let settings;
  let catalog;
  let today;
  let orders;
  try {
    [settings, catalog, today, orders] = await Promise.all([
      api("/businesses/current/settings"),
      api("/products/summary"),
      seesSales ? api("/analytics/today") : null,
      api("/orders").then((page) => page.items),
    ]);
  } catch (error) {
    render(main, html`<p class="text-tomato">${error.message}</p>`);
    return;
  }

  const firstName = me.user.name.split(/\s+/)[0];
  const draw = () =>
    render(
      main,
      html`<div class="grid gap-6 lg:gap-8">
        <header class="relative isolate overflow-hidden rounded-[22px] bg-ink text-paper shadow-[var(--shadow-lift)]">
          <img
            src="${business.bannerUrl ?? "/assets/images/food/friends-table-960.webp"}"
            alt=""
            class="absolute inset-0 -z-10 h-full w-full object-cover"
          />
          <div class="absolute inset-0 -z-10 bg-linear-to-r from-ink/90 via-ink/60 to-ink/5"></div>
          <div class="flex min-h-[11rem] flex-wrap items-end justify-between gap-4 p-5 sm:min-h-[13.5rem] sm:p-8">
            <div class="min-w-0">
              <h1 class="text-[2.125rem] leading-[1.05] font-[820] [font-stretch:82%] sm:text-[3rem]">Hola, ${firstName}</h1>
              <p class="mt-1.5 text-[0.9375rem] text-paper/85"><span class="font-[680] text-mustard">${todayLabel()}</span> · ${business.name}</p>
            </div>
            ${acceptingControl(business, settings)}
          </div>
        </header>

        ${installCard()}
        ${pushStatus === "ios-install" && installCard() ? "" : pushView(pushStatus, "card")}

        <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div class="grid gap-6">${seesSales ? summary(today) : ""} ${liveOrders(orders)} ${seesSales ? featuredProducts(today) : ""}</div>
          <div class="grid gap-6">${storeCard(business, catalog)} ${business.role === "OWNER" ? checklist(business, settings, catalog) : ""}</div>
        </div>
      </div>`,
    );
  draw();

  // En vivo: un pedido nuevo o un cambio de estado vuelve a consultar la API.
  let refreshing = null;
  const refresh = () => {
    refreshing ??= Promise.all([seesSales ? api("/analytics/today") : null, api("/orders").then((page) => page.items)])
      .then(([nextToday, nextOrders]) => {
        today = nextToday;
        orders = nextOrders;
        draw();
      })
      .catch(() => {})
      .finally(() => (refreshing = null));
  };
  onLive("created", refresh);
  onLive("updated", refresh);
  onLive("resync", refresh);
  // El menú o la tienda cambiaron en otro dispositivo (p. ej. pausaste los pedidos desde el celular).
  onLive("changed", async ({ scope }) => {
    if (scope !== "catalog" && scope !== "business") return;
    try {
      [settings, catalog, business] = await Promise.all([api("/businesses/current/settings"), api("/products/summary"), api("/businesses/current")]);
      draw();
    } catch {
      // Sin conexión: se actualiza al reconectarse.
    }
  });
  setInterval(() => main.querySelector("[data-live-orders]") && draw(), 60_000);

  window.addEventListener("pedify:push", (event) => {
    if (pushStatus === event.detail) return;
    pushStatus = event.detail;
    draw();
  });
  // El navegador ofreció instalarla o ya quedó instalada: la tarjeta cambia o se va.
  window.addEventListener("pedify:install", draw);
  main.addEventListener("click", async (event) => {
    if (event.target.closest("[data-install-dismiss]")) {
      storageSet(INSTALL_CARD_KEY, "hidden");
      draw();
      return;
    }
    const pushNext = await handlePushClick(event, pushStatus);
    if (pushNext !== null) {
      pushStatus = pushNext;
      draw();
      return;
    }
    const advance = event.target.closest("[data-advance]");
    if (advance) {
      setBusy(advance, true);
      try {
        const updated = await api(`/orders/${advance.dataset.advance}/status`, {
          method: "PATCH",
          body: { status: advance.dataset.to, from: advance.dataset.from },
        });
        refresh();
        // Al despachar un domicilio: el enlace para que el domiciliario comparta su ubicación.
        if (advance.dataset.to === "OUT_FOR_DELIVERY") void openCourierLink(updated);
      } catch (error) {
        setBusy(advance, false);
        toast(error.message, "error");
        refresh();
      }
      return;
    }
    const button = event.target.closest("[data-copy-link]");
    if (!button) return;
    copyStoreLink(button, business).then(draw);
  });

  main.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-accepting]");
    if (!input) return;
    input.disabled = true;
    try {
      settings = await api("/businesses/current/settings", {
        method: "PATCH",
        body: { acceptingOrders: input.checked },
      });
      toast(settings.acceptingOrders ? "Tu tienda vuelve a recibir pedidos." : "Pausaste los pedidos. Tu tienda mostrará que no estás recibiendo.");
      draw();
    } catch (error) {
      input.checked = !input.checked;
      input.disabled = false;
      toast(error.message, "error");
    }
  });

  const params = new URLSearchParams(location.search);
  if (params.has("bienvenida")) {
    toast(`¡Listo! ${business.name} ya está en Pedify.`);
    history.replaceState(null, "", location.pathname);
  }
}

if (document.body.dataset.page === "inicio") {
  initPanel("inicio").then((context) => context && renderHome(context));
}
