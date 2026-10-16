// Clientes (sección 6 del documento): consultar información e historial de pedidos.
// Solo el propietario ve esta página (datos personales y compras de los clientes).
import { api, formatCOP, formatPhone } from "./api.js";
import { initPanel, renderNoBusiness } from "./dashboard.js";
import { customerWhatsapp, dateTimeLabel, statusBadge } from "./order-ui.js";
import { html, icon, initials, render, setBusy, toast } from "./ui.js";

const state = { business: null, items: [], page: 0, totalPages: 1, total: 0, search: "", loading: false };
let main;

async function load({ reset = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  const page = reset ? 1 : state.page + 1;
  const params = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (state.search) params.set("search", state.search);
  try {
    const result = await api(`/customers?${params}`);
    state.items = reset ? result.items : [...state.items, ...result.items];
    state.page = result.page;
    state.totalPages = result.totalPages;
    state.total = result.total;
  } finally {
    state.loading = false;
  }
}

function lastOrderLabel(value) {
  if (!value) return "Sin pedidos";
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days === 0) return "Pidió hoy";
  if (days === 1) return "Pidió ayer";
  if (days < 30) return `Pidió hace ${days} días`;
  return `Último pedido: ${dateTimeLabel(value).split(" · ")[0]}`;
}

function customerRow(customer) {
  return html`<li>
    <button type="button" class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ground sm:px-5" data-customer="${customer.id}">
      <span class="grid h-10 w-10 flex-none place-items-center rounded-full bg-ground text-sm font-[800]" aria-hidden="true">${initials(customer.name)}</span>
      <span class="min-w-0 flex-1">
        <span class="block truncate font-[650]">${customer.name}</span>
        <span class="num block text-sm text-muted">${formatPhone(customer.phone)} · ${lastOrderLabel(customer.lastOrderAt)}</span>
      </span>
      <span class="hidden text-right sm:block">
        <span class="num block font-[750]">${formatCOP(customer.spent)}</span>
        <span class="block text-sm text-muted">${customer.orders} ${customer.orders === 1 ? "pedido" : "pedidos"}</span>
      </span>
      ${icon("arrow-right", "h-4 w-4 text-muted")}
    </button>
  </li>`;
}

function listBody() {
  if (state.items.length === 0 && !state.loading) {
    return state.search
      ? html`<p class="panel p-6 text-center text-muted">No encontramos clientes con «${state.search}».</p>`
      : html`<div class="panel grid justify-items-center gap-3 px-6 py-14 text-center">
          <span class="grid h-14 w-14 place-items-center rounded-full bg-mustard-soft">${icon("users", "h-7 w-7")}</span>
          <p class="text-lg font-[720]">Aún no tienes clientes</p>
          <p class="max-w-[44ch] text-[0.9375rem] text-muted">
            Cada persona que pide en tu tienda queda aquí con su celular, sus direcciones y su historial de pedidos.
          </p>
        </div>`;
  }
  return html`<ul class="panel divide-y divide-line overflow-hidden">${state.items.map(customerRow)}</ul>
    ${state.page < state.totalPages ? html`<button type="button" class="btn btn-ghost justify-self-center" data-more>Cargar más clientes</button>` : ""}`;
}

function page() {
  return html`<div class="grid grid-cols-[minmax(0,1fr)] gap-6">
      <header>
        <h1 class="text-[1.875rem] leading-tight font-[780] sm:text-[2.375rem]">Clientes</h1>
        <p class="mt-1 text-[0.9375rem] text-muted" data-total>${state.total} ${state.total === 1 ? "cliente" : "clientes"}</p>
      </header>
      <div class="input-group max-w-md">
        <label class="addon border-0 bg-transparent pr-0" for="customer-search">${icon("search")}<span class="sr-only">Buscar clientes</span></label>
        <input class="input" id="customer-search" type="search" placeholder="Nombre o celular" autocomplete="off" data-search />
      </div>
      <div class="grid gap-4" data-list>${listBody()}</div>
    </div>
    <dialog id="customer-detail" class="sheet" aria-labelledby="customer-title"></dialog>`;
}

function detailView(customer) {
  const greeting = `Hola, ${customer.name.split(" ")[0]}. Te escribimos de ${state.business.name}.`;
  const stat = (label, value) => html`<div class="rounded-[12px] bg-ground px-3 py-3">
    <dt class="text-xs font-[620] text-muted">${label}</dt>
    <dd class="num mt-1 text-lg font-[800]">${value}</dd>
  </div>`;
  return html`<div class="flex min-h-0 flex-1 flex-col">
    <header class="flex items-center gap-3 border-b border-line py-3 pr-3 pl-5">
      <h2 id="customer-title" class="min-w-0 truncate text-lg font-[780] outline-none" tabindex="-1">${customer.name}</h2>
      <button type="button" class="btn btn-quiet btn-icon ml-auto" data-close aria-label="Cerrar">${icon("x")}</button>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5">
      <div class="grid gap-6">
        <div class="grid gap-2">
          <p class="num text-muted">${formatPhone(customer.phone)} · cliente desde ${dateTimeLabel(customer.createdAt).split(" · ")[0]}</p>
          <div class="flex flex-wrap gap-2">
            <a class="btn btn-ghost btn-sm" href="tel:+${customer.phone}">${icon("phone", "h-4 w-4")} Llamar</a>
            <a class="btn btn-ghost btn-sm" href="${customerWhatsapp(customer.phone, greeting)}" target="_blank" rel="noopener">
              ${icon("message-circle", "h-4 w-4 text-[#128c4b]")} Escribir por WhatsApp
            </a>
          </div>
        </div>
        <dl class="grid grid-cols-3 gap-2">
          ${stat("Pedidos", String(customer.stats.orders))} ${stat("Compras", formatCOP(customer.stats.spent))}
          ${stat("Cancelados", String(customer.stats.cancelled))}
        </dl>
        <section aria-labelledby="addresses-title">
          <h3 id="addresses-title" class="mb-2 font-[740]">Direcciones</h3>
          ${customer.addresses.length === 0
            ? html`<p class="text-sm text-muted">Solo ha pedido para recoger en el local.</p>`
            : html`<ul class="grid gap-2">
                ${customer.addresses.map(
                  (address) => html`<li class="flex gap-2.5 rounded-[10px] border border-line px-3.5 py-2.5">
                    ${icon("map-pin", "mt-0.5 h-4 w-4 text-muted")}
                    <span><span class="block">${address.address}</span>${address.references ? html`<span class="block text-sm text-muted">${address.references}</span>` : ""}</span>
                  </li>`,
                )}
              </ul>`}
        </section>
        <section aria-labelledby="history-title">
          <h3 id="history-title" class="mb-2 font-[740]">Historial de pedidos</h3>
          <ul class="divide-y divide-line">
            ${customer.orders.map(
              (order) => html`<li>
                <a class="flex items-center gap-3 py-2.5 text-ink no-underline hover:bg-ground" href="/panel/pedidos?pedido=${order.id}">
                  <span class="display w-14 flex-none text-[1.25rem]">#${order.number}</span>
                  <span class="min-w-0 flex-1 text-sm text-muted">${dateTimeLabel(order.createdAt)}</span>
                  ${statusBadge(order.status)}
                  <span class="num w-20 text-right font-[700]">${formatCOP(order.total)}</span>
                </a>
              </li>`,
            )}
          </ul>
        </section>
        <section class="grid gap-2 rounded-[12px] border border-line p-4" aria-labelledby="erase-title">
          <h3 id="erase-title" class="font-[740]">Eliminar los datos de este cliente</h3>
          <p class="text-sm text-muted">
            Si el cliente lo pide (Ley 1581 de 2012), se borran su nombre, celular y direcciones. Sus pedidos se conservan sin datos
            personales para tus cifras y tu contabilidad. No se puede deshacer.
          </p>
          <div class="flex flex-wrap items-center gap-2" data-erase-actions>
            <button type="button" class="btn btn-danger btn-sm" data-ask-erase>${icon("trash-2", "h-4 w-4")} Eliminar datos</button>
          </div>
          <div class="hidden flex-wrap items-center gap-2 rounded-[10px] bg-tomato-soft px-3 py-2.5" data-erase-confirm>
            <p class="mr-auto text-sm font-medium text-tomato">¿Eliminar los datos de ${customer.name}?</p>
            <button type="button" class="btn btn-ghost btn-sm" data-cancel-erase>Cancelar</button>
            <button type="button" class="btn btn-danger btn-sm" data-confirm-erase="${customer.id}">Sí, eliminar</button>
          </div>
        </section>
      </div>
    </div>
  </div>`;
}

async function openCustomer(id) {
  const dialog = document.getElementById("customer-detail");
  try {
    const customer = await api(`/customers/${id}`);
    render(dialog, detailView(customer));
    dialog.showModal();
    dialog.querySelector("#customer-title")?.focus();
  } catch (error) {
    toast(error.message, "error");
  }
}

function drawList() {
  render(main.querySelector("[data-list]"), listBody());
  main.querySelector("[data-total]").textContent = `${state.total} ${state.total === 1 ? "cliente" : "clientes"}`;
}

function bindPage() {
  main.addEventListener("click", async (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.matches("[data-customer]")) openCustomer(target.dataset.customer);
    if (target.matches("[data-more]")) {
      setBusy(target, true);
      await load();
      drawList();
    }
  });
  let timer;
  main.addEventListener("input", (event) => {
    if (!event.target.matches("[data-search]")) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      state.search = event.target.value.trim();
      await load({ reset: true });
      drawList();
    }, 300);
  });
  const dialog = document.getElementById("customer-detail");
  dialog.addEventListener("click", async (event) => {
    if (event.target === dialog || event.target.closest("[data-close]")) return dialog.close();
    const target = event.target.closest("button");
    if (!target) return;
    const toggle = (confirming) => {
      dialog.querySelector("[data-erase-actions]").classList.toggle("hidden", confirming);
      dialog.querySelector("[data-erase-confirm]").classList.toggle("hidden", !confirming);
      dialog.querySelector("[data-erase-confirm]").classList.toggle("flex", confirming);
    };
    if (target.matches("[data-ask-erase]")) {
      toggle(true);
      dialog.querySelector("[data-cancel-erase]").focus();
    }
    if (target.matches("[data-cancel-erase]")) toggle(false);
    if (target.matches("[data-confirm-erase]")) {
      setBusy(target, true);
      try {
        await api(`/customers/${target.dataset.confirmErase}`, { method: "DELETE" });
        dialog.close();
        toast("Eliminamos los datos personales del cliente.");
        await load({ reset: true });
        drawList();
      } catch (error) {
        setBusy(target, false);
        toast(error.message, "error");
      }
    }
  });
}

const context = await initPanel("clientes");
if (context) {
  main = context.main;
  if (!context.business) {
    renderNoBusiness(main);
  } else if (context.business.role !== "OWNER") {
    render(
      main,
      html`<p class="panel mx-auto mt-6 flex max-w-lg items-start gap-3 p-6 text-[0.9375rem]">
        ${icon("lock", "mt-0.5")} Solo el propietario del negocio puede ver la información de los clientes.
      </p>`,
    );
  } else {
    state.business = context.business;
    try {
      await load({ reset: true });
      render(main, page());
      bindPage();
    } catch (error) {
      render(main, html`<p class="text-tomato">${error.message}</p>`);
    }
  }
}
