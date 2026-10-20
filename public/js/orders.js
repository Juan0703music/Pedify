// Pedidos en vivo (secciones 6 y 7 del documento): recepción, seguimiento y actualización de estados.
// La lista se actualiza sola con Socket.IO y vuelve a consultar la API al reconectarse.
import { api, formatCOP, formatPhone } from "./api.js";
import { initPanel, renderNoBusiness } from "./dashboard.js";
import { onLive } from "./notifications.js";
import {
  customerWhatsapp,
  dateTimeLabel,
  deliveryLabel,
  elapsedLabel,
  itemsSummary,
  minutesSince,
  nextAction,
  PAYMENT_LABEL,
  STATUS,
  statusBadge,
  timeLabel,
} from "./order-ui.js";
import { html, icon, render, setBusy, toast } from "./ui.js";
import { openCourierLink } from "./courier-link.js";
import { deliveryMap, distanceLabel, distanceMeters } from "./map.js";

const COLUMNS = [
  { id: "new", title: "Nuevos", statuses: ["PENDING"], empty: "No hay pedidos por aceptar." },
  { id: "kitchen", title: "En cocina", statuses: ["CONFIRMED", "PREPARING"], empty: "Nada en preparación." },
  { id: "ready", title: "Listos y en camino", statuses: ["READY", "OUT_FOR_DELIVERY"], empty: "Nada listo por entregar." },
];

const ACTION_DONE = {
  CONFIRMED: "confirmado",
  PREPARING: "en preparación",
  READY: "listo",
  OUT_FOR_DELIVERY: "en camino",
  DELIVERED: "entregado",
  CANCELLED: "cancelado",
};

const state = {
  me: null,
  business: null,
  view: "active",
  column: null,
  active: [],
  /** Pedidos recién llegados (se resaltan unos segundos). */
  fresh: new Set(),
  history: { items: [], page: 0, totalPages: 1, total: 0, search: "", loading: false },
  detail: null,
};

let main;

// ───────────────────────────── Datos ─────────────────────────────

async function loadActive() {
  const page = await api("/orders");
  state.active = page.items;
}

async function loadHistory({ reset = false } = {}) {
  const history = state.history;
  if (history.loading) return;
  history.loading = true;
  const page = reset ? 1 : history.page + 1;
  const params = new URLSearchParams({ view: "history", page: String(page), pageSize: "20" });
  if (history.search) params.set("search", history.search);
  try {
    const result = await api(`/orders?${params}`);
    history.items = reset ? result.items : [...history.items, ...result.items];
    history.page = result.page;
    history.totalPages = result.totalPages;
    history.total = result.total;
  } finally {
    history.loading = false;
  }
}

const inColumn = (column) => state.active.filter((order) => column.statuses.includes(order.status));

// ───────────────────────────── Plantillas ─────────────────────────────

function isLate(order) {
  const minutes = minutesSince(order.createdAt);
  return (order.status === "PENDING" && minutes >= 10) || minutes >= 60;
}


function orderCard(order) {
  const action = nextAction(order);
  const fresh = state.fresh.has(order.id);
  return html`<article
    class="ticket ticket-shadow p-4 ${fresh ? "print-in" : ""}"
    data-order="${order.id}"
    aria-label="Pedido #${order.number}, ${STATUS[order.status].label}"
  >
    <header class="flex items-start justify-between gap-3">
      <div>
        <p class="display text-[2.125rem]">#${order.number}</p>
        <p class="mt-1 text-sm text-muted">
          ${timeLabel(order.createdAt)} ·
          <span data-elapsed="${order.createdAt}" class="${isLate(order) ? "font-[700] text-tomato" : ""}">${elapsedLabel(order.createdAt)}</span>
        </p>
      </div>
      <div class="grid justify-items-end gap-1.5">
        ${fresh ? html`<span class="badge bg-ink text-mustard">Nuevo</span>` : ""} ${statusBadge(order.status)}
      </div>
    </header>
    <p class="mt-3 font-[720]">${order.customerName}</p>
    <p class="flex items-center gap-1.5 text-sm text-muted">${deliveryLabel(order)}</p>
    ${order.deliveryAddress ? html`<p class="truncate text-sm" title="${order.deliveryAddress}">${order.deliveryAddress}</p>` : ""}
    <hr class="ticket-rule my-3" />
    ${itemsSummary(order)}
    ${order.notes ? html`<p class="mt-3 rounded-[8px] bg-mustard-soft px-2.5 py-1.5 text-sm"><span class="font-[700]">Nota:</span> ${order.notes}</p>` : ""}
    <hr class="ticket-rule my-3" />
    <div class="flex items-center justify-between gap-3">
      <span class="text-sm text-muted">
        ${PAYMENT_LABEL[order.paymentMethod] ?? "Pago"}${order.paidAt
          ? html` · <span class="font-[650] text-leaf">Pagado</span>`
          : order.paymentProof
            ? html` · <span class="font-[700] text-mustard-deep">Revisar comprobante</span>`
            : ""}
      </span>
      <span class="num text-lg font-[820]">${formatCOP(order.total)}</span>
    </div>
    <div class="mt-3 flex gap-2">
      ${action
        ? html`<button
            type="button"
            class="btn ${order.status === "PENDING" ? "btn-primary" : "btn-ink"} flex-1"
            data-advance="${order.id}"
            data-from="${order.status}"
            data-to="${action.status}"
          >
            ${icon(action.icon)} ${action.label}
          </button>`
        : ""}
      <button type="button" class="btn btn-ghost btn-icon" data-open="${order.id}" aria-label="Ver detalle del pedido #${order.number}" title="Ver detalle">
        ${icon("ellipsis")}
      </button>
    </div>
  </article>`;
}

function activeView() {
  const counts = COLUMNS.map((column) => inColumn(column).length);
  state.column ??= COLUMNS[counts.findIndex((count) => count > 0)]?.id ?? "new";
  if (state.active.length === 0) {
    return html`<div class="panel grid justify-items-center gap-3 px-6 py-14 text-center">
      <span class="grid h-14 w-14 place-items-center rounded-full bg-mustard-soft">${icon("receipt", "h-7 w-7")}</span>
      <p class="text-lg font-[720]">No hay pedidos en curso</p>
      <p class="max-w-[44ch] text-[0.9375rem] text-muted">
        Los pedidos nuevos aparecen aquí al instante, con un sonido si lo activaste. Los entregados y cancelados quedan en el historial.
      </p>
    </div>`;
  }
  return html`<div class="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:hidden" role="tablist" aria-label="Etapas">
      ${COLUMNS.map(
        (column, index) => html`<button
          type="button"
          role="tab"
          class="cat-chip flex-none gap-2"
          aria-selected="${column.id === state.column}"
          aria-current="${column.id === state.column}"
          data-column="${column.id}"
        >
          ${column.title} <span class="num rounded-full bg-mustard px-1.5 text-xs font-[800] text-ink ${counts[index] ? "" : "hidden"}">${counts[index]}</span>
        </button>`,
      )}
    </div>
    <div class="grid items-start gap-5 lg:grid-cols-3">
      ${COLUMNS.map((column, index) => {
        const orders = inColumn(column);
        return html`<section class="${column.id === state.column ? "" : "hidden"} grid gap-4 lg:grid" aria-labelledby="col-${column.id}">
          <h2 id="col-${column.id}" class="hidden items-center gap-2 text-base font-[760] lg:flex">
            ${column.title} <span class="badge num ${counts[index] ? "bg-ink text-paper" : "bg-paper text-muted"}">${counts[index]}</span>
          </h2>
          ${orders.length > 0
            ? orders.map(orderCard)
            : html`<p class="rounded-[12px] border-2 border-dashed border-line px-4 py-8 text-center text-sm text-muted">${column.empty}</p>`}
        </section>`;
      })}
    </div>`;
}

function historyRow(order) {
  return html`<li>
    <button type="button" class="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-ground sm:px-5" data-open="${order.id}">
      <span class="display w-16 flex-none text-[1.5rem]">#${order.number}</span>
      <span class="min-w-0 flex-1">
        <span class="block truncate font-[650]">${order.customerName}</span>
        <span class="block text-sm text-muted">${dateTimeLabel(order.createdAt)}</span>
      </span>
      <span class="flex items-center gap-2">
        ${order.paidAt ? html`<span class="badge bg-leaf-soft text-leaf">Pagado</span>` : ""} ${statusBadge(order.status)}
        <span class="num w-24 text-right font-[750]">${formatCOP(order.total)}</span>
      </span>
    </button>
  </li>`;
}

function historyView() {
  const { history } = state;
  return html`<div class="grid gap-4">
    <div class="input-group max-w-md">
      <label class="addon border-0 bg-transparent pr-0" for="history-search">${icon("search")}<span class="sr-only">Buscar pedidos</span></label>
      <input class="input" id="history-search" type="search" placeholder="Nombre, celular o número de pedido" value="${history.search}" data-history-search autocomplete="off" />
    </div>
    ${history.items.length === 0 && !history.loading
      ? html`<p class="panel p-6 text-center text-muted">${history.search ? `No encontramos pedidos con «${history.search}».` : "Aún no hay pedidos entregados ni cancelados."}</p>`
      : html`<ul class="panel divide-y divide-line overflow-hidden">${history.items.map(historyRow)}</ul>`}
    ${history.page < history.totalPages ? html`<button type="button" class="btn btn-ghost justify-self-center" data-more>Cargar más pedidos</button>` : ""}
  </div>`;
}

function page() {
  const activeCount = state.active.length;
  return html`<div class="grid grid-cols-[minmax(0,1fr)] gap-6">
      <header class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-[1.875rem] leading-tight font-[780] sm:text-[2.375rem]">Pedidos</h1>
          <p class="mt-1 flex items-center gap-2 text-[0.9375rem] text-muted" data-live-line>Conectando…</p>
        </div>
        <div class="flex rounded-[12px] border border-line bg-paper p-1" role="tablist" aria-label="Vista">
          <button type="button" role="tab" class="rounded-[9px] px-4 py-2 text-sm font-[680] aria-selected:bg-ink aria-selected:text-paper" aria-selected="${state.view === "active"}" data-view="active">
            En curso${activeCount ? html` <span class="num">(${activeCount})</span>` : ""}
          </button>
          <button type="button" role="tab" class="rounded-[9px] px-4 py-2 text-sm font-[680] aria-selected:bg-ink aria-selected:text-paper" aria-selected="${state.view === "history"}" data-view="history">
            Historial
          </button>
        </div>
      </header>
      <div data-view-body>${state.view === "active" ? activeView() : historyView()}</div>
    </div>
    <dialog id="order-detail" class="sheet" aria-labelledby="detail-title"></dialog>`;
}

// ───────────────────────────── Detalle ─────────────────────────────

function mapsLink(order) {
  // Con el punto que marcó el cliente, el mapa abre exacto; si no, se busca la dirección escrita.
  if (order.deliveryLat !== null && order.deliveryLat !== undefined) {
    return `https://www.google.com/maps/search/?api=1&query=${order.deliveryLat},${order.deliveryLng}`;
  }
  const query = [order.deliveryAddress, state.business.city].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

const COURIER_STATUSES = new Set(["CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"]);

/** Hace cuánto envió su posición el domiciliario ("hace 12 s", "hace 3 min"). */
function agoLabel(date) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 1000));
  return seconds < 60 ? `hace ${seconds} s` : `hace ${Math.round(seconds / 60)} min`;
}

/** Domicilio en camino: dónde va el domiciliario (si comparte su ubicación) y el enlace para él. */
function courierSection(order) {
  if (order.deliveryType !== "DELIVERY" || !COURIER_STATUSES.has(order.status)) return "";
  const courier = order.courier?.lat !== null && order.courier?.lat !== undefined ? order.courier : null;
  const destination = order.deliveryLat !== null && order.deliveryLat !== undefined ? { lat: order.deliveryLat, lng: order.deliveryLng } : null;
  const onTheWay = order.status === "OUT_FOR_DELIVERY";
  return html`<section aria-label="Domiciliario" class="grid gap-3 rounded-[12px] border border-line p-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="flex items-center gap-2 font-[740]">${icon("bike", "h-5 w-5")} Domiciliario</p>
      <button type="button" class="btn btn-ghost btn-sm" data-courier-link="${order.id}">${icon("qr-code", "h-4 w-4")} Enlace para el domiciliario</button>
    </div>
    ${onTheWay && courier
      ? html`<div class="delivery-map h-56" data-detail-map aria-label="Ubicación del domiciliario"></div>
          <p class="text-sm text-muted">
            Ubicación ${agoLabel(courier.updatedAt)}${destination ? html` · a <span class="num font-[700] text-ink">${distanceLabel(distanceMeters(courier, destination))}</span> del cliente` : ""}
          </p>`
      : html`<p class="text-sm text-muted">
          ${onTheWay
            ? "Aún no comparte su ubicación. Envíale el enlace para que el cliente lo vea en el mapa."
            : "Cuando lo despaches, envíale el enlace: verá la dirección y el cliente lo seguirá en el mapa."}
        </p>`}
  </section>`;
}

let detailMap = null;
/** Dibuja (o actualiza) el mapa del domiciliario en el detalle abierto. */
async function syncDetailMap(order) {
  const container = document.querySelector("#order-detail [data-detail-map]");
  if (!container) {
    detailMap?.destroy();
    detailMap = null;
    return;
  }
  const destination = order.deliveryLat !== null && order.deliveryLat !== undefined ? { lat: order.deliveryLat, lng: order.deliveryLng } : null;
  detailMap?.destroy();
  detailMap = null;
  try {
    detailMap = await deliveryMap(container, { destination, courier: order.courier });
  } catch {
    // Sin mapa: queda el texto con la distancia.
  }
}

function detailView(order) {
  const action = nextAction(order);
  const others = order.nextStatuses.filter((status) => status !== action?.status && status !== "CANCELLED");
  const canCancel = order.nextStatuses.includes("CANCELLED");
  const greeting = `Hola, ${order.customerName.split(" ")[0]}. Te escribimos de ${state.business.name} sobre tu pedido #${order.number}.`;
  const row = (label, value, strong = false) => html`<div class="flex justify-between gap-4 ${strong ? "text-[1.0625rem] font-[820]" : ""}">
    <dt>${label}</dt><dd class="num">${value}</dd>
  </div>`;

  return html`<div class="flex min-h-0 flex-1 flex-col">
    <header class="flex items-center gap-3 border-b border-line py-3 pr-3 pl-5">
      <h2 id="detail-title" class="text-lg font-[780] outline-none" tabindex="-1">Pedido #${order.number}</h2>
      ${statusBadge(order.status)}
      <button type="button" class="btn btn-quiet btn-icon ml-auto" data-close-detail aria-label="Cerrar">${icon("x")}</button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5">
      <div class="grid gap-6">
        <section aria-label="Cliente" class="grid gap-2">
          <p class="text-lg font-[740]">${order.customerName}</p>
          ${/^57\d{10}$/.test(order.customerPhone)
            ? html`<p class="num text-muted">${formatPhone(order.customerPhone)}</p>
                <div class="flex flex-wrap gap-2">
                  <a class="btn btn-ghost btn-sm" href="tel:+${order.customerPhone}">${icon("phone", "h-4 w-4")} Llamar</a>
                  <a class="btn btn-ghost btn-sm" href="${customerWhatsapp(order.customerPhone, greeting)}" target="_blank" rel="noopener">
                    ${icon("message-circle", "h-4 w-4 text-[#128c4b]")} Escribir por WhatsApp
                  </a>
                </div>`
            : html`<p class="text-sm text-muted">Los datos personales de este cliente se eliminaron a su solicitud.</p>`}
        </section>

        <section aria-label="Entrega" class="grid gap-1.5 rounded-[12px] bg-ground p-4">
          <p class="flex items-center gap-2 font-[700]">${deliveryLabel(order)}</p>
          ${order.deliveryAddress
            ? html`<p>${order.deliveryAddress}</p>
                ${order.addressReferences ? html`<p class="text-sm text-muted">Referencias: ${order.addressReferences}</p>` : ""}
                <a class="mt-1 inline-flex w-fit items-center gap-1.5 text-sm font-[650]" href="${mapsLink(order)}" target="_blank" rel="noopener">
                  ${icon("map-pin", "h-4 w-4")} Ver en el mapa
                </a>`
            : html`<p class="text-sm text-muted">El cliente recoge en el local.</p>`}
        </section>

        ${courierSection(order)}

        <section aria-label="Productos">
          <ul class="divide-y divide-line">
            ${order.items.map(
              (item) => html`<li class="flex gap-3 py-2.5">
                <span class="num w-8 flex-none font-[760]">${item.quantity}×</span>
                <span class="min-w-0 flex-1">
                  <span class="block font-[620]">${item.productName}</span>
                  <span class="num block text-sm text-muted">${formatCOP(item.unitPrice)} c/u</span>
                </span>
                <span class="num font-[700]">${formatCOP(item.subtotal)}</span>
              </li>`,
            )}
          </ul>
          <dl class="mt-2 grid gap-1 border-t border-dashed border-line-strong pt-3">
            ${row("Subtotal", formatCOP(order.subtotal))}
            ${order.deliveryFee > 0 ? row("Domicilio", formatCOP(order.deliveryFee)) : ""}
            ${order.discount > 0 ? row("Descuento", `-${formatCOP(order.discount)}`) : ""}
            ${row("Total", formatCOP(order.total), true)}
          </dl>
        </section>

        ${order.notes ? html`<p class="rounded-[10px] bg-mustard-soft px-3.5 py-3"><span class="font-[700]">Nota del cliente:</span> ${order.notes}</p>` : ""}

        <section aria-label="Pago" class="grid gap-4 rounded-[12px] border ${order.paymentProof && !order.paidAt ? "border-mustard-deep/40 bg-mustard-soft/40" : "border-line"} p-4">
          <div class="flex items-center justify-between gap-4">
            <span>
              <span class="block font-[650]">Pago: ${PAYMENT_LABEL[order.paymentMethod] ?? "—"}${order.paymentProof ? " · por adelantado" : ""}</span>
              <span class="block text-sm text-muted">
                ${order.paidAt
                  ? `Pagado · ${dateTimeLabel(order.paidAt)}`
                  : order.paymentProof
                    ? "Revisa en tu app que llegó el valor y márcalo como pagado."
                    : "Marca cuando recibas el pago."}
              </span>
            </span>
            <label class="flex items-center gap-2.5">
              <span class="text-sm font-[620]">Pagado</span>
              <input type="checkbox" role="switch" class="switch" data-paid="${order.id}" ${order.paidAt ? "checked" : ""} ${order.status === "CANCELLED" ? "disabled" : ""} />
            </label>
          </div>
          ${order.paymentProof
            ? html`<a
                class="group flex items-center gap-3 rounded-[10px] border border-line bg-paper p-2.5 no-underline hover:border-ink"
                href="/api/v1/orders/${order.id}/payment-proof"
                target="_blank"
                rel="noopener"
              >
                <img src="/api/v1/orders/${order.id}/payment-proof" alt="Comprobante de pago del pedido #${order.number}" class="h-20 w-14 flex-none rounded-[6px] border border-line object-cover object-top" loading="lazy" />
                <span class="min-w-0 flex-1">
                  <span class="block font-[700]">Comprobante del cliente</span>
                  <span class="block text-sm text-muted">Subido ${dateTimeLabel(order.paymentProof.createdAt)} · debe ser de <span class="num font-[650] text-ink">${formatCOP(order.total)}</span></span>
                </span>
                <span class="flex flex-none items-center gap-1 text-sm font-[650] text-ink">Ver ${icon("external-link", "h-4 w-4")}</span>
              </a>`
            : ""}
        </section>

        ${order.status === "CANCELLED" && order.cancelReason
          ? html`<p class="rounded-[10px] bg-tomato-soft px-3.5 py-3 text-tomato"><span class="font-[700]">Motivo de cancelación:</span> ${order.cancelReason}</p>`
          : ""}

        <section aria-labelledby="timeline-title">
          <h3 id="timeline-title" class="mb-2 font-[740]">Seguimiento</h3>
          <ol class="grid gap-2.5 border-l-2 border-line pl-4">
            ${order.statusHistory.map(
              (entry) => html`<li class="relative">
                <span class="absolute top-1.5 -left-[1.4rem] h-2.5 w-2.5 rounded-full ${entry.toStatus === "CANCELLED" ? "bg-tomato" : "bg-ink"}"></span>
                <p class="font-[650]">${entry.fromStatus ? STATUS[entry.toStatus].label : "Solicitud creada en la tienda"}</p>
                <p class="text-sm text-muted">${dateTimeLabel(entry.createdAt)}${entry.changedBy ? ` · ${entry.changedBy.name}` : ""}</p>
              </li>`,
            )}
          </ol>
        </section>
      </div>
    </div>

    ${order.nextStatuses.length > 0
      ? html`<footer class="grid gap-2 border-t border-line px-5 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))]">
          <div class="grid gap-2" data-detail-actions>
            ${action
              ? html`<button type="button" class="btn ${order.status === "PENDING" ? "btn-primary" : "btn-ink"} w-full" data-advance="${order.id}" data-from="${order.status}" data-to="${action.status}">
                  ${icon(action.icon)} ${action.label}
                </button>`
              : ""}
            <div class="flex flex-wrap gap-2">
              ${others.map(
                (status) => html`<button type="button" class="btn btn-ghost btn-sm" data-advance="${order.id}" data-from="${order.status}" data-to="${status}">
                  Pasar a «${STATUS[status].label}»
                </button>`,
              )}
              ${canCancel ? html`<button type="button" class="btn btn-quiet btn-sm ml-auto text-tomato" data-ask-cancel>Cancelar pedido</button>` : ""}
            </div>
          </div>
          ${canCancel
            ? html`<form class="hidden gap-2" data-cancel-form novalidate>
                <label class="label" for="cancel-reason">¿Por qué se cancela? <span class="font-normal text-muted">(opcional)</span></label>
                <input class="input" id="cancel-reason" name="reason" maxlength="200" placeholder="Ej.: el cliente no confirmó, se agotó la salchicha" />
                <div class="flex justify-end gap-2">
                  <button type="button" class="btn btn-ghost btn-sm" data-keep-order>No cancelar</button>
                  <button type="submit" class="btn btn-danger btn-sm" data-from="${order.status}">Cancelar pedido #${order.number}</button>
                </div>
              </form>`
            : ""}
        </footer>`
      : ""}
  </div>`;
}

async function openDetail(id) {
  const dialog = document.getElementById("order-detail");
  try {
    state.detail = await api(`/orders/${id}`);
  } catch (error) {
    toast(error.message, "error");
    return;
  }
  render(dialog, detailView(state.detail));
  if (!dialog.open) dialog.showModal();
  dialog.querySelector("#detail-title")?.focus();
  void syncDetailMap(state.detail);
}

async function refreshDetail() {
  const dialog = document.getElementById("order-detail");
  if (!dialog.open || !state.detail) return;
  try {
    state.detail = await api(`/orders/${state.detail.id}`);
    render(dialog, detailView(state.detail));
    void syncDetailMap(state.detail);
  } catch {
    // Se mantiene la versión en pantalla.
  }
}

// Con un domicilio en camino abierto, la posición del domiciliario se actualiza cada 10 s.
setInterval(async () => {
  const dialog = document.getElementById("order-detail");
  if (!dialog?.open || state.detail?.status !== "OUT_FOR_DELIVERY" || document.hidden) return;
  try {
    const fresh = await api(`/orders/${state.detail.id}`);
    const hadMap = Boolean(detailMap);
    const hasCourier = fresh.courier?.lat !== null && fresh.courier?.lat !== undefined;
    if (fresh.status !== state.detail.status || hadMap !== hasCourier) {
      state.detail = fresh;
      render(dialog, detailView(fresh));
      void syncDetailMap(fresh);
    } else if (hasCourier) {
      state.detail = fresh;
      detailMap?.update({ courier: fresh.courier });
    }
  } catch {
    // Sin conexión: se intenta en el siguiente turno.
  }
}, 10_000);

// ───────────────────────────── Acciones ─────────────────────────────

function draw() {
  render(main, page());
  updateLiveLine(currentLive);
}

function drawBody() {
  const body = main.querySelector("[data-view-body]");
  if (!body) return draw();
  render(body, state.view === "active" ? activeView() : historyView());
  const activeTab = main.querySelector('[data-view="active"]');
  if (activeTab) render(activeTab, html`En curso${state.active.length ? html` <span class="num">(${state.active.length})</span>` : ""}`);
}

async function changeStatus(orderId, from, to, reason) {
  const result = await api(`/orders/${orderId}/status`, { method: "PATCH", body: { status: to, from, ...(reason ? { reason } : {}) } });
  const index = state.active.findIndex((order) => order.id === orderId);
  if (["DELIVERED", "CANCELLED"].includes(result.status)) {
    if (index !== -1) state.active.splice(index, 1);
  } else if (index !== -1) {
    state.active[index] = { ...state.active[index], ...result };
  }
  state.fresh.delete(orderId);
  return result;
}

async function advance(button) {
  const { advance: orderId, from, to } = button.dataset;
  setBusy(button, true);
  try {
    const result = await changeStatus(orderId, from, to);
    toast(`Pedido #${result.number} ${ACTION_DONE[to]}.`);
    drawBody();
    if (state.detail?.id === orderId) {
      state.detail = result;
      render(document.getElementById("order-detail"), detailView(result));
      void syncDetailMap(result);
    }
    // Al despachar un domicilio: el enlace para que el domiciliario comparta su ubicación.
    if (to === "OUT_FOR_DELIVERY") void openCourierLink(result);
  } catch (error) {
    setBusy(button, false);
    toast(error.message, "error");
    await loadActive();
    drawBody();
    refreshDetail();
  }
}

let currentLive = "connecting";
function updateLiveLine(status) {
  currentLive = status;
  const line = main?.querySelector("[data-live-line]");
  if (!line) return;
  const text = {
    online: "En vivo: los pedidos nuevos aparecen solos.",
    connecting: "Conectando…",
    offline: "Sin conexión en vivo. Reintentando…",
    unauthorized: "Tu sesión venció. Recarga la página.",
  }[status];
  const dot = { online: "bg-leaf", connecting: "bg-ink-soft", offline: "bg-mustard", unauthorized: "bg-tomato" }[status];
  render(line, html`<span class="h-2 w-2 rounded-full ${dot}" aria-hidden="true"></span>${text}`);
}

function bindPage() {
  main.addEventListener("click", async (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.matches("[data-view]")) {
      state.view = target.dataset.view;
      if (state.view === "history" && state.history.page === 0) {
        drawBody();
        await loadHistory({ reset: true });
      }
      draw();
    }
    if (target.matches("[data-column]")) {
      state.column = target.dataset.column;
      drawBody();
    }
    if (target.matches("[data-advance]")) advance(target);
    if (target.matches("[data-open]")) openDetail(target.dataset.open);
    if (target.matches("[data-more]")) {
      setBusy(target, true);
      await loadHistory();
      drawBody();
    }
  });

  let searchTimer;
  main.addEventListener("input", (event) => {
    if (!event.target.matches("[data-history-search]")) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      state.history.search = event.target.value.trim();
      await loadHistory({ reset: true });
      const position = event.target.selectionStart;
      drawBody();
      const input = main.querySelector("[data-history-search]");
      input.focus();
      input.setSelectionRange(position, position);
    }, 300);
  });

  const dialog = document.getElementById("order-detail");
  dialog.addEventListener("click", async (event) => {
    if (event.target === dialog) return dialog.close();
    const target = event.target.closest("button");
    if (!target) return;
    if (target.matches("[data-close-detail]")) dialog.close();
    if (target.matches("[data-advance]")) advance(target);
    if (target.matches("[data-courier-link]") && state.detail) void openCourierLink(state.detail);
    if (target.matches("[data-ask-cancel]")) {
      dialog.querySelector("[data-detail-actions]").classList.add("hidden");
      const form = dialog.querySelector("[data-cancel-form]");
      form.classList.replace("hidden", "grid");
      form.elements.reason.focus();
    }
    if (target.matches("[data-keep-order]")) {
      dialog.querySelector("[data-cancel-form]").classList.replace("grid", "hidden");
      dialog.querySelector("[data-detail-actions]").classList.remove("hidden");
    }
  });

  dialog.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-cancel-form]");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    setBusy(button, true);
    try {
      const result = await changeStatus(state.detail.id, state.detail.status, "CANCELLED", form.elements.reason.value.trim());
      state.detail = result;
      render(dialog, detailView(result));
      drawBody();
      toast(`Pedido #${result.number} cancelado.`);
    } catch (error) {
      setBusy(button, false);
      toast(error.message, "error");
    }
  });

  dialog.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-paid]");
    if (!input) return;
    input.disabled = true;
    try {
      const result = await api(`/orders/${input.dataset.paid}/payment`, { method: "PATCH", body: { paid: input.checked } });
      state.detail = result;
      const index = state.active.findIndex((order) => order.id === result.id);
      if (index !== -1) state.active[index] = { ...state.active[index], paidAt: result.paidAt };
      render(dialog, detailView(result));
      drawBody();
      toast(result.paidAt ? `Pedido #${result.number} marcado como pagado.` : `Pedido #${result.number} sin pago registrado.`);
    } catch (error) {
      input.checked = !input.checked;
      input.disabled = false;
      toast(error.message, "error");
    }
  });
  dialog.addEventListener("close", () => {
    state.detail = null;
    detailMap?.destroy();
    detailMap = null;
  });

  // Tiempo transcurrido: se actualiza cada 30 segundos sin redibujar.
  setInterval(() => {
    main.querySelectorAll("[data-elapsed]").forEach((element) => (element.textContent = elapsedLabel(element.dataset.elapsed)));
  }, 30_000);
}

function bindLive() {
  onLive("status", updateLiveLine);
  const reload = async () => {
    try {
      await loadActive();
      drawBody();
    } catch {
      // Sin conexión: se reintenta al reconectar.
    }
  };
  onLive("resync", () => {
    reload();
    refreshDetail();
  });
  onLive("created", async (order) => {
    state.fresh.add(order.orderId);
    state.column = "new";
    await reload();
    setTimeout(() => {
      state.fresh.delete(order.orderId);
      main.querySelector(`[data-order="${order.orderId}"]`)?.classList.remove("print-in");
    }, 20_000);
  });
  onLive("updated", async (update) => {
    await reload();
    if (state.detail?.id === update.orderId) refreshDetail();
    if (update.changedBy && update.changedBy !== state.me.user.id) {
      toast(`Pedido #${update.number}: ${STATUS[update.status]?.label ?? update.status}.`, "info");
    }
  });
}

// ───────────────────────────── Arranque ─────────────────────────────

const context = await initPanel("pedidos");
if (context) {
  main = context.main;
  if (!context.business) {
    renderNoBusiness(main);
  } else {
    state.me = context.me;
    state.business = context.business;
    render(main, html`<div class="grid gap-6" aria-busy="true" aria-label="Cargando pedidos"><div class="skeleton h-12 w-48"></div><div class="grid gap-5 lg:grid-cols-3"><div class="skeleton h-80"></div><div class="skeleton h-80"></div><div class="skeleton h-80"></div></div></div>`);
    try {
      await loadActive();
      draw();
      bindPage();
      bindLive();
      const params = new URLSearchParams(location.search);
      if (params.get("pedido")) openDetail(params.get("pedido"));
    } catch (error) {
      render(main, html`<p class="text-tomato">${error.message}</p>`);
    }
  }
}
