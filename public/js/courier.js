// Página del domiciliario (/domicilio#clave): se abre con el enlace que genera el negocio, sin cuenta.
// Muestra la dirección y lo que hay que cobrar, comparte la ubicación del celular mientras el pedido
// va en camino (el cliente la ve en su seguimiento), muestra el QR del negocio para cobrar por
// transferencia y permite marcar la entrega.
import { formatCOP, formatPhone } from "./api.js";
import { deliveryMap, distanceLabel, distanceMeters } from "./map.js";
import { copyText, html, icon, raw, render, setBusy } from "./ui.js";

const root = document.getElementById("courier");
const key = decodeURIComponent(location.hash.slice(1));

const PAYMENT = { CASH: "en efectivo", NEQUI: "por Nequi", DAVIPLATA: "por Daviplata", BANK_TRANSFER: "por transferencia", CARD: "con datáfono" };
/** Cada cuánto se envía la posición (y como mínimo, aunque no se mueva). */
const SEND_EVERY_MS = 5_000;
const HEARTBEAT_MS = 20_000;

const state = {
  order: null,
  /** idle · locating · sharing · denied · error · delivered · invalid */
  phase: "idle",
  position: null,
  lastSentAt: 0,
  message: "",
};

let watchId = null;
let wakeLock = null;
let map = null;
let pollTimer = 0;

async function call(path, init = {}) {
  const response = await fetch(`/api/v1/courier${path}`, {
    ...init,
    headers: { Accept: "application/json", "X-Courier-Key": key, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    cache: "no-store",
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? "No pudimos conectarnos. Revisa tu internet.");
    error.status = response.status;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload.data;
}

// ───────────────────────────── Vistas ─────────────────────────────

function statusCard() {
  const { phase, order } = state;
  const onTheWay = order.status === "OUT_FOR_DELIVERY";
  if (phase === "delivered") {
    return html`<section class="rounded-[20px] bg-leaf p-5 text-paper">
      <p class="flex items-center gap-2 text-[1.375rem] font-[820]">${icon("circle-check", "h-6 w-6")} ¡Pedido entregado!</p>
      <p class="mt-1 text-paper/85">Dejamos de compartir tu ubicación. Ya puedes cerrar esta página.</p>
    </section>`;
  }
  if (phase === "sharing") {
    const seconds = state.lastSentAt ? Math.max(0, Math.round((Date.now() - state.lastSentAt) / 1000)) : null;
    return html`<section class="rounded-[20px] bg-ink p-5 text-paper" aria-live="polite">
      <p class="flex items-center gap-3 text-[1.25rem] font-[800]">
        <span class="relative grid h-3.5 w-3.5 place-items-center"><span class="absolute h-3.5 w-3.5 animate-ping rounded-full bg-leaf opacity-75"></span><span class="h-3 w-3 rounded-full bg-leaf"></span></span>
        Compartiendo tu ubicación
      </p>
      <p class="mt-1.5 text-[0.9375rem] text-paper/75">
        El cliente te ve en el mapa${seconds !== null ? html` · actualizada hace <span class="num" data-ago>${seconds}</span> s` : ""}. Mantén esta pantalla abierta.
      </p>
      <button type="button" class="btn btn-quiet btn-sm mt-3 text-paper hover:bg-ink-3" data-stop>${icon("x", "h-4 w-4")} Dejar de compartir</button>
    </section>`;
  }
  if (phase === "denied" || phase === "error") {
    return html`<section class="rounded-[20px] bg-tomato-soft p-5 text-tomato" role="alert">
      <p class="font-[760]">${state.message}</p>
      <button type="button" class="btn btn-ink mt-3" data-start>${icon("navigation-2")} Intentar de nuevo</button>
    </section>`;
  }
  if (!onTheWay) {
    return html`<section class="rounded-[20px] bg-mustard-soft p-5 text-mustard-deep">
      <p class="text-[1.125rem] font-[780]">El pedido aún no sale</p>
      <p class="mt-1 text-[0.9375rem]">Cuando el negocio lo marque «En camino», toca «Empezar entrega» para que el cliente te siga en el mapa.</p>
      <button type="button" class="btn btn-ink mt-3" data-start>${icon("navigation-2")} Empezar entrega</button>
    </section>`;
  }
  return html`<section class="rounded-[20px] bg-mustard p-5 text-ink">
    <p class="text-[1.25rem] font-[820]">¿Listo para salir?</p>
    <p class="mt-1 text-[0.9375rem] text-ink/80">Comparte tu ubicación para que el cliente vea cuándo llegas. Solo se usa mientras llevas este pedido.</p>
    <button type="button" class="btn btn-ink mt-3 min-h-13 w-full text-base" data-start ${phase === "locating" ? "disabled" : ""}>
      ${icon("navigation-2")} ${phase === "locating" ? "Buscando tu ubicación…" : "Empezar entrega"}
    </button>
  </section>`;
}

function navigationLinks(order) {
  const { destination, customer } = order;
  const google = destination
    ? `https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(customer.address ?? "")}`;
  const waze = destination ? `https://waze.com/ul?ll=${destination.lat},${destination.lng}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(customer.address ?? "")}`;
  return html`<a class="btn btn-ghost btn-sm" href="${google}" target="_blank" rel="noopener">${icon("map-pin", "h-4 w-4")} Google Maps</a>
    <a class="btn btn-ghost btn-sm" href="${waze}" target="_blank" rel="noopener">${icon("navigation", "h-4 w-4")} Waze</a>`;
}

/** Lo que hay que cobrar y, si el negocio subió sus QR, el botón para mostrarlos al cliente. */
function chargeCard(order) {
  if (order.paid) {
    return html`<section class="rounded-[20px] bg-leaf-soft p-4 text-leaf">
      <p class="flex items-center gap-2 font-[760]">${icon("circle-check")} Ya está pagado: no cobres.</p>
    </section>`;
  }
  if (order.paymentProofSent) {
    // Pagó al pedir y envió el comprobante: el negocio lo revisa antes de despacharlo.
    return html`<section class="rounded-[20px] bg-leaf-soft p-4 text-leaf">
      <p class="flex items-center gap-2 font-[760]">${icon("circle-check")} Pagó por adelantado: no cobres.</p>
      <p class="mt-1 text-sm">El cliente pagó ${PAYMENT[order.paymentMethod] ?? ""} al pedir y envió el comprobante. Si el negocio te dice otra cosa, cobra <span class="num font-[700]">${formatCOP(order.total)}</span>.</p>
    </section>`;
  }
  const accounts = order.paymentAccounts ?? [];
  // El cliente eligió Nequi, Daviplata o transferencia: el QR es lo principal.
  const byTransfer = Boolean(order.suggestedAccount);
  return html`<section class="rounded-[20px] bg-ink p-4 text-paper">
    <p class="text-sm text-paper/70">Cobrar ${PAYMENT[order.paymentMethod] ?? ""}</p>
    <p class="num text-[2rem] leading-none font-[840] [font-stretch:80%] text-mustard">${formatCOP(order.total)}</p>
    ${accounts.length > 0
      ? html`<button
          type="button"
          class="btn ${byTransfer ? "btn-primary min-h-13 text-base" : "btn-quiet border border-paper/25 text-paper hover:bg-ink-3"} mt-3 w-full"
          data-show-qr
        >
          ${icon("qr-code")} ${byTransfer ? "Mostrar QR para pagar" : "¿Paga por transferencia? Mostrar QR"}
        </button>`
      : byTransfer
        ? html`<p class="mt-2 text-sm text-paper/70">El negocio no ha subido su QR de cobro. Pídele al negocio el número para que el cliente transfiera.</p>`
        : ""}
  </section>`;
}

/** Pantalla blanca a todo lo ancho con el QR grande, para que el cliente lo escanee desde su celular. */
let payDialog = null;
let payKind = null;

function payView() {
  const { order } = state;
  const accounts = order.paymentAccounts ?? [];
  const account = accounts.find((item) => item.kind === payKind) ?? accounts[0];
  if (!account) return "";
  return html`<div class="mx-auto flex min-h-full max-w-[30rem] flex-col px-5 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
    <header class="flex items-start gap-3">
      <div class="min-w-0">
        <p class="truncate text-sm text-muted">Pedido #${order.number} · ${order.business.name}</p>
        <h2 id="pay-title" class="text-[1.5rem] leading-tight font-[820] [font-stretch:85%] outline-none" tabindex="-1" autofocus>Escanea para pagar</h2>
      </div>
      <button type="button" class="btn btn-ghost btn-icon ml-auto flex-none" data-close-qr aria-label="Cerrar">${icon("x")}</button>
    </header>
    ${accounts.length > 1
      ? html`<div class="mt-4 flex gap-1 rounded-full bg-ground p-1" role="group" aria-label="Cuenta para pagar">
          ${accounts.map(
            (item) => html`<button
              type="button"
              class="min-h-10 flex-1 rounded-full px-3 text-[0.9375rem] font-[720] text-muted aria-pressed:bg-ink aria-pressed:text-paper"
              aria-pressed="${item.kind === account.kind ? "true" : "false"}"
              data-pay-kind="${item.kind}"
            >
              ${item.label}
            </button>`,
          )}
        </div>`
      : ""}
    <div class="grid flex-1 content-center justify-items-center gap-4 py-5 text-center">
      ${account.qrSvg
        ? html`<div
            class="w-full max-w-[19rem] rounded-[22px] border-[3px] border-ink bg-[#fff] p-2.5 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
            role="img"
            aria-label="Código QR de ${account.label} para pagar"
          >
            ${raw(account.qrSvg)}
          </div>`
        : html`<div class="grid w-full max-w-[19rem] justify-items-center gap-2 rounded-[22px] bg-ground px-5 py-7">
            ${icon("smartphone", "h-8 w-8 text-muted")}
            <p class="font-[720]">El negocio no subió el QR de ${account.label}</p>
            <p class="text-sm text-muted">Muéstrale o díctale al cliente el número de abajo.</p>
          </div>`}
      <div>
        <p class="text-sm font-[620] text-muted">Valor a pagar</p>
        <p class="num text-[2.75rem] leading-none font-[860] [font-stretch:80%]">${formatCOP(order.total)}</p>
      </div>
      ${account.holderName || account.accountKey
        ? html`<div class="grid justify-items-center gap-2">
            ${account.holderName ? html`<p class="text-[0.9375rem]">${account.label} a nombre de <strong class="font-[760]">${account.holderName}</strong></p>` : ""}
            ${account.accountKey
              ? html`<button type="button" class="inline-flex min-h-11 items-center gap-2 rounded-full bg-ground px-4 text-[1rem] font-[720]" data-copy-key="${account.accountKey.replace(/\s+/g, "")}">
                  <span class="text-muted">${account.kind === "BRE_B" ? "Llave" : "Número"}</span>
                  <span class="num [overflow-wrap:anywhere]">${account.accountKey}</span>
                  <span class="text-muted" data-copy-label>${icon("copy", "h-4 w-4")}</span>
                </button>`
              : ""}
          </div>`
        : ""}
      <p class="max-w-[22rem] text-sm text-muted">
        El cliente abre su app (Nequi, Daviplata o la de su banco), toca «Escanear» y escribe el valor. Antes de entregar, pide ver el pago aprobado.
      </p>
    </div>
  </div>`;
}

function openPay() {
  const { order } = state;
  const accounts = order.paymentAccounts ?? [];
  if (accounts.length === 0) return;
  // Primero la cuenta que eligió el cliente si tiene QR; si no, cualquiera con QR (Bre-B se paga desde
  // cualquier banco o billetera); si ninguna tiene QR, la elegida para mostrar la llave.
  const suggested = accounts.find((item) => item.kind === order.suggestedAccount);
  payKind = ((suggested?.qrSvg ? suggested : null) ?? accounts.find((item) => item.qrSvg) ?? suggested ?? accounts[0]).kind;
  if (!payDialog) {
    payDialog = document.createElement("dialog");
    payDialog.className = "m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto bg-paper p-0 text-ink backdrop:bg-ink/70";
    payDialog.setAttribute("aria-labelledby", "pay-title");
    document.body.append(payDialog);
    payDialog.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.matches("[data-close-qr]")) payDialog.close();
      if (button.matches("[data-pay-kind]")) {
        payKind = button.dataset.payKind;
        render(payDialog, payView());
      }
      if (button.matches("[data-copy-key]")) {
        const ok = await copyText(button.dataset.copyKey);
        const label = button.querySelector("[data-copy-label]");
        if (label) label.textContent = ok ? "Copiado" : "";
      }
    });
    payDialog.addEventListener("close", () => {
      // Si no está compartiendo la ubicación, la pantalla ya puede apagarse.
      if (watchId === null) {
        void wakeLock?.release().catch(() => {});
        wakeLock = null;
      }
      document.documentElement.classList.remove("overflow-hidden");
      root.querySelector("[data-show-qr]")?.focus();
    });
  }
  render(payDialog, payView());
  document.documentElement.classList.add("overflow-hidden");
  payDialog.showModal();
  payDialog.scrollTop = 0;
  // Que la pantalla no se apague mientras el cliente saca su celular.
  void keepScreenOn();
}

function page() {
  const { order } = state;
  const { customer } = order;
  const distance = state.position && order.destination ? distanceMeters(state.position, order.destination) : null;
  return html`<header class="flex items-center gap-3 px-4 pt-4 pb-3">
      <img src="/assets/icons/logo.svg" alt="" class="h-8 w-8" width="32" height="32" />
      <div class="min-w-0">
        <p class="text-[1.125rem] leading-tight font-[820] [font-stretch:80%]">Entrega del pedido #${order.number}</p>
        <p class="truncate text-sm text-muted">${order.business.name}</p>
      </div>
    </header>
    <main class="grid gap-4 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <div data-status>${statusCard()}</div>

      <section class="overflow-hidden rounded-[20px] bg-paper">
        <div class="delivery-map h-64 rounded-none" data-map aria-label="Mapa de la entrega"></div>
        <div class="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <span class="text-muted" data-distance>${distance !== null ? html`Estás a <span class="num font-[760] text-ink">${distanceLabel(distance)}</span> del cliente` : order.destination ? "Tu ubicación aparece al empezar la entrega" : "El cliente no marcó su ubicación: guíate por la dirección"}</span>
        </div>
      </section>

      <section class="grid gap-3 rounded-[20px] bg-paper p-4">
        <div>
          <p class="text-sm font-[650] text-muted">Entregar a</p>
          <p class="text-[1.125rem] font-[780]">${customer.name}</p>
          <p class="mt-1 text-[1rem]">${customer.address ?? ""}</p>
          ${customer.references ? html`<p class="text-[0.9375rem] text-muted">${customer.references}</p>` : ""}
          ${customer.notes ? html`<p class="mt-2 rounded-[10px] bg-mustard-soft px-3 py-2 text-[0.9375rem] text-mustard-deep">Nota: ${customer.notes}</p>` : ""}
        </div>
        <div class="flex flex-wrap gap-2">
          <a class="btn btn-ink btn-sm" href="tel:+${customer.phone}">${icon("phone", "h-4 w-4")} Llamar · ${formatPhone(customer.phone)}</a>
          ${navigationLinks(order)}
        </div>
      </section>

      ${chargeCard(order)}

      <details class="rounded-[20px] bg-paper px-4 py-3">
        <summary class="cursor-pointer font-[700]">Productos (${order.items.reduce((sum, item) => sum + item.quantity, 0)})</summary>
        <ul class="mt-2 grid gap-1 text-[0.9375rem]">
          ${order.items.map((item) => html`<li><span class="num font-[700]">${item.quantity}×</span> ${item.name}</li>`)}
        </ul>
      </details>

      ${order.status === "OUT_FOR_DELIVERY" && state.phase !== "delivered"
        ? html`<div class="grid gap-2" data-deliver-area>
            <button type="button" class="btn btn-primary min-h-14 text-[1.0625rem]" data-ask-deliver>${icon("circle-check")} Marcar como entregado</button>
          </div>`
        : ""}
    </main>`;
}

function invalidPage(message) {
  return html`<div class="grid min-h-dvh place-items-center p-6 text-center">
    <div class="grid max-w-sm justify-items-center gap-3">
      <span class="grid h-14 w-14 place-items-center rounded-full bg-mustard-soft">${icon("bike", "h-7 w-7")}</span>
      <h1 class="text-2xl font-[780]">Este enlace ya no funciona</h1>
      <p class="text-muted">${message}</p>
    </div>
  </div>`;
}

// ───────────────────────────── Dibujo ─────────────────────────────

async function draw() {
  map?.destroy();
  map = null;
  render(root, page());
  const container = root.querySelector("[data-map]");
  try {
    map = await deliveryMap(container, {
      destination: state.order.destination,
      courier: state.position,
      config: state.order.map,
    });
  } catch {
    render(container, html`<p class="grid h-full place-items-center p-4 text-center text-sm text-muted">No se pudo cargar el mapa. La dirección está abajo.</p>`);
  }
}

function redrawStatus() {
  const slot = root.querySelector("[data-status]");
  if (slot) render(slot, statusCard());
}

function updateDistance() {
  const slot = root.querySelector("[data-distance]");
  if (!slot || !state.position || !state.order.destination) return;
  render(slot, html`Estás a <span class="num font-[760] text-ink">${distanceLabel(distanceMeters(state.position, state.order.destination))}</span> del cliente`);
}

// ───────────────────────────── Ubicación ─────────────────────────────

async function keepScreenOn() {
  if (wakeLock && !wakeLock.released) return;
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch {
    // Sin permiso o sin soporte: solo hay que tocar la pantalla de vez en cuando.
  }
}

async function send(position) {
  try {
    await call("/location", { method: "POST", body: JSON.stringify(position) });
    state.lastSentAt = Date.now();
    if (state.phase !== "sharing") {
      state.phase = "sharing";
      redrawStatus();
    }
  } catch (error) {
    if (error.code === "NOT_ON_THE_WAY") {
      // Aún no lo despachan: se sigue intentando con la próxima posición.
      return;
    }
    if (error.status === 404) return linkClosed(error.message);
  }
}

function onPosition(coords) {
  const position = {
    lat: Number(coords.latitude.toFixed(6)),
    lng: Number(coords.longitude.toFixed(6)),
    accuracy: Math.round(coords.accuracy),
    heading: Number.isFinite(coords.heading) ? Math.round(coords.heading) : null,
  };
  state.position = position;
  map?.update({ courier: position });
  updateDistance();
  if (Date.now() - state.lastSentAt >= SEND_EVERY_MS) void send(position);
}

function startSharing() {
  if (!window.isSecureContext || !("geolocation" in navigator)) {
    state.phase = "error";
    state.message = "Este celular no permite compartir la ubicación desde aquí. Abre el enlace en Chrome o Safari.";
    redrawStatus();
    return;
  }
  state.phase = "locating";
  redrawStatus();
  void keepScreenOn();
  watchId = navigator.geolocation.watchPosition(
    (position) => onPosition(position.coords),
    (error) => {
      state.phase = error.code === error.PERMISSION_DENIED ? "denied" : "error";
      state.message =
        error.code === error.PERMISSION_DENIED
          ? "No diste permiso para usar tu ubicación. Actívalo en el navegador (candado junto a la dirección) y vuelve a intentar."
          : "No encontramos tu ubicación. Revisa que el GPS esté encendido.";
      stopSharing(false);
      redrawStatus();
    },
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
  );
  // Aunque no se mueva (semáforo, portería), el cliente ve que sigue activo.
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (state.phase === "sharing" && state.position && Date.now() - state.lastSentAt >= HEARTBEAT_MS) void send(state.position);
    redrawAgo();
  }, 1_000);
}

function stopSharing(redraw = true) {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
  if (redraw && state.phase === "sharing") {
    state.phase = "idle";
    redrawStatus();
  }
}

function redrawAgo() {
  const ago = root.querySelector("[data-ago]");
  if (ago && state.lastSentAt) ago.textContent = String(Math.max(0, Math.round((Date.now() - state.lastSentAt) / 1000)));
}

function linkClosed(message) {
  stopSharing(false);
  clearInterval(pollTimer);
  map?.destroy();
  map = null;
  render(root, invalidPage(message));
}

// ───────────────────────────── Eventos ─────────────────────────────

root.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.matches("[data-start]")) startSharing();
  if (button.matches("[data-show-qr]")) openPay();
  if (button.matches("[data-stop]")) stopSharing();
  if (button.matches("[data-ask-deliver]")) {
    render(
      button.closest("[data-deliver-area]"),
      html`<p class="text-center font-[700]">¿Entregaste el pedido${state.order.paid ? "" : " y cobraste"}?</p>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" class="btn btn-ghost min-h-13" data-cancel-deliver>No, todavía</button>
          <button type="button" class="btn btn-primary min-h-13" data-confirm-deliver>Sí, entregado</button>
        </div>`,
    );
  }
  if (button.matches("[data-cancel-deliver]")) await draw();
  if (button.matches("[data-confirm-deliver]")) {
    setBusy(button, true);
    try {
      await call("/delivered", { method: "POST" });
      stopSharing(false);
      clearInterval(pollTimer);
      state.phase = "delivered";
      state.order.status = "DELIVERED";
      await draw();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setBusy(button, false);
      if (error.status === 404) return linkClosed(error.message);
      state.phase = "error";
      state.message = error.message;
      redrawStatus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }
});

// Mientras el pedido no sale, se revisa cada 15 s si el negocio ya lo despachó.
async function waitForDispatch() {
  if (!state.order || state.order.status === "OUT_FOR_DELIVERY" || state.phase === "delivered") return;
  try {
    const order = await call("/");
    if (order.status !== state.order.status) {
      state.order = order;
      await draw();
    }
  } catch (error) {
    if (error.status === 404) return linkClosed(error.message);
  }
  setTimeout(waitForDispatch, 15_000);
}

document.addEventListener("visibilitychange", () => {
  // Al volver a la pantalla se pide de nuevo mantenerla encendida (el navegador lo suelta al ocultarla).
  if (!document.hidden && watchId !== null) void keepScreenOn();
});

// ───────────────────────────── Arranque ─────────────────────────────

if (!key) {
  render(root, invalidPage("Abre el enlace completo que te enviaron desde el negocio."));
} else {
  try {
    state.order = await call("/");
    await draw();
    setTimeout(waitForDispatch, 15_000);
  } catch (error) {
    render(root, invalidPage(error.status === 404 ? error.message : "No pudimos cargar la entrega. Revisa tu internet y recarga la página."));
  }
}
