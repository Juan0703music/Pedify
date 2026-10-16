// Carrito y pedido de la tienda pública (secciones 8 y 9 del documento de arquitectura).
// El navegador solo envía productos, cantidades y datos de entrega: el servidor recalcula precios,
// domicilio y total, guarda la solicitud (PENDING) y devuelve el mensaje y el enlace de WhatsApp.
import { formatCOP, formatPhone } from "./api.js";
import { clearFieldErrors, formAlert, html, icon, render, setBusy, showErrors } from "./ui.js";

export const PAYMENT_LABEL = {
  CASH: "Efectivo",
  NEQUI: "Nequi",
  DAVIPLATA: "Daviplata",
  BANK_TRANSFER: "Transferencia",
  CARD: "Tarjeta (datáfono)",
};

const MAX_QUANTITY = 99;
const CART_TTL_MS = 24 * 60 * 60 * 1000;
const PENDING_TTL_MS = 3 * 60 * 60 * 1000;

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
  const keys = { cart: `pedify:cart:${slug}`, pending: `pedify:pending:${slug}`, customer: "pedify:customer" };
  const products = new Map(store.categories.flatMap((category) => category.products).map((product) => [product.id, product]));
  const { settings, business } = store;
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
    ...(load(keys.customer) ?? {}),
    deliveryType: "",
  };
  if (!deliveryModes.some((mode) => mode.value === customer.deliveryType)) customer.deliveryType = deliveryModes[0]?.value ?? "";
  if (!settings.paymentMethods.includes(customer.paymentMethod)) customer.paymentMethod = settings.paymentMethods.length === 1 ? settings.paymentMethods[0] : "";
  customer.notes = "";

  const checkout = { key: null, signature: null };
  let pending = load(keys.pending);
  if (pending && Date.now() - pending.createdAt > PENDING_TTL_MS) pending = null;

  // ─── Cálculos para mostrar (el servidor tiene la última palabra) ───
  const count = () => [...cart.values()].reduce((sum, quantity) => sum + quantity, 0);
  const subtotal = () => [...cart].reduce((sum, [id, quantity]) => sum + (products.get(id)?.price ?? 0) * quantity, 0);
  const deliveryFee = () => (customer.deliveryType === "DELIVERY" ? settings.deliveryFee : 0);
  const missingForMinimum = () => Math.max(0, settings.minimumOrder - subtotal());

  function persistCart() {
    save(keys.cart, cart.size > 0 ? { items: [...cart], updatedAt: Date.now() } : null);
  }

  function persistCustomer() {
    const { name, phone, address, references, paymentMethod, deliveryType } = customer;
    save(keys.customer, { name, phone, address, references, paymentMethod, deliveryType });
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
    const box = size === "sm" ? "h-9" : "h-10";
    const square = size === "sm" ? "h-9 w-9" : "h-10 w-10";
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

  function control(product) {
    const quantity = cart.get(product.id) ?? 0;
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

  /** Pedido creado que el cliente aún no ha enviado por WhatsApp (se muestra en la barra inferior). */
  function pendingBar() {
    return html`<div class="cart-bar cursor-default gap-2.5 py-2 pr-2 hover:bg-ink" role="region" aria-label="Pedido sin enviar">
      <span class="text-mustard">${icon("message-circle")}</span>
      <p class="min-w-0 flex-1 text-[0.875rem] leading-snug">
        <span class="font-[700]">Pedido #${pending.number} sin enviar.</span>
        <span class="text-ink-soft">El negocio lo recibe por WhatsApp.</span>
      </p>
      <a class="btn btn-whatsapp btn-sm min-h-10 px-3" href="${pending.url}" target="_blank" rel="noopener" data-wa-open>Enviar</a>
      <button type="button" class="btn btn-quiet btn-icon h-10 w-10 text-ink-soft hover:bg-ink-3 hover:text-paper" data-dismiss-pending aria-label="Ocultar aviso">
        ${icon("x")}
      </button>
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

  function checkoutView() {
    const isDelivery = customer.deliveryType === "DELIVERY";
    const missing = missingForMinimum();
    const empty = cart.size === 0;
    return html`<form class="flex min-h-0 flex-1 flex-col" data-checkout novalidate>
      <header class="flex items-center justify-between gap-3 border-b border-line py-3 pr-3 pl-5">
        <h2 id="cart-title" class="text-lg font-[780] outline-none" tabindex="-1">Tu pedido</h2>
        <button type="button" class="btn btn-quiet btn-icon" data-close-cart aria-label="Cerrar">${icon("x")}</button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
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
                        </div>`
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
            <button type="submit" class="btn btn-whatsapp w-full text-base" ${missing > 0 ? "disabled" : ""}>
              ${icon("message-circle")} Continuar por WhatsApp
            </button>
            <p class="mt-2 text-center text-xs leading-snug text-muted">
              Al continuar autorizas a ${business.name} a usar tus datos para gestionar tu pedido.
              <a class="underline" href="/privacidad" target="_blank" rel="noopener">Política de datos</a>
            </p>
          </footer>`}
    </form>`;
  }

  function confirmationView(result) {
    const { order, whatsapp } = result;
    const isDelivery = order.deliveryType === "DELIVERY";
    const time = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", timeZone: settings.timezone }).format(new Date(order.createdAt));
    const line = (label, value, strong = false) => html`<div class="flex items-baseline justify-between gap-4 ${strong ? "text-[1.125rem] font-[820]" : ""}">
      <dt>${label}</dt><dd class="num">${value}</dd>
    </div>`;
    return html`<div class="flex min-h-0 flex-1 flex-col">
      <header class="flex items-center justify-between gap-3 border-b border-line py-3 pr-3 pl-5">
        <h2 id="cart-title" class="text-lg font-[780] outline-none" tabindex="-1">Pedido #${order.number}</h2>
        <button type="button" class="btn btn-quiet btn-icon" data-close-cart aria-label="Cerrar">${icon("x")}</button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto bg-ground px-5 py-5">
        <div class="mx-auto grid max-w-[24rem] gap-5">
          <div class="flex items-start gap-3 rounded-[14px] border border-mustard-press bg-mustard-soft p-4">
            <span class="mt-0.5 text-mustard-deep">${icon("message-circle")}</span>
            <div class="grid gap-1">
              <p class="font-[760]" data-step-title>Falta un paso: envíalo por WhatsApp</p>
              <p class="text-[0.9375rem]" data-step-text>
                Tu pedido quedó registrado, pero ${business.name} lo recibe cuando envías el mensaje desde tu WhatsApp.
              </p>
            </div>
          </div>

          <figure class="ticket ticket-shadow print-in p-5" aria-label="Resumen del pedido">
            <p class="display text-[1.6rem]">${business.name}</p>
            <p class="mt-1 text-sm text-muted">Pedido #${order.number} · ${time}</p>
            <hr class="ticket-rule my-3" />
            <ul class="grid gap-1.5 text-[0.9375rem]">
              ${order.items.map(
                (item) => html`<li class="flex justify-between gap-3">
                  <span><span class="num font-[700]">${item.quantity}×</span> ${item.productName}</span>
                  <span class="num">${formatCOP(item.subtotal)}</span>
                </li>`,
              )}
            </ul>
            <hr class="ticket-rule my-3" />
            <dl class="grid gap-1 text-[0.9375rem]">
              ${line("Subtotal", formatCOP(order.subtotal))}
              ${order.deliveryFee > 0 ? line("Domicilio", formatCOP(order.deliveryFee)) : ""}
              ${order.discount > 0 ? line("Descuento", `-${formatCOP(order.discount)}`) : ""}
              ${line("TOTAL", formatCOP(order.total), true)}
            </dl>
            <hr class="ticket-rule my-3" />
            <p class="text-sm">
              ${isDelivery ? html`<span class="font-[650]">Domicilio:</span> ${order.deliveryAddress}` : html`<span class="font-[650]">Recoger en el local</span>`}
            </p>
            <p class="text-sm"><span class="font-[650]">Pago:</span> ${PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod}</p>
            <p class="mt-1 text-sm text-muted">${order.customerName} · ${formatPhone(order.customerPhone)}</p>
          </figure>
        </div>
      </div>
      <footer class="grid gap-2 border-t border-line px-5 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))]">
        <a class="btn btn-whatsapp w-full text-base" href="${whatsapp.url}" target="_blank" rel="noopener" data-wa-open>
          ${icon("message-circle")} Enviar pedido por WhatsApp
        </a>
        <button type="button" class="btn btn-quiet w-full" data-close-cart>Volver al menú</button>
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
  let lastResult = null;

  function refresh() {
    root.querySelectorAll("[data-qty]").forEach((slot) => {
      const product = products.get(slot.dataset.qty);
      if (product) render(slot, control(product));
    });
    if (orderable && count() > 0) render(bar, cartBar());
    else if (pending && !pending.opened && !dialog.open) render(bar, pendingBar());
    else render(bar, "");

    if (dialog.open && view === "checkout") {
      const form = dialog.querySelector("[data-checkout]");
      // Actualiza solo productos y resumen para no perder lo que el cliente escribe.
      if (!form || cart.size === 0 || !form.querySelector("[data-summary]")) {
        renderSheet();
      } else {
        render(form.querySelector("[data-cart-items]"), itemsList());
        render(form.querySelector("[data-summary]"), summaryRows());
        const missing = missingForMinimum();
        const note = form.querySelector("[data-minimum]");
        note.classList.toggle("hidden", missing === 0);
        note.querySelector("span").textContent = formatCOP(missing);
        form.querySelector('[type="submit"]').disabled = missing > 0;
      }
    }
  }

  function renderSheet() {
    render(dialog, view === "confirmation" && lastResult ? confirmationView(lastResult) : checkoutView());
  }

  function openSheet() {
    view = "checkout";
    renderSheet();
    dialog.showModal();
    dialog.querySelector("#cart-title")?.focus();
  }

  function closeSheet() {
    dialog.close();
    if (view === "confirmation") {
      view = "checkout";
      lastResult = null;
    }
  }

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
    const body = {
      items: [...cart].map(([productId, quantity]) => ({ productId, quantity })),
      name: customer.name,
      phone: customer.phone,
      deliveryType: customer.deliveryType,
      address: isDelivery ? customer.address : "",
      references: isDelivery ? customer.references : "",
      paymentMethod: customer.paymentMethod || undefined,
      notes: customer.notes,
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
      showErrors(form, { message: "Sin conexión. Revisa tu internet y vuelve a tocar «Continuar por WhatsApp»." });
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
      showErrors(dialog.querySelector("[data-checkout]") ?? form, {
        message: error.message ?? "No pudimos registrar tu pedido. Intenta de nuevo.",
        fields: error.fields ?? error.details?.fields ?? {},
      });
      return;
    }

    const { order, whatsapp } = payload.data;
    pending = { id: order.id, number: order.number, url: whatsapp.url, key: checkout.key, createdAt: Date.now(), opened: false };
    save(keys.pending, pending);
    cart.clear();
    persistCart();
    checkout.key = null;
    checkout.signature = null;

    lastResult = { order, whatsapp };
    view = "confirmation";
    renderSheet();
    refresh();
    dialog.querySelector("#cart-title")?.focus();
  }

  /** Avisa al servidor que el cliente abrió WhatsApp (no prueba que haya enviado el mensaje). */
  function markOpened() {
    if (!pending || pending.opened) return;
    const { id, key } = pending;
    pending = { ...pending, opened: true };
    save(keys.pending, pending);
    fetch(`/api/v1/store/${encodeURIComponent(slug)}/orders/${id}/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: key }),
      keepalive: true,
    }).catch(() => {});
  }

  // ─────────────────────────── Eventos ───────────────────────────

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button, a");
    if (!target) return;
    if (target.matches("[data-inc]")) setQuantity(target.dataset.inc, (cart.get(target.dataset.inc) ?? 0) + 1);
    if (target.matches("[data-dec]")) setQuantity(target.dataset.dec, (cart.get(target.dataset.dec) ?? 0) - 1);
    if (target.matches("[data-open-cart]")) openSheet();
    if (target.matches("[data-close-cart]")) closeSheet();
    if (target.matches("[data-wa-open]")) {
      markOpened();
      const title = dialog.querySelector("[data-step-title]");
      if (title) {
        title.textContent = "¿Se abrió WhatsApp?";
        dialog.querySelector("[data-step-text]").textContent =
          "Toca «Enviar» en el chat para que el negocio reciba tu pedido. Te confirmarán por ahí. Si no se abrió, toca el botón otra vez.";
      }
      refresh();
    }
    if (target.matches("[data-dismiss-pending]")) {
      pending = { ...pending, opened: true };
      save(keys.pending, pending);
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
    readCheckout(form);
    persistCustomer();
    if (event.target.name === "deliveryType") {
      // Cambia los campos de dirección y el resumen; conserva lo escrito.
      renderSheet();
      dialog.querySelector(`[name="deliveryType"][value="${customer.deliveryType}"]`)?.focus();
    }
  });

  dialog.addEventListener("input", (event) => {
    const input = event.target;
    if (input.getAttribute("aria-invalid") === "true") {
      input.removeAttribute("aria-invalid");
      input.closest("form")?.querySelector(`[data-error-for="${CSS.escape(input.name)}"]`)?.remove();
    }
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeSheet();
  });
  dialog.addEventListener("close", () => {
    if (view === "confirmation") {
      view = "checkout";
      lastResult = null;
    }
    refresh();
  });

  refresh();
  if (removed.length > 0) {
    announce(`Quitamos de tu pedido lo que se agotó: ${removed.join(", ")}.`);
  }
  return { removed };
}
