// Carrito y pedido de la tienda pública (secciones 8 y 9 del documento de arquitectura).
// El navegador solo envía productos, cantidades y datos de entrega: el servidor recalcula precios,
// domicilio y total y guarda el pedido (PENDING): le llega directo al panel del negocio. Después,
// el cliente sigue el estado de su pedido en vivo (recibido, en preparación, listo, en camino).
// Si paga por Nequi, Daviplata o transferencia y el negocio configuró su QR o llave, paga antes de
// enviar el pedido y sube el pantallazo del comprobante (el negocio lo revisa en el panel).
import { formatCOP, formatPhone } from "./api.js";
import { checkImageFile, clearFieldErrors, copyText, formAlert, html, icon, raw, render, setBusy, showErrors } from "./ui.js";
import { currentPosition, deliveryMap, distanceLabel, distanceMeters, pickerMap } from "./map.js";

export const PAYMENT_LABEL = {
  CASH: "Efectivo",
  NEQUI: "Nequi",
  DAVIPLATA: "Daviplata",
  BANK_TRANSFER: "Transferencia",
  CARD: "Tarjeta (datáfono)",
};

const MAX_QUANTITY = 99;
const CART_TTL_MS = 24 * 60 * 60 * 1000;
/** El seguimiento del último pedido se conserva en este dispositivo hasta 12 horas. */
const ORDER_TTL_MS = 12 * 60 * 60 * 1000;
const FINAL_STATUSES = new Set(["DELIVERED", "CANCELLED"]);

// ───────────────────────────── Almacenamiento local ─────────────────────────────
// Solo comodidades de este dispositivo: el carrito, los datos del cliente y el último pedido.

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Modo privado o almacenamiento lleno: el carrito funciona igual mientras la página esté abierta.
  }
}

/** Clave de idempotencia (sirve también en http://, donde `crypto.randomUUID` no existe). */
function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ───────────────────────────── Carrito ─────────────────────────────

export function initCart({ store, slug, root, orderable = true }) {
  const keys = { cart: `pedify:cart:${slug}`, order: `pedify:order:${slug}`, customer: "pedify:customer" };
  save(`pedify:pending:${slug}`, null); // aviso de "envíalo por WhatsApp" de versiones anteriores
  const products = new Map(store.categories.flatMap((category) => category.products).map((product) => [product.id, product]));
  const { settings, business } = store;
  /** Pago por adelantado: método → cuentas (Nequi, Bre-B, Daviplata) con QR o llave. */
  const payments = store.payments ?? { prepay: {}, accounts: [] };
  const deliveryModes = [
    settings.deliveryEnabled && { value: "DELIVERY", label: "Domicilio", detail: settings.deliveryFee > 0 ? `+ ${formatCOP(settings.deliveryFee)}` : "Gratis" },
    settings.pickupEnabled && { value: "PICKUP", label: "Recoger en el local", detail: "Sin costo" },
  ].filter(Boolean);

  /** productId → cantidad, en el orden en que se agregaron. */
  const cart = new Map();
  const saved = load(keys.cart);
  const removed = [];
  if (saved && Date.now() - saved.updatedAt < CART_TTL_MS) {
    for (const [productId, quantity] of saved.items ?? []) {
      const product = products.get(productId);
      if (product?.isAvailable) cart.set(productId, Math.min(MAX_QUANTITY, quantity));
      else if (product) removed.push(product.name);
    }
  }

  const customer = {
    name: "",
    phone: "",
    address: "",
    references: "",
    paymentMethod: settings.paymentMethods.length === 1 ? settings.paymentMethods[0] : "",
    notes: "",
    location: null,
    ...(load(keys.customer) ?? {}),
    deliveryType: "",
  };
  if (!deliveryModes.some((mode) => mode.value === customer.deliveryType)) customer.deliveryType = deliveryModes[0]?.value ?? "";
  if (!settings.paymentMethods.includes(customer.paymentMethod)) customer.paymentMethod = settings.paymentMethods.length === 1 ? settings.paymentMethods[0] : "";
  customer.notes = "";

  const checkout = { key: null, signature: null };
  /** Comprobante ya subido para este pedido: { id, url (vista previa local), total }. */
  let proof = null;
  /** Cuenta elegida en las pestañas del pago por adelantado. */
  let payKind = null;
  /** Último pedido de este dispositivo: { id, key, number, createdAt } y su estado más reciente. */
  let active = load(keys.order);
  if (active && Date.now() - active.createdAt > ORDER_TTL_MS) {
    active = null;
    save(keys.order, null);
  }
  let tracked = null;

  // ─── Cálculos para mostrar (el servidor tiene la última palabra) ───
  const count = () => [...cart.values()].reduce((sum, quantity) => sum + quantity, 0);
  const subtotal = () => [...cart].reduce((sum, [id, quantity]) => sum + (products.get(id)?.price ?? 0) * quantity, 0);
  const deliveryFee = () => (customer.deliveryType === "DELIVERY" ? settings.deliveryFee : 0);
  const missingForMinimum = () => Math.max(0, settings.minimumOrder - subtotal());

  function persistCart() {
    save(keys.cart, cart.size > 0 ? { items: [...cart], updatedAt: Date.now() } : null);
  }

  function persistCustomer() {
    const { name, phone, address, references, paymentMethod, deliveryType, location } = customer;
    save(keys.customer, { name, phone, address, references, paymentMethod, deliveryType, location });
  }

  // ─── Live region para lectores de pantalla ───
  const live = document.createElement("p");
  live.className = "sr-only";
  live.setAttribute("aria-live", "polite");
  document.body.append(live);
  const announce = (text) => {
    live.textContent = "";
    requestAnimationFrame(() => (live.textContent = text));
  };

  function setQuantity(productId, quantity) {
    const product = products.get(productId);
    if (!product) return;
    const next = Math.max(0, Math.min(MAX_QUANTITY, quantity));
    if (next === 0) cart.delete(productId);
    else cart.set(productId, next);
    persistCart();
    checkout.signature = null;
    refresh();
    announce(next === 0 ? `Quitaste ${product.name} de tu pedido.` : `${next} × ${product.name} en tu pedido.`);
  }

  // ─────────────────────────── Plantillas ───────────────────────────

  function stepper(product, quantity, size = "md") {
    const box = { sm: "h-9", md: "h-10", lg: "h-12" }[size];
    const square = { sm: "h-9 w-9", md: "h-10 w-10", lg: "h-12 w-12" }[size];
    return html`<span class="stepper ${box}" role="group" aria-label="Cantidad de ${product.name}">
      <button type="button" class="${square}" data-dec="${product.id}" aria-label="${quantity === 1 ? `Quitar ${product.name}` : `Quitar una unidad de ${product.name}`}">
        ${icon(quantity === 1 ? "trash-2" : "minus", "h-4 w-4")}
      </button>
      <span class="num min-w-6 text-center font-[760]" aria-hidden="true">${quantity}</span>
      <button type="button" class="${square}" data-inc="${product.id}" ${quantity >= MAX_QUANTITY ? "disabled" : ""} aria-label="Agregar otra unidad de ${product.name}">
        ${icon("plus", "h-4 w-4")}
      </button>
    </span>`;
  }

  /** Control de cantidad de un producto. "lg": el de la ficha del producto, con botón grande. */
  function control(product, size) {
    const quantity = cart.get(product.id) ?? 0;
    if (size === "lg") {
      return quantity === 0
        ? html`<button type="button" class="btn btn-primary min-h-13 w-full text-base" data-inc="${product.id}">
            ${icon("plus")} Agregar a mi pedido · <span class="num">${formatCOP(product.price)}</span>
          </button>`
        : html`<div class="flex items-center gap-3">
            ${stepper(product, quantity, "lg")}
            <button type="button" class="btn btn-ink min-h-12 flex-1" data-open-cart>Ver mi pedido · <span class="num">${formatCOP(subtotal())}</span></button>
          </div>`;
    }
    return quantity === 0
      ? html`<button type="button" class="qty-add" data-inc="${product.id}" aria-label="Agregar ${product.name} a tu pedido">${icon("plus")}</button>`
      : stepper(product, quantity);
  }

  function cartBar() {
    const items = count();
    return html`<button type="button" class="cart-bar" data-open-cart>
      <span class="grid h-8 min-w-8 place-items-center rounded-full bg-mustard px-2 text-sm font-[800] text-ink num" aria-hidden="true">${items}</span>
      <span class="flex-1 text-left font-[700]">Ver mi pedido<span class="sr-only">: ${items} ${items === 1 ? "producto" : "productos"}</span></span>
      <span class="num font-[800]">${formatCOP(subtotal())}</span>
    </button>`;
  }

  /** Barra inferior con el estado del último pedido (abre el seguimiento). */
  function trackingBar() {
    const status = tracked?.status ?? "PENDING";
    const step = statusCopy(status, tracked?.deliveryType ?? "DELIVERY");
    const done = FINAL_STATUSES.has(status);
    return html`<div class="cart-bar cursor-default gap-2.5 py-2 pr-2 hover:bg-ink" role="region" aria-label="Tu pedido">
      <span class="${status === "CANCELLED" ? "text-tomato" : "text-mustard"}">${icon(step.icon)}</span>
      <p class="min-w-0 flex-1 text-[0.875rem] leading-snug">
        <span class="font-[700]">Pedido #${active.number}</span>
        <span class="text-ink-soft"> · ${step.short}</span>
      </p>
      <button type="button" class="btn btn-primary btn-sm min-h-10 px-3" data-open-tracking>Ver estado</button>
      ${done
        ? html`<button type="button" class="btn btn-quiet btn-icon h-10 w-10 text-ink-soft hover:bg-ink-3 hover:text-paper" data-dismiss-order aria-label="Ocultar">
            ${icon("x")}
          </button>`
        : ""}
    </div>`;
  }

  function radioChoice(name, value, checked, label, detail) {
    return html`<label class="choice min-h-12 justify-between">
      <input type="radio" name="${name}" value="${value}" ${checked ? "checked" : ""} required />
      <span class="flex items-center gap-2"><span class="choice-check rounded-full">${icon("check", "h-3 w-3")}</span>${label}</span>
      ${detail ? html`<span class="num text-sm font-[620] text-muted">${detail}</span>` : ""}
    </label>`;
  }

  function summaryRows() {
    const isDelivery = customer.deliveryType === "DELIVERY";
    const row = (label, value, strong = false) => html`<div class="flex items-baseline justify-between gap-4 ${strong ? "text-[1.125rem] font-[800]" : ""}">
      <dt>${label}</dt><dd class="num">${value}</dd>
    </div>`;
    return html`<dl class="grid gap-1.5">
      ${row("Subtotal", formatCOP(subtotal()))}
      ${isDelivery ? row("Domicilio", settings.deliveryFee > 0 ? formatCOP(settings.deliveryFee) : "Gratis") : ""}
      <hr class="ticket-rule my-1.5" />
      ${row("TOTAL", formatCOP(subtotal() + deliveryFee()), true)}
    </dl>`;
  }

  function itemsList() {
    if (cart.size === 0) {
      return html`<div class="grid justify-items-center gap-3 rounded-[12px] border-2 border-dashed border-line px-6 py-10 text-center">
        ${icon("shopping-bag", "h-7 w-7 text-muted")}
        <p class="font-[700]">Tu pedido está vacío</p>
        <button type="button" class="btn btn-ink btn-sm" data-close-cart>Ver el menú</button>
      </div>`;
    }
    return html`<ul class="divide-y divide-line">
      ${[...cart].map(([id, quantity]) => {
        const product = products.get(id);
        return html`<li class="flex items-center gap-3 py-3">
          <div class="min-w-0 flex-1">
            <p class="font-[650] leading-snug">${product.name}</p>
            <p class="num text-sm text-muted">${formatCOP(product.price)} c/u</p>
          </div>
          ${stepper(product, quantity, "sm")}
          <span class="num w-[5.5rem] text-right font-[750]">${formatCOP(product.price * quantity)}</span>
        </li>`;
      })}
    </ul>`;
  }

  /** Ubicación exacta (opcional): con ella el domiciliario llega directo y el cliente lo ve en el mapa. */
  function locationField() {
    if (customer.location) {
      return html`<div class="flex items-center justify-between gap-3">
          <p class="flex items-center gap-2 text-sm font-[700] text-leaf">${icon("circle-check", "h-4 w-4")} Ubicación marcada</p>
          <button type="button" class="text-sm font-[650] text-muted underline" data-clear-location>Quitar</button>
        </div>
        <div class="delivery-map h-48" data-picker aria-label="Mapa: mueve el pin a tu puerta"></div>
        <p class="hint">Si el pin no quedó en tu puerta, muévelo o toca el mapa.</p>`;
    }
    return html`<button type="button" class="btn btn-ghost w-full justify-start" data-locate>
        ${icon("locate-fixed")} Marcar mi ubicación exacta <span class="font-normal text-muted">(opcional)</span>
      </button>
      <p class="hint">Así el domiciliario llega directo y puedes verlo acercarse en el mapa.</p>`;
  }

  let picker = null;
  async function mountPicker() {
    picker?.destroy();
    picker = null;
    const container = dialog.querySelector("[data-picker]");
    if (!container || !customer.location) return;
    try {
      picker = await pickerMap(container, customer.location, (point) => {
        customer.location = point;
        persistCustomer();
      });
    } catch {
      render(container, html`<p class="grid h-full place-items-center p-3 text-center text-sm text-muted">No se pudo cargar el mapa, pero tu ubicación quedó marcada.</p>`);
    }
  }

  function drawLocationField() {
    const slot = dialog.querySelector("[data-location-field]");
    if (!slot) return;
    render(slot, locationField());
    void mountPicker();
  }

  // ─── Pago por adelantado (QR o llave + comprobante) ───

  /** Valor con el que se dibujó el pago por adelantado (se redibuja solo si cambia). */
  let prepayDrawnFor = null;
  const prepayAccounts = () =>
    (payments.prepay[customer.paymentMethod] ?? []).map((kind) => payments.accounts.find((account) => account.kind === kind)).filter(Boolean);

  function prepaySection() {
    const accounts = prepayAccounts();
    if (accounts.length === 0) return "";
    const account = accounts.find((item) => item.kind === payKind) ?? accounts.find((item) => item.qrSvg) ?? accounts[0];
    const total = subtotal() + deliveryFee();
    prepayDrawnFor = total;
    const keyName = account.kind === "BRE_B" ? "Llave Bre-B" : `Número de ${account.label}`;
    return html`<section class="grid gap-4 rounded-[16px] border-2 border-ink bg-paper p-4" aria-labelledby="prepay-title">
      <div class="flex items-start gap-3">
        <span class="grid h-10 w-10 flex-none place-items-center rounded-full bg-mustard">${icon("qr-code", "h-5 w-5")}</span>
        <div>
          <h3 id="prepay-title" class="text-[1.0625rem] leading-snug font-[800]">Paga ahora y envía tu pedido</h3>
          <p class="text-sm text-muted">${business.name} recibe tu pedido junto con el comprobante.</p>
        </div>
      </div>

      ${accounts.length > 1
        ? html`<div class="flex gap-1 rounded-full bg-ground p-1" role="group" aria-label="Cuenta para pagar">
            ${accounts.map(
              (item) => html`<button
                type="button"
                class="min-h-9 flex-1 rounded-full px-3 text-sm font-[720] text-muted aria-pressed:bg-ink aria-pressed:text-paper"
                aria-pressed="${item.kind === account.kind ? "true" : "false"}"
                data-prepay-kind="${item.kind}"
              >
                ${item.label}
              </button>`,
            )}
          </div>`
        : ""}

      <div class="grid items-center gap-4 ${account.qrSvg ? "sm:grid-cols-[11rem_minmax(0,1fr)]" : ""}">
        ${account.qrSvg
          ? html`<div
              class="mx-auto w-44 rounded-[14px] border-2 border-ink bg-[#fff] p-1.5 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
              role="img"
              aria-label="Código QR de ${account.label} para pagar"
            >
              ${raw(account.qrSvg)}
            </div>`
          : ""}
        <div class="grid justify-items-center gap-2 text-center ${account.qrSvg ? "sm:justify-items-start sm:text-left" : ""}">
          <div>
            <p class="text-sm font-[620] text-muted">Valor a pagar</p>
            <p class="num text-[2rem] leading-none font-[860] [font-stretch:80%]">${formatCOP(total)}</p>
          </div>
          ${account.accountKey
            ? html`<button type="button" class="inline-flex min-h-10 max-w-full items-center gap-2 rounded-full bg-ground px-3.5 text-[0.9375rem] font-[700]" data-copy-account="${account.accountKey.replace(/\s+/g, "")}">
                <span class="font-[620] text-muted">${keyName}</span>
                <span class="num [overflow-wrap:anywhere]">${account.accountKey}</span>
                <span class="text-muted" data-copy-label>${icon("copy", "h-4 w-4")}</span>
              </button>`
            : ""}
          ${account.holderName ? html`<p class="text-sm">A nombre de <strong class="font-[720]">${account.holderName}</strong></p>` : ""}
          ${account.qrSvg
            ? html`<a class="inline-flex items-center gap-1.5 text-sm font-[650] text-ink underline" href="/api/v1/store/${encodeURIComponent(slug)}/payment-qr/${account.kind}.png" download>
                ${icon("download", "h-4 w-4")} Guardar imagen del QR
              </a>`
            : ""}
        </div>
      </div>

      <ol class="grid gap-1.5 rounded-[12px] bg-ground px-4 py-3 text-sm">
        <li><strong class="font-[720]">1.</strong> ${account.qrSvg
          ? "Escanea el QR desde la app de Nequi o de tu banco. Si pides desde este celular, guarda la imagen y súbela en tu app, o copia el número."
          : account.kind === "BRE_B"
            ? "Copia la llave y envía el pago desde la app de tu banco o billetera (Bre-B funciona entre todos los bancos)."
            : `Copia el número y envía el pago desde tu app de ${account.label}.`}</li>
        <li><strong class="font-[720]">2.</strong> Paga exactamente <span class="num font-[720]">${formatCOP(total)}</span>.</li>
        <li><strong class="font-[720]">3.</strong> Toma un pantallazo del comprobante y súbelo aquí.</li>
      </ol>

      <div class="grid gap-2" data-error-anchor="paymentProof">
        ${proof
          ? html`<div class="flex items-center gap-3 rounded-[12px] border border-leaf/30 bg-leaf-soft p-2.5">
              <img src="${proof.url}" alt="Tu comprobante" class="h-16 w-12 flex-none rounded-[6px] border border-line bg-paper object-cover object-top" />
              <div class="min-w-0 flex-1">
                <p class="flex items-center gap-1.5 font-[720] text-leaf">${icon("circle-check", "h-4 w-4")} Comprobante listo</p>
                <p class="text-sm text-muted">Se envía con tu pedido.</p>
              </div>
              <label class="btn btn-ghost btn-sm relative flex-none cursor-pointer">
                <input type="file" accept="image/*" class="sr-only" name="paymentProof" data-proof-file aria-label="Cambiar el comprobante" />
                Cambiar
              </label>
            </div>
            ${proof.total !== total
              ? html`<p class="rounded-[10px] bg-mustard-soft px-3 py-2 text-sm font-[620] text-mustard-deep">
                  Tu pedido cambió después de subir el comprobante (era ${formatCOP(proof.total)}). Si no pagaste ${formatCOP(total)}, paga la diferencia y
                  sube el nuevo comprobante.
                </p>`
              : ""}`
          : html`<label class="btn btn-ink relative min-h-12 w-full cursor-pointer" data-proof-pick>
              <input type="file" accept="image/*" class="sr-only" name="paymentProof" data-proof-file aria-label="Subir el comprobante de pago" />
              ${icon("upload")} Subir comprobante de pago
            </label>`}
      </div>
    </section>`;
  }

  function drawPrepay({ reveal = false } = {}) {
    const slot = dialog.querySelector("[data-prepay]");
    if (!slot) return;
    render(slot, prepaySection());
    if (reveal && slot.firstElementChild) slot.firstElementChild.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async function uploadProof(input) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const form = dialog.querySelector("[data-checkout]");
    const problem = checkImageFile(file);
    if (problem) {
      showErrors(form, { message: problem, fields: { paymentProof: problem } });
      return;
    }
    const zone = input.closest("label");
    zone?.setAttribute("aria-busy", "true");
    zone?.classList.add("opacity-60", "pointer-events-none");
    try {
      const response = await fetch(`/api/v1/store/${encodeURIComponent(slug)}/payment-proofs`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "No pudimos subir el comprobante. Intenta de nuevo.");
      if (proof) URL.revokeObjectURL(proof.url);
      proof = { id: payload.data.id, url: URL.createObjectURL(file), total: subtotal() + deliveryFee() };
      clearFieldErrors(form);
      drawPrepay();
      announce("Comprobante listo. Ya puedes hacer tu pedido.");
    } catch (error) {
      zone?.removeAttribute("aria-busy");
      zone?.classList.remove("opacity-60", "pointer-events-none");
      const message = error instanceof TypeError ? "Sin conexión. Revisa tu internet y vuelve a subir el comprobante." : error.message;
      showErrors(form, { message, fields: { paymentProof: message } });
    }
  }

  function checkoutView() {
    const isDelivery = customer.deliveryType === "DELIVERY";
    const missing = missingForMinimum();
    const empty = cart.size === 0;
    return html`<form class="flex min-h-0 flex-auto flex-col" data-checkout novalidate>
      <header class="flex items-center justify-between gap-3 border-b border-line py-3 pr-3 pl-5">
        <h2 id="cart-title" class="text-lg font-[780] outline-none" tabindex="-1">Tu pedido</h2>
        <button type="button" class="btn btn-quiet btn-icon" data-close-cart aria-label="Cerrar">${icon("x")}</button>
      </header>

      <div class="min-h-0 flex-auto overflow-y-auto px-5 pb-6">
        <section aria-label="Productos" data-cart-items>${itemsList()}</section>
        ${empty
          ? ""
          : html`<button type="button" class="mt-1 inline-flex items-center gap-1.5 text-[0.9375rem] font-[650] text-muted hover:text-ink" data-close-cart>
                ${icon("plus", "h-4 w-4")} Agregar más productos
              </button>

              <div class="mt-6 grid gap-6">
                ${formAlert()}
                ${deliveryModes.length > 1
                  ? html`<fieldset class="grid gap-2.5">
                      <legend class="mb-2.5 text-base font-[760]">¿Cómo lo recibes?</legend>
                      <div class="grid gap-2 sm:grid-cols-2" data-error-anchor="deliveryType">
                        ${deliveryModes.map((mode) => radioChoice("deliveryType", mode.value, customer.deliveryType === mode.value, mode.label, mode.detail))}
                      </div>
                    </fieldset>`
                  : html`<p class="flex items-center gap-2 rounded-[10px] bg-ground px-3.5 py-3 text-[0.9375rem]">
                      ${icon(isDelivery ? "bike" : "shopping-bag")} <span class="font-[650]">${deliveryModes[0]?.label}</span>
                      <span class="text-muted">· ${isDelivery ? "este negocio solo hace domicilios" : "este negocio no hace domicilios"}</span>
                    </p>`}

                <fieldset class="grid gap-4">
                  <legend class="mb-3 text-base font-[760]">Tus datos</legend>
                  <div class="grid gap-4 sm:grid-cols-2">
                    <div class="field">
                      <label class="label" for="c-name">Nombre</label>
                      <input class="input" id="c-name" name="name" value="${customer.name}" autocomplete="name" maxlength="80" required />
                    </div>
                    <div class="field">
                      <label class="label" for="c-phone">Celular</label>
                      <input class="input" id="c-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${customer.phone}" placeholder="300 123 4567" required />
                    </div>
                  </div>
                  ${isDelivery
                    ? html`<div class="field">
                          <label class="label" for="c-address">Dirección de entrega</label>
                          <input class="input" id="c-address" name="address" value="${customer.address}" autocomplete="street-address" placeholder="Calle 20 #15-30, barrio" maxlength="160" required />
                          ${settings.deliveryArea ? html`<p class="hint">Cobertura: ${settings.deliveryArea}</p>` : ""}
                        </div>
                        <div class="field">
                          <label class="label" for="c-references">Referencias <span class="font-normal text-muted">(opcional)</span></label>
                          <input class="input" id="c-references" name="references" value="${customer.references}" placeholder="Casa azul, frente al parque" maxlength="160" />
                        </div>
                        <div class="grid gap-2" data-location-field>${locationField()}</div>`
                    : html`<p class="hint">Recoges en: ${[business.address, business.city].filter(Boolean).join(", ") || "el local del negocio"}.</p>`}
                </fieldset>

                <fieldset>
                  <legend class="mb-3 text-base font-[760]">¿Cómo pagas?</legend>
                  <div class="flex flex-wrap gap-2" data-error-anchor="paymentMethod">
                    ${settings.paymentMethods.map(
                      (method) => html`<label class="choice">
                        <input type="radio" name="paymentMethod" value="${method}" ${customer.paymentMethod === method ? "checked" : ""} required />
                        <span class="choice-check rounded-full">${icon("check", "h-3 w-3")}</span>${PAYMENT_LABEL[method] ?? method}
                      </label>`,
                    )}
                  </div>
                </fieldset>

                <div data-prepay>${prepaySection()}</div>

                <div class="field">
                  <label class="label" for="c-notes">Notas para el negocio <span class="font-normal text-muted">(opcional)</span></label>
                  <textarea class="input min-h-[4.5rem]" id="c-notes" name="notes" rows="2" maxlength="300" placeholder="Ej.: sin cebolla, salsas aparte">${customer.notes}</textarea>
                </div>

                <section class="rounded-[12px] bg-ground p-4" aria-label="Resumen" data-summary>${summaryRows()}</section>
                <p class="hint -mt-3">Guardamos tus datos solo en este dispositivo para tu próximo pedido.</p>
              </div>`}
      </div>

      ${empty
        ? ""
        : html`<footer class="border-t border-line px-5 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))]">
            <p class="mb-2.5 text-center text-sm font-[620] text-mustard-deep ${missing > 0 ? "" : "hidden"}" data-minimum>
              El pedido mínimo es ${formatCOP(settings.minimumOrder)}. Te faltan <span class="num">${formatCOP(missing)}</span>.
            </p>
            <button type="submit" class="btn btn-primary min-h-13 w-full text-base" ${missing > 0 ? "disabled" : ""}>
              ${icon("check")} Hacer pedido · <span class="num">${formatCOP(subtotal() + deliveryFee())}</span>
            </button>
            <p class="mt-2 text-center text-xs leading-snug text-muted">
              Al continuar autorizas a ${business.name} a usar tus datos para gestionar tu pedido.
              <a class="underline" href="/privacidad" target="_blank" rel="noopener">Política de datos</a>
            </p>
          </footer>`}
    </form>`;
  }

  /** Textos del seguimiento según el estado del pedido. */
  function statusCopy(status, deliveryType) {
    const name = business.name;
    const delivery = deliveryType === "DELIVERY";
    return (
      {
        PENDING: { icon: "bell-ring", short: "Enviado", title: "¡Pedido enviado!", text: `${name} ya lo recibió. Espera a que lo acepte.` },
        CONFIRMED: { icon: "circle-check", short: "Aceptado", title: "Pedido aceptado", text: "En un momento empiezan a prepararlo." },
        PREPARING: { icon: "chef-hat", short: "En preparación", title: "Lo están preparando", text: `${name} aceptó tu pedido y ya está en la cocina.` },
        READY: delivery
          ? { icon: "circle-check", short: "Listo", title: "¡Tu pedido está listo!", text: "En un momento sale con el domiciliario." }
          : { icon: "circle-check", short: "Listo para recoger", title: "¡Tu pedido está listo!", text: "Ya puedes pasar a recogerlo." },
        OUT_FOR_DELIVERY: { icon: "bike", short: "En camino", title: "Va en camino", text: "El domiciliario ya salió con tu pedido." },
        DELIVERED: { icon: "utensils", short: "Entregado", title: "¡Buen provecho!", text: "Tu pedido fue entregado." },
        CANCELLED: { icon: "circle-x", short: "Cancelado", title: "El negocio canceló el pedido", text: "Si tienes dudas, comunícate con el negocio." },
      }[status] ?? { icon: "receipt", short: status, title: status, text: "" }
    );
  }

  /** Pasos del pedido con la hora en que ocurrió cada uno. */
  function trackingSteps(order) {
    const delivery = order.deliveryType === "DELIVERY";
    const at = (statuses) => order.history.find((entry) => statuses.includes(entry.status))?.at;
    const steps = [
      { label: "Recibido", at: at(["PENDING"]) },
      { label: "Aceptado y en preparación", at: at(["CONFIRMED", "PREPARING"]) },
      { label: delivery ? "Listo" : "Listo para recoger", at: at(["READY"]) },
      ...(delivery ? [{ label: "En camino", at: at(["OUT_FOR_DELIVERY"]) }] : []),
      { label: "Entregado", at: at(["DELIVERED"]) },
    ];
    const time = (value) => new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", timeZone: settings.timezone }).format(new Date(value));
    const current = steps.findLastIndex((step) => step.at);
    return html`<ol class="grid gap-0">
      ${steps.map((step, index) => {
        const done = Boolean(step.at);
        const isCurrent = index === current && order.status !== "DELIVERED";
        return html`<li class="relative flex gap-3 pb-5 last:pb-0">
          ${index < steps.length - 1
            ? html`<span class="absolute top-7 bottom-0 left-[0.875rem] w-0.5 -translate-x-1/2 ${steps[index + 1].at ? "bg-ink" : "bg-line"}" aria-hidden="true"></span>`
            : ""}
          <span class="relative z-[1] grid h-7 w-7 flex-none place-items-center rounded-full ${done ? "bg-ink text-mustard" : "border-2 border-line bg-paper"} ${isCurrent ? "bell-ring" : ""}">
            ${done ? icon("check", "h-3.5 w-3.5") : ""}
          </span>
          <span class="pt-0.5">
            <span class="block ${done ? "font-[700]" : "text-muted"}">${step.label}</span>
            ${step.at ? html`<span class="num block text-sm text-muted">${time(step.at)}</span>` : ""}
          </span>
        </li>`;
      })}
    </ol>`;
  }

  // ─── Mapa del domicilio en camino ───

  const courierPoint = () => (tracked?.courier && tracked.courier.lat !== undefined ? tracked.courier : null);
  const showsMap = () => tracked?.deliveryType === "DELIVERY" && tracked.status === "OUT_FOR_DELIVERY";

  function courierLine() {
    const courier = courierPoint();
    if (!courier) return "Esperando la ubicación del domiciliario…";
    const seconds = Math.max(0, Math.round((Date.now() - new Date(courier.updatedAt).getTime()) / 1000));
    if (seconds > 120) return "No recibimos la ubicación del domiciliario hace un momento. Sigue en camino.";
    if (tracked.destination) {
      const meters = distanceMeters(courier, tracked.destination);
      return meters < 80 ? "¡Tu domiciliario está llegando!" : `Tu domiciliario está a ${distanceLabel(meters)}`;
    }
    return "Tu domiciliario va en camino";
  }

  function mapSection() {
    if (!showsMap()) return "";
    return html`<section class="overflow-hidden rounded-[16px] bg-paper" aria-label="Mapa del domicilio">
      <div class="delivery-map h-60 rounded-none sm:h-72" data-track-map></div>
      <p class="flex items-center gap-2 px-4 py-3 text-[0.9375rem] font-[700]" aria-live="polite">
        ${icon("bike", "h-5 w-5 flex-none text-mustard-deep")}<span data-courier-line>${courierLine()}</span>
      </p>
    </section>`;
  }

  let trackMap = null;
  async function mountTrackingMap() {
    const container = dialog.querySelector("[data-track-map]");
    if (!container) return;
    try {
      trackMap = await deliveryMap(container, { destination: tracked.destination, courier: courierPoint(), config: tracked.map });
    } catch {
      render(container, html`<p class="grid h-full place-items-center p-4 text-center text-sm text-muted">No se pudo cargar el mapa.</p>`);
    }
  }

  /** Nueva posición del domiciliario sin redibujar la hoja (el mapa no parpadea). */
  function updateTrackingMap() {
    trackMap?.update({ courier: courierPoint(), destination: tracked.destination });
    const line = dialog.querySelector("[data-courier-line]");
    if (line) line.textContent = courierLine();
  }

  /** Estado del pago por adelantado: comprobante en revisión o pago confirmado. */
  function paymentNote(order) {
    if (!order.paymentProofSent) return "";
    const cancelled = order.status === "CANCELLED";
    const tone = order.paid && !cancelled ? "bg-leaf-soft text-leaf" : "bg-mustard-soft text-mustard-deep";
    const text = cancelled
      ? "Si ya pagaste, comunícate con el negocio para la devolución."
      : order.paid
        ? "Pago confirmado por el negocio."
        : "Comprobante enviado. El negocio está revisando tu pago.";
    return html`<p class="flex items-center gap-2.5 rounded-[14px] ${tone} px-4 py-3 text-[0.9375rem] font-[680]">
      ${icon(order.paid && !cancelled ? "circle-check" : "receipt", "h-5 w-5 flex-none")} ${text}
    </p>`;
  }

  function trackingView() {
    const order = tracked;
    const copy = statusCopy(order.status, order.deliveryType);
    const cancelled = order.status === "CANCELLED";
    const contact = order.business ?? { phone: business.phone, whatsappPhone: settings.whatsappPhone };
    const line = (label, value, strong = false) => html`<div class="flex items-baseline justify-between gap-4 ${strong ? "text-[1.0625rem] font-[820]" : ""}">
      <dt>${label}</dt><dd class="num">${value}</dd>
    </div>`;
    return html`<div class="flex min-h-0 flex-auto flex-col">
      <header class="flex items-center justify-between gap-3 border-b border-line py-3 pr-3 pl-5">
        <h2 id="cart-title" class="text-lg font-[780] outline-none" tabindex="-1">Pedido #${order.number}</h2>
        <button type="button" class="btn btn-quiet btn-icon" data-close-cart aria-label="Cerrar">${icon("x")}</button>
      </header>
      <div class="min-h-0 flex-auto overflow-y-auto bg-ground px-5 py-5">
        <div class="mx-auto grid max-w-[26rem] gap-5">
          <div class="relative overflow-hidden rounded-[18px] ${cancelled ? "bg-tomato text-paper" : "bg-ink text-paper"} p-5" aria-live="polite">
            <div class="flex items-start gap-4">
              <span class="grid h-12 w-12 flex-none place-items-center rounded-full ${cancelled ? "bg-paper text-tomato" : "bg-mustard text-ink"} ${order.status === "PENDING" ? "bell-ring" : ""}">
                ${icon(copy.icon, "h-6 w-6")}
              </span>
              <div class="grid gap-1">
                <p class="text-[1.375rem] leading-tight font-[820] [font-stretch:85%]">${copy.title}</p>
                <p class="text-[0.9375rem] ${cancelled ? "text-paper/90" : "text-paper/75"}">${copy.text}</p>
                ${cancelled && order.cancelReason ? html`<p class="mt-1 text-[0.9375rem] font-[650]">Motivo: ${order.cancelReason}</p>` : ""}
              </div>
            </div>
          </div>

          ${paymentNote(order)}

          ${mapSection()}

          ${cancelled ? "" : html`<section class="rounded-[16px] bg-paper p-5" aria-label="Estado del pedido">${trackingSteps(order)}</section>`}

          <figure class="ticket ticket-shadow p-5" aria-label="Resumen del pedido">
            <p class="display text-[1.5rem]">${business.name}</p>
            <hr class="ticket-rule my-3" />
            <ul class="grid gap-1.5 text-[0.9375rem]">
              ${order.items.map(
                (item) => html`<li class="flex justify-between gap-3">
                  <span><span class="num font-[700]">${item.quantity}×</span> ${item.name}</span>
                  <span class="num">${formatCOP(item.subtotal)}</span>
                </li>`,
              )}
            </ul>
            <hr class="ticket-rule my-3" />
            <dl class="grid gap-1 text-[0.9375rem]">
              ${order.deliveryFee > 0 ? line("Domicilio", formatCOP(order.deliveryFee)) : ""}
              ${line("TOTAL", formatCOP(order.total), true)}
            </dl>
          </figure>

          <div class="grid gap-2 text-center">
            <p class="text-sm text-muted">¿Dudas con tu pedido? Comunícate con ${business.name}.</p>
            <div class="flex flex-wrap justify-center gap-2">
              <a class="btn btn-ghost btn-sm" href="tel:+${contact.phone}">${icon("phone", "h-4 w-4")} Llamar</a>
              ${contact.whatsappPhone
                ? html`<a class="btn btn-ghost btn-sm" href="https://wa.me/${contact.whatsappPhone}?text=${encodeURIComponent(`Hola, ${business.name}. Les escribo por mi pedido #${order.number}.`)}" target="_blank" rel="noopener">
                    ${icon("message-circle", "h-4 w-4 text-[#128c4b]")} Escribir por WhatsApp
                  </a>`
                : ""}
            </div>
          </div>
        </div>
      </div>
      <footer class="border-t border-line px-5 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))]">
        <p class="mb-2 text-center text-xs text-muted">${FINAL_STATUSES.has(order.status) ? "" : "Esta pantalla se actualiza sola."}</p>
        <button type="button" class="btn btn-ink w-full" data-close-cart>Volver al menú</button>
      </footer>
    </div>`;
  }

  // ─────────────────────────── Dibujo ───────────────────────────

  const bar = document.createElement("div");
  bar.className = "pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]";
  document.body.append(bar);

  const dialog = document.createElement("dialog");
  dialog.className = "sheet";
  dialog.setAttribute("aria-labelledby", "cart-title");
  document.body.append(dialog);

  let view = "checkout";

  function refresh() {
    root.querySelectorAll("[data-qty]").forEach((slot) => {
      const product = products.get(slot.dataset.qty);
      if (product) render(slot, control(product, slot.dataset.qtySize));
    });
    if (orderable && count() > 0) render(bar, cartBar());
    else if (active && !dialog.open) render(bar, trackingBar());
    else render(bar, "");

    if (dialog.open && view === "checkout") {
      const form = dialog.querySelector("[data-checkout]");
      // Actualiza solo productos y resumen para no perder lo que el cliente escribe.
      if (!form || cart.size === 0 || !form.querySelector("[data-summary]")) {
        renderSheet();
      } else {
        render(form.querySelector("[data-cart-items]"), itemsList());
        render(form.querySelector("[data-summary]"), summaryRows());
        // El valor a pagar cambia con el carrito (solo entonces se redibuja el QR).
        if (prepayDrawnFor !== subtotal() + deliveryFee()) drawPrepay();
        const missing = missingForMinimum();
        const note = form.querySelector("[data-minimum]");
        note.classList.toggle("hidden", missing === 0);
        note.querySelector("span").textContent = formatCOP(missing);
        form.querySelector('[type="submit"]').disabled = missing > 0;
      }
    }
  }

  function renderSheet() {
    picker?.destroy();
    picker = null;
    trackMap?.destroy();
    trackMap = null;
    render(dialog, view === "tracking" && tracked ? trackingView() : checkoutView());
    if (view === "tracking") void mountTrackingMap();
    else void mountPicker();
  }

  function openSheet() {
    view = "checkout";
    renderSheet();
    dialog.showModal();
    dialog.querySelector("#cart-title")?.focus();
  }

  function closeSheet() {
    dialog.close();
    view = "checkout";
  }

  function openTracking() {
    view = "tracking";
    if (!tracked) tracked = { number: active.number, status: "PENDING", deliveryType: "DELIVERY", items: [], deliveryFee: 0, total: 0, history: [] };
    renderSheet();
    if (!dialog.open) dialog.showModal();
    dialog.querySelector("#cart-title")?.focus();
    poll();
  }

  // ─────────────────────────── Seguimiento en vivo ───────────────────────────

  let pollTimer = 0;
  /** Consulta el estado del pedido: cada 8 s con el seguimiento abierto, cada 20 s con la página a la vista. */
  async function poll() {
    clearTimeout(pollTimer);
    if (!active) return;
    try {
      const response = await fetch(`/api/v1/store/${encodeURIComponent(slug)}/orders/${active.id}`, {
        headers: { Accept: "application/json", "X-Order-Key": active.key },
        cache: "no-store",
      });
      if (response.status === 404) {
        active = null;
        tracked = null;
        save(keys.order, null);
        if (dialog.open && view === "tracking") closeSheet();
        refresh();
        return;
      }
      if (response.ok) {
        const next = (await response.json()).data;
        const changed = tracked && tracked.status !== next.status && tracked.items.length > 0;
        const sameView = tracked && tracked.status === next.status && tracked.items.length > 0;
        tracked = next;
        if (changed) {
          announce(`Pedido #${next.number}: ${statusCopy(next.status, next.deliveryType).title}`);
          navigator.vibrate?.(180);
        }
        if (dialog.open && view === "tracking" && sameView && trackMap) {
          // Mismo estado: solo se mueve la moto en el mapa.
          updateTrackingMap();
        } else if (dialog.open && view === "tracking") {
          const scroller = dialog.querySelector(".overflow-y-auto");
          const top = scroller?.scrollTop ?? 0;
          renderSheet();
          const again = dialog.querySelector(".overflow-y-auto");
          if (again) again.scrollTop = top;
        }
        refresh();
      }
    } catch {
      // Sin conexión: se vuelve a intentar en el siguiente turno.
    }
    if (tracked && FINAL_STATUSES.has(tracked.status)) return;
    // En camino y con el mapa a la vista se actualiza más seguido.
    const delay = dialog.open && view === "tracking" ? (tracked?.status === "OUT_FOR_DELIVERY" ? 5_000 : 8_000) : 20_000;
    if (!document.hidden) pollTimer = setTimeout(poll, delay);
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && active) poll();
  });

  // ─────────────────────────── Envío del pedido ───────────────────────────

  function readCheckout(form) {
    const value = (name) => form.elements[name]?.value?.trim?.() ?? "";
    customer.name = value("name");
    customer.phone = value("phone");
    if (form.elements.address) customer.address = value("address");
    if (form.elements.references) customer.references = value("references");
    customer.notes = value("notes");
    const delivery = form.querySelector('[name="deliveryType"]:checked');
    if (delivery) customer.deliveryType = delivery.value;
    const payment = form.querySelector('[name="paymentMethod"]:checked');
    customer.paymentMethod = payment?.value ?? "";
  }

  async function submit(form) {
    readCheckout(form);
    persistCustomer();
    const button = form.querySelector('[type="submit"]');
    clearFieldErrors(form);

    const isDelivery = customer.deliveryType === "DELIVERY";
    const prepaid = prepayAccounts().length > 0;
    if (prepaid && !proof) {
      showErrors(form, {
        message: "Paga con el QR o la llave y sube el comprobante para enviar tu pedido.",
        fields: { paymentProof: "Paga y sube el pantallazo del comprobante para enviar tu pedido." },
      });
      form.querySelector("[data-error-for='paymentProof']")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const body = {
      items: [...cart].map(([productId, quantity]) => ({ productId, quantity })),
      name: customer.name,
      phone: customer.phone,
      deliveryType: customer.deliveryType,
      address: isDelivery ? customer.address : "",
      references: isDelivery ? customer.references : "",
      paymentMethod: customer.paymentMethod || undefined,
      notes: customer.notes,
      location: isDelivery && customer.location ? { lat: customer.location.lat, lng: customer.location.lng } : undefined,
      paymentProofId: prepaid ? proof.id : undefined,
    };
    // Mismo contenido = misma clave: si la conexión falla y el cliente reintenta, no se duplica.
    const signature = JSON.stringify(body);
    if (checkout.signature !== signature) {
      checkout.key = newKey();
      checkout.signature = signature;
    }

    setBusy(button, true);
    let response;
    let payload = null;
    try {
      response = await fetch(`/api/v1/store/${encodeURIComponent(slug)}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...body, idempotencyKey: checkout.key }),
      });
      payload = await response.json().catch(() => null);
    } catch {
      setBusy(button, false);
      showErrors(form, { message: "Sin conexión. Revisa tu internet y vuelve a tocar «Hacer pedido»." });
      return;
    }
    setBusy(button, false);

    if (!response.ok) {
      const error = payload?.error ?? {};
      if (error.code === "PRODUCTS_UNAVAILABLE") {
        for (const problem of error.details?.products ?? []) {
          cart.delete(problem.productId);
          const product = products.get(problem.productId);
          if (product) product.isAvailable = false;
        }
        persistCart();
        checkout.signature = null;
        refresh();
      }
      if (error.code === "PAYMENT_PROOF_INVALID" || error.code === "PAYMENT_PROOF_REQUIRED") {
        if (proof) URL.revokeObjectURL(proof.url);
        proof = null;
        checkout.signature = null;
        drawPrepay();
      }
      showErrors(dialog.querySelector("[data-checkout]") ?? form, {
        message: error.message ?? "No pudimos registrar tu pedido. Intenta de nuevo.",
        fields: error.fields ?? error.details?.fields ?? {},
      });
      return;
    }

    const { order } = payload.data;
    active = { id: order.id, number: order.number, key: checkout.key, createdAt: Date.now() };
    save(keys.order, active);
    tracked = {
      number: order.number,
      status: order.status,
      deliveryType: order.deliveryType,
      items: order.items.map((item) => ({ name: item.productName, quantity: item.quantity, subtotal: item.subtotal })),
      deliveryFee: order.deliveryFee,
      total: order.total,
      history: [{ status: "PENDING", at: order.createdAt }],
      business: { phone: business.phone, whatsappPhone: settings.whatsappPhone },
      paid: false,
      paymentProofSent: Boolean(order.paymentProof),
    };
    if (proof) URL.revokeObjectURL(proof.url);
    proof = null;
    payKind = null;
    cart.clear();
    persistCart();
    checkout.key = null;
    checkout.signature = null;

    view = "tracking";
    renderSheet();
    refresh();
    dialog.querySelector("#cart-title")?.focus();
    poll();
  }

  // ─────────────────────────── Eventos ───────────────────────────

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button, a");
    if (!target) return;
    if (target.matches("[data-inc]")) setQuantity(target.dataset.inc, (cart.get(target.dataset.inc) ?? 0) + 1);
    if (target.matches("[data-dec]")) setQuantity(target.dataset.dec, (cart.get(target.dataset.dec) ?? 0) - 1);
    if (target.matches("[data-open-cart]")) openSheet();
    if (target.matches("[data-close-cart]")) closeSheet();
    if (target.matches("[data-open-tracking]")) openTracking();
    if (target.matches("[data-dismiss-order]")) {
      active = null;
      tracked = null;
      save(keys.order, null);
      refresh();
    }
  });

  dialog.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-checkout]");
    if (!form) return;
    event.preventDefault();
    submit(form);
  });

  dialog.addEventListener("change", (event) => {
    const form = event.target.closest("[data-checkout]");
    if (!form) return;
    if (event.target.matches("[data-proof-file]")) {
      void uploadProof(event.target);
      return;
    }
    readCheckout(form);
    persistCustomer();
    if (event.target.name === "deliveryType") {
      // Cambia los campos de dirección y el resumen; conserva lo escrito.
      renderSheet();
      dialog.querySelector(`[name="deliveryType"][value="${customer.deliveryType}"]`)?.focus();
    }
    if (event.target.name === "paymentMethod") {
      // Nequi, Daviplata o transferencia: aparece el QR para pagar antes de enviar.
      payKind = null;
      drawPrepay({ reveal: true });
    }
  });

  dialog.addEventListener("input", (event) => {
    const input = event.target;
    if (input.getAttribute("aria-invalid") === "true") {
      input.removeAttribute("aria-invalid");
      input.closest("form")?.querySelector(`[data-error-for="${CSS.escape(input.name)}"]`)?.remove();
    }
  });

  dialog.addEventListener("click", async (event) => {
    if (event.target === dialog) return closeSheet();
    const button = event.target.closest("button");
    if (button?.matches("[data-locate]")) {
      setBusy(button, true);
      try {
        const position = await currentPosition();
        customer.location = { lat: position.lat, lng: position.lng };
        persistCustomer();
        drawLocationField();
      } catch (error) {
        setBusy(button, false);
        const form = dialog.querySelector("[data-checkout]");
        if (form) showErrors(form, { message: error.message });
      }
    }
    if (button?.matches("[data-prepay-kind]")) {
      payKind = button.dataset.prepayKind;
      drawPrepay();
      dialog.querySelector(`[data-prepay-kind="${payKind}"]`)?.focus();
    }
    if (button?.matches("[data-copy-account]")) {
      const ok = await copyText(button.dataset.copyAccount);
      const label = button.querySelector("[data-copy-label]");
      if (label) label.textContent = ok ? "Copiado" : "";
      if (ok) announce("Copiado. Pégalo en tu app para pagar.");
    }
    if (button?.matches("[data-clear-location]")) {
      customer.location = null;
      persistCustomer();
      drawLocationField();
    }
  });
  dialog.addEventListener("close", () => {
    picker?.destroy();
    picker = null;
    trackMap?.destroy();
    trackMap = null;
    view = "checkout";
    refresh();
  });

  refresh();
  if (active) poll();
  if (removed.length > 0) {
    announce(`Quitamos de tu pedido lo que se agotó: ${removed.join(", ")}.`);
  }
  return { removed, refresh };
}
