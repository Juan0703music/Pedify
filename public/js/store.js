// Tienda pública de un negocio: /tienda/:slug (sección 8 del documento de arquitectura).
// Muestra logo, portada, horario, estado de atención y el catálogo por categorías;
// el carrito y el envío del pedido por WhatsApp están en cart.js.
import { ApiError, formatCOP, formatPhone } from "./api.js";
import { initCart, PAYMENT_LABEL } from "./cart.js";
import { html, icon, initials, render } from "./ui.js";

const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
/** Semana colombiana: de lunes a domingo. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const root = document.getElementById("store");
const slug = decodeURIComponent(location.pathname.split("/")[2] ?? "");

// ───────────────────────────── Utilidades ─────────────────────────────

/** "17:00" → "5:00 p. m." (formato habitual en Colombia). */
function time12(value) {
  const [hours, minutes] = value.split(":").map(Number);
  const suffix = hours < 12 ? "a. m." : "p. m.";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** Día de la semana actual en la zona horaria del negocio. */
function todayIn(timeZone) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date());
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

function statusInfo(status) {
  if (status.isOpen && status.acceptingOrders) {
    return { tone: "leaf", label: "Abierto", detail: `hasta las ${time12(status.closesAt)}` };
  }
  if (status.isOpen) {
    return { tone: "mustard", label: "Pedidos en pausa", detail: "el negocio no está recibiendo pedidos en este momento" };
  }
  const next = status.nextOpen;
  let detail = "por ahora no tiene horario de atención";
  if (next) {
    const when = next.inDays === 0 ? "hoy" : next.inDays === 1 ? "mañana" : `el ${DAY_NAMES[next.day]}`;
    detail = `abre ${when} a las ${time12(next.time)}`;
  }
  return { tone: "tomato", label: "Cerrado", detail };
}

const TONE_CLASS = {
  leaf: "bg-leaf-soft text-leaf",
  tomato: "bg-tomato-soft text-tomato",
  mustard: "bg-mustard-soft text-mustard-deep",
};

function whatsappLink(phone, businessName) {
  const text = `¡Hola, ${businessName}! Tengo una pregunta sobre su menú.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

/** Se puede pedir: abierto, sin pausa manual y con WhatsApp configurado. */
const canOrder = (store) => store.status.canOrder && Boolean(store.settings.whatsappPhone);

/** Aviso sobre el menú cuando no se reciben pedidos en este momento. */
function orderingNotice(store) {
  if (canOrder(store) || store.categories.length === 0) return "";
  const { status, settings } = store;
  let title = "Por ahora no recibimos pedidos en línea";
  let text = "Puedes ver el menú y escribirle al negocio.";
  if (settings.whatsappPhone && !status.isOpen) {
    const info = statusInfo(status);
    title = "Estamos cerrados";
    text = `Puedes ver el menú; ${info.detail}.`;
  } else if (settings.whatsappPhone && !status.acceptingOrders) {
    title = "Pedidos en pausa";
    text = "El negocio no está recibiendo pedidos en este momento. Vuelve a intentarlo más tarde.";
  }
  return html`<div class="mx-4 mb-6 flex items-start gap-3 rounded-[14px] bg-ground px-4 py-3.5 sm:mx-8">
    <span class="mt-0.5 text-muted">${icon("clock")}</span>
    <p class="text-[0.9375rem]"><span class="font-[700]">${title}.</span> ${text}</p>
  </div>`;
}

// ───────────────────────────── Partes de la página ─────────────────────────────

function cover(business) {
  if (business.bannerUrl) {
    return html`<div class="aspect-[16/9] overflow-hidden bg-ink sm:aspect-[3/1] lg:rounded-b-[18px]">
      <img src="${business.bannerUrl}" alt="" class="h-full w-full object-cover" fetchpriority="high" />
    </div>`;
  }
  // Sin portada: franja de letrero con el nombre en grande.
  return html`<div class="relative flex h-28 items-end overflow-hidden bg-mustard px-4 sm:h-40 sm:px-8 lg:rounded-b-[18px]" aria-hidden="true">
    <span class="display translate-y-[18%] whitespace-nowrap text-[4.5rem] text-ink/10 sm:text-[7.5rem]">${business.name}</span>
  </div>`;
}

function logo(business) {
  const ring = "h-[4.75rem] w-[4.75rem] flex-none rounded-full border-4 border-paper shadow-[var(--shadow-lift)] sm:h-24 sm:w-24";
  return business.logoUrl
    ? html`<img src="${business.logoUrl}" alt="Logo de ${business.name}" class="${ring} bg-paper object-cover" />`
    : html`<span class="${ring} grid place-items-center bg-ink text-xl font-[820] text-mustard sm:text-2xl" aria-hidden="true">${initials(business.name)}</span>`;
}

function hoursList(settings) {
  const today = todayIn(settings.timezone);
  return html`<ul class="grid gap-1 text-[0.9375rem]">
    ${WEEK_ORDER.map((day) => {
      const entry = settings.openingHours.find((item) => item.day === day);
      const text = !entry || entry.closed ? "Cerrado" : `${time12(entry.open)} – ${time12(entry.close)}`;
      const isToday = day === today;
      return html`<li class="flex justify-between gap-4 rounded-[8px] px-2.5 py-1.5 ${isToday ? "bg-ground font-[650]" : ""}">
        <span>${capitalize(DAY_NAMES[day])}${isToday ? html`<span class="sr-only"> (hoy)</span>` : ""}</span>
        <span class="num ${!entry || entry.closed ? "text-muted" : ""}">${text}</span>
      </li>`;
    })}
  </ul>`;
}

function infoRow(iconName, content) {
  return html`<li class="flex items-start gap-3 py-3">
    <span class="mt-0.5 text-muted">${icon(iconName)}</span>
    <div class="min-w-0 flex-1">${content}</div>
  </li>`;
}

function details(store) {
  const { business, settings } = store;
  const rows = [];
  if (settings.deliveryEnabled) {
    rows.push(
      infoRow(
        "bike",
        html`<p class="font-[620]">
            Domicilio ${settings.deliveryFee > 0 ? html`<span class="num">${formatCOP(settings.deliveryFee)}</span>` : "gratis"}
          </p>
          ${settings.deliveryArea ? html`<p class="text-sm text-muted">${settings.deliveryArea}</p>` : ""}`,
      ),
    );
  }
  if (settings.pickupEnabled) {
    rows.push(infoRow("shopping-bag", html`<p class="font-[620]">Recoger en el local</p>`));
  }
  if (settings.minimumOrder > 0) {
    rows.push(infoRow("receipt", html`<p>Pedido mínimo <span class="num font-[620]">${formatCOP(settings.minimumOrder)}</span></p>`));
  }
  if (business.address || business.city) {
    rows.push(infoRow("map-pin", html`<p>${[business.address, business.city].filter(Boolean).join(", ")}</p>`));
  }
  rows.push(
    infoRow(
      "clock",
      html`<details class="group">
        <summary class="flex cursor-pointer list-none items-center justify-between gap-2 font-[620]">
          Horario de atención ${icon("chevron-down", "text-muted transition-transform group-open:rotate-180")}
        </summary>
        <div class="mt-2">${hoursList(settings)}</div>
      </details>`,
    ),
  );
  if (settings.paymentMethods.length > 0) {
    rows.push(infoRow("wallet", html`<p>${settings.paymentMethods.map((method) => PAYMENT_LABEL[method] ?? method).join(" · ")}</p>`));
  }
  return html`<ul class="divide-y divide-line">${rows}</ul>`;
}

function header(store) {
  const { business, settings, status } = store;
  const state = statusInfo(status);
  return html`<header class="relative px-4 sm:px-8">
    <div class="-mt-10 flex items-end gap-4 sm:-mt-12">${logo(business)}</div>
    <h1 class="mt-3 text-[1.875rem] leading-[1.05] font-[820] [font-stretch:74%] sm:text-[2.75rem]">${business.name}</h1>
    ${business.description ? html`<p class="mt-2 max-w-[56ch] text-[1rem] text-muted">${business.description}</p>` : ""}
    <p class="mt-4 inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-full px-3.5 py-2 text-sm ${TONE_CLASS[state.tone]}">
      <span class="badge-dot inline-flex items-center gap-2 font-[700]">${state.label}</span>
      <span>· ${state.detail}</span>
    </p>
    ${settings.whatsappPhone
      ? html`<div class="mt-4">
          <a class="btn btn-ghost" href="${whatsappLink(settings.whatsappPhone, business.name)}" target="_blank" rel="noopener">
            ${icon("message-circle", "text-[#128c4b]")} Escribir por WhatsApp
          </a>
        </div>`
      : ""}
  </header>`;
}

function productCard(product, orderable) {
  const soldOut = !product.isAvailable;
  return html`<li class="flex gap-4 py-4 ${soldOut ? "is-sold-out" : ""}">
    <div class="flex min-w-0 flex-1 flex-col">
      <h3 class="text-[1.0625rem] leading-snug font-[680] [font-stretch:100%] ${soldOut ? "text-muted" : ""}">${product.name}</h3>
      ${product.description
        ? html`<p class="mt-1 line-clamp-2 text-[0.9375rem] leading-snug text-muted">${product.description}</p>`
        : ""}
      <p class="mt-auto flex flex-wrap items-center gap-2 pt-2">
        <span class="num text-[1.0625rem] font-[760] ${soldOut ? "text-muted line-through decoration-1" : ""}">${formatCOP(product.price)}</span>
        ${soldOut ? html`<span class="badge bg-tomato-soft text-tomato">Agotado</span>` : ""}
        ${orderable && !soldOut ? html`<span class="ml-auto" data-qty="${product.id}"></span>` : ""}
      </p>
    </div>
    ${product.imageUrl
      ? html`<div class="thumb h-[6.5rem] w-[6.5rem] rounded-[12px] sm:h-28 sm:w-28">
          <img src="${product.imageUrl}" alt="${product.name}" loading="lazy" decoding="async" width="112" height="112" />
        </div>`
      : ""}
  </li>`;
}

const sectionId = (index) => `cat-${index}`;

function menu(store) {
  if (store.categories.length === 0) {
    return html`<div class="mx-4 grid justify-items-center gap-3 rounded-[14px] border-2 border-dashed border-line px-6 py-14 text-center sm:mx-8">
      <span class="grid h-14 w-14 place-items-center rounded-full bg-mustard-soft">${icon("utensils", "h-7 w-7")}</span>
      <p class="text-lg font-[720]">El menú está en preparación</p>
      <p class="max-w-[38ch] text-[0.9375rem] text-muted">Este negocio todavía no ha publicado sus productos. Vuelve pronto.</p>
    </div>`;
  }

  const nav =
    store.categories.length > 1
      ? html`<nav aria-label="Categorías del menú" class="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur-[2px]">
          <ul class="no-scrollbar flex gap-2 overflow-x-auto px-4 py-3 sm:px-8" data-chips>
            ${store.categories.map(
              (category, index) => html`<li class="flex-none">
                <a class="cat-chip" href="#${sectionId(index)}" data-chip="${sectionId(index)}">${category.name}</a>
              </li>`,
            )}
          </ul>
        </nav>`
      : "";

  const orderable = canOrder(store);
  return html`${nav}
    <div class="pt-6"></div>
    ${orderingNotice(store)}
    <div class="grid gap-8 px-4 sm:px-8 lg:gap-10">
      ${store.categories.map(
        (category, index) => html`<section id="${sectionId(index)}" class="scroll-mt-20" aria-labelledby="${sectionId(index)}-title">
          <h2 id="${sectionId(index)}-title" class="display text-[1.75rem] sm:text-[2.125rem]">${category.name}</h2>
          <ul class="mt-1 divide-y divide-line lg:grid lg:grid-cols-2 lg:gap-x-10 lg:divide-y-0 lg:[&>li]:border-b lg:[&>li]:border-line">
            ${category.products.map((product) => productCard(product, orderable))}
          </ul>
        </section>`,
      )}
    </div>`;
}

function footer(store) {
  const { business } = store;
  return html`<footer class="mt-14 border-t border-line bg-ground">
    <div class="mx-auto grid max-w-[64rem] gap-2 px-4 py-8 text-sm text-muted sm:px-8">
      <p class="font-[680] text-ink">${business.name}</p>
      ${business.address ? html`<p>${[business.address, business.city].filter(Boolean).join(", ")}</p>` : ""}
      <p>Teléfono: <a class="text-ink" href="tel:+${business.phone}">${formatPhone(business.phone)}</a></p>
      <p class="mt-4">Tienda creada con <a class="font-[680] text-ink" href="/">PedifyAI</a></p>
    </div>
  </footer>`;
}

function page(store) {
  return html`<div class="mx-auto max-w-[64rem]">
      ${cover(store.business)}
      <div class="lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-10 lg:pr-8">
        ${header(store)}
        <div class="mx-4 mt-6 rounded-[14px] border border-line px-4 sm:mx-8 lg:mx-0 lg:mt-8">${details(store)}</div>
      </div>
      <main id="menu" class="mt-8 ${store.settings.whatsappPhone ? "pb-20" : ""}">${menu(store)}</main>
    </div>
    ${footer(store)}`;
}

function errorPage(error) {
  const notFound = error instanceof ApiError && error.status === 404;
  return html`<div class="grid min-h-dvh place-items-center p-6 text-center">
    <div class="grid max-w-sm justify-items-center gap-4">
      <span class="grid h-14 w-14 place-items-center rounded-full ${notFound ? "bg-mustard-soft" : "bg-tomato-soft text-tomato"}">
        ${icon(notFound ? "store" : "circle-alert", "h-7 w-7")}
      </span>
      <h1 class="text-2xl font-[780]">${notFound ? "Esta tienda no está disponible" : "No pudimos cargar el menú"}</h1>
      <p class="text-muted">${notFound ? "Revisa el enlace o pídele al negocio que te lo envíe de nuevo." : error.message}</p>
      ${notFound ? html`<a class="btn btn-ink" href="/">Ir a PedifyAI</a>` : html`<a class="btn btn-ink" href="">Intentar de nuevo</a>`}
    </div>
  </div>`;
}

// ───────────────────────────── Interacción ─────────────────────────────

/** Resalta la categoría visible y mantiene su ficha a la vista en la barra. */
function trackCategories() {
  const chips = new Map([...root.querySelectorAll("[data-chip]")].map((chip) => [chip.dataset.chip, chip]));
  if (chips.size === 0) return;
  const list = root.querySelector("[data-chips]");
  const setActive = (id) => {
    chips.forEach((chip, key) => chip.setAttribute("aria-current", key === id ? "true" : "false"));
    const active = chips.get(id);
    if (active && list.scrollWidth > list.clientWidth) {
      list.scrollTo({ left: active.offsetLeft - list.offsetLeft - 16, behavior: "smooth" });
    }
  };
  setActive([...chips.keys()][0]);
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id);
    },
    { rootMargin: "-25% 0px -60% 0px" },
  );
  root.querySelectorAll("#menu section[id]").forEach((section) => observer.observe(section));
}

async function loadStore() {
  // no-cache: revalida con el servidor (ETag) para mostrar al momento los productos agotados.
  const response = await fetch(`/api/v1/store/${encodeURIComponent(slug)}`, { headers: { Accept: "application/json" }, cache: "no-cache" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, payload?.error?.code ?? "ERROR", payload?.error?.message ?? "Intenta de nuevo en unos segundos.");
  }
  return payload.data;
}

try {
  const store = await loadStore();
  render(root, page(store));
  trackCategories();
  // Con la tienda cerrada igual se inicia: muestra el aviso de un pedido que quedó sin enviar.
  if (store.settings.whatsappPhone) initCart({ store, slug, root, orderable: canOrder(store) });
} catch (error) {
  const failure =
    error instanceof ApiError ? error : new ApiError(0, "NETWORK_ERROR", "Sin conexión. Revisa tu internet e intenta de nuevo.");
  render(root, errorPage(failure));
}

