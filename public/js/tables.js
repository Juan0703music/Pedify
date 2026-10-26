// Hoja para imprimir los QR de las mesas (Mi tienda → Pedidos desde la mesa): una tarjeta por mesa con
// su número y el QR que abre la tienda lista para comer ahí, más una general para el mostrador.
import { api, redirectToLogin } from "./api.js";
import { html, icon, render } from "./ui.js";

const root = document.getElementById("app");
const MAX_TABLES = 60;

/** Tarjeta para recortar: negocio, mesa, QR y cómo usarlo. */
function card(business, { table = null } = {}) {
  const query = table ? `mesa=${encodeURIComponent(table)}` : "local=1";
  return html`<article class="table-card">
    <p class="flex items-center justify-center gap-2 text-[0.9375rem] font-[720]">
      ${business.logoUrl ? html`<img src="${business.logoUrl}" alt="" class="h-7 w-7 rounded-[6px] object-cover" />` : ""}${business.name}
    </p>
    ${table
      ? html`<p class="mt-2 text-[0.8125rem] font-[700] tracking-[0.18em] text-muted uppercase">Mesa</p>
          <p class="display text-[4.25rem] leading-[0.85]">${table}</p>`
      : html`<p class="display mt-3 text-[2.25rem] leading-[0.9]">Pide desde<br />tu mesa</p>`}
    <img src="/api/v1/businesses/current/qr?format=svg&${query}" alt="Código QR ${table ? `de la mesa ${table}` : "del local"}" class="mx-auto mt-3 h-44 w-44" width="176" height="176" />
    <p class="mt-3 text-[0.9375rem] leading-snug font-[650]">Escanea con la cámara y pide desde tu celular</p>
    <p class="mt-1 text-[0.8125rem] text-muted">${table ? "Te lo llevamos a la mesa." : "Al pedir, escribe el número de tu mesa."}</p>
    <p class="mt-3 flex items-center justify-center gap-1.5 text-[0.75rem] text-muted">
      <img src="/assets/icons/logo.svg" alt="" class="h-4 w-4" width="16" height="16" /> Pedidos con Pedify
    </p>
  </article>`;
}

function sheet(business, count) {
  return html`<div class="no-print sticky top-0 z-10 border-b border-line bg-paper/95 backdrop-blur">
      <div class="mx-auto flex max-w-[60rem] flex-wrap items-center gap-3 px-4 py-3">
        <a class="btn btn-quiet btn-sm" href="/panel/tienda#mesas">${icon("arrow-right", "h-4 w-4 rotate-180")} Mi tienda</a>
        <h1 class="mr-auto text-lg font-[760]">QR de las mesas</h1>
        <label class="flex items-center gap-2 text-sm font-[650]" for="t-count">
          Mesas
          <input class="input num h-10 w-20" id="t-count" type="number" min="1" max="${MAX_TABLES}" value="${count}" data-count />
        </label>
        <button type="button" class="btn btn-primary" data-print>${icon("download")} Imprimir</button>
      </div>
      <p class="mx-auto max-w-[60rem] px-4 pb-3 text-sm text-muted">
        Imprime en hojas tamaño carta, recorta cada tarjeta y pégala en su mesa. El primero es el general, para el mostrador o la entrada.
      </p>
    </div>
    <div class="table-sheet">${card(business)} ${Array.from({ length: count }, (_, index) => card(business, { table: String(index + 1) }))}</div>`;
}

let business;
try {
  business = await api("/businesses/current");
} catch (error) {
  if (error.status === 401) redirectToLogin();
  else render(root, html`<p class="p-6 text-tomato">${error.message}</p>`);
}

if (business) {
  const requested = Number(new URLSearchParams(location.search).get("n"));
  let count = Math.min(MAX_TABLES, Math.max(1, Math.trunc(requested) || 10));
  const draw = () => {
    render(root, sheet(business, count));
    document.title = `QR de ${count} ${count === 1 ? "mesa" : "mesas"} · ${business.name}`;
  };
  draw();
  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-print]")) window.print();
  });
  root.addEventListener("change", (event) => {
    const input = event.target.closest("[data-count]");
    if (!input) return;
    count = Math.min(MAX_TABLES, Math.max(1, Math.trunc(Number(input.value)) || 1));
    history.replaceState(null, "", `?n=${count}`);
    draw();
    root.querySelector("[data-count]").focus();
  });
}
