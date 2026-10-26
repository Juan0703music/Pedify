// Tienda pública de un negocio: /tienda/:slug (sección 8 del documento de arquitectura).
// Muestra logo, portada, horario, estado de atención y el catálogo por categorías;
// el carrito, el pedido y su seguimiento están en cart.js.
import { ApiError, formatCOP, formatPhone } from "./api.js";
import { initCart, PAYMENT_LABEL } from "./cart.js";
import { html, icon, initials, render, time12 } from "./ui.js";

const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
/** Semana colombiana: de lunes a domingo. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const root = document.getElementById("store");
const slug = decodeURIComponent(location.pathname.split("/")[2] ?? "");

// ───────────────────────────── Utilidades ─────────────────────────────

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

function whatsappLink(phone, businessName) {
  const text = `¡Hola, ${businessName}! Tengo una pregunta sobre su menú.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

/** Se puede pedir: abierto según el horario, sin pausa manual y con la tienda en línea habilitada. */
const canOrder = (store) => store.status.canOrder;

// ───────────────────────────── Partes de la página ─────────────────────────────
// «Noche de neón»: la tienda es de noche (fondo tinta) y la comida va a toda luz; el mostaza es el neón.

/** Estado del negocio en la portada: punto de color (late si está abierto) y el detalle. */
const STATUS_COLOR = { leaf: "text-leaf-glow", tomato: "text-tomato-glow", mustard: "text-mustard" };

/**
 * Nombre del negocio como letrero: la última palabra va en contorno mostaza. El tamaño se ajusta para
 * que la palabra más larga quepa en una línea (máximo 6rem).
 */
function neonName(name, id = "store-name") {
  const words = name.trim().split(/\s+/);
  const longest = Math.max(...words.map((word) => word.length));
  const fit = `max(2.5rem, min(6rem, calc((100vw - 2rem) / ${(longest * 0.56).toFixed(2)})))`;
  const last = words.length > 1 ? words.pop() : null;
  return html`<h1 id="${id}" class="neon-name" style="--fit: ${fit}">
    ${words.join(" ")}${last ? html` <span class="text-outline">${last}</span>` : ""}
  </h1>`;
}

function logo(business) {
  return business.logoUrl
    ? html`<span class="night-logo"><img src="${business.logoUrl}" alt="Logo de ${business.name}" /></span>`
    : html`<span class="night-logo" aria-hidden="true">${initials(business.name)}</span>`;
}

function statusPill(status) {
  const state = statusInfo(status);
  const live = status.isOpen && status.acceptingOrders;
  return html`<p class="night-status">
    <span class="night-status-dot ${STATUS_COLOR[state.tone]} ${live ? "is-live" : ""}" aria-hidden="true"></span>
    <span class="font-[720]">${state.label}</span>
    <span class="text-paper/70">· ${state.detail}</span>
  </p>`;
}

/** Portada: la foto del negocio a pantalla completa o, sin foto, un letrero de neón. */
function hero(store) {
  const { business, settings, status } = store;
  const withPhoto = Boolean(business.bannerUrl);
  return html`<header class="night-hero ${withPhoto ? "" : "night-sign"}" aria-labelledby="store-name">
    ${withPhoto
      ? html`<img src="${business.bannerUrl}" alt="" class="night-hero-photo" fetchpriority="high" />`
      : html`<span class="night-sign-echo" aria-hidden="true">${business.name}</span>`}
    <div class="mx-auto w-full max-w-[72rem] px-4 pt-24 pb-7 sm:px-8 sm:pb-11">
      <div class="flex flex-wrap items-center gap-3">${logo(business)} ${statusPill(status)}</div>
      <div class="mt-5">${neonName(business.name)}</div>
      ${business.description
        ? html`<p class="mt-4 max-w-[46ch] text-[1.0625rem] leading-snug text-paper/80 sm:text-[1.1875rem]">${business.description}</p>`
        : ""}
      <div class="mt-6 flex flex-wrap items-center gap-2.5">
        ${store.categories.length > 0
          ? html`<a class="btn btn-primary min-h-12 px-5 text-base" href="#menu">${icon("utensils")} Ver el menú</a>`
          : ""}
        ${settings.whatsappPhone
          ? html`<a class="btn btn-whatsapp min-h-12 px-4" href="${whatsappLink(settings.whatsappPhone, business.name)}" target="_blank" rel="noopener">
              ${icon("message-circle")} WhatsApp
            </a>`
          : ""}
      </div>
    </div>
  </header>`;
}

function hoursList(settings) {
  const today = todayIn(settings.timezone);
  return html`<ul class="grid gap-0.5 text-[0.9375rem]">
    ${WEEK_ORDER.map((day) => {
      const entry = settings.openingHours.find((item) => item.day === day);
      const text = !entry || entry.closed ? "Cerrado" : `${time12(entry.open)} – ${time12(entry.close)}`;
      const isToday = day === today;
      return html`<li class="flex justify-between gap-4 rounded-[10px] px-3 py-2 ${isToday ? "bg-mustard font-[700] text-ink" : ""}">
        <span>${capitalize(DAY_NAMES[day])}${isToday ? html`<span class="sr-only"> (hoy)</span>` : ""}</span>
        <span class="num ${isToday ? "" : !entry || entry.closed ? "text-paper/45" : "text-paper/85"}">${text}</span>
      </li>`;
    })}
  </ul>`;
}

/** Horario de hoy para la ficha del horario. */
function todayHours(settings) {
  const entry = settings.openingHours.find((item) => item.day === todayIn(settings.timezone));
  return !entry || entry.closed ? "hoy cerrado" : `hoy ${time12(entry.open)} – ${time12(entry.close)}`;
}

/** Domicilio, recoger, mínimo, pagos, dirección y horario: fichas en una fila deslizable. */
function facts(store) {
  const { business, settings } = store;
  const items = [];
  if (settings.deliveryEnabled) {
    // Según la distancia: desde el rango más barato, a toda la ciudad o hasta donde llegue.
    const tiers = settings.deliveryPricing === "DISTANCE" ? (settings.deliveryTiers ?? []) : [];
    const reach = settings.deliveryWholeCity ? "toda la ciudad" : `hasta ${String(settings.deliveryReachKm).replace(".", ",")} km`;
    const price =
      tiers.length > 0
        ? `desde ${formatCOP(Math.min(...tiers.map((tier) => tier.fee)))} · ${reach}`
        : settings.deliveryFee > 0
          ? formatCOP(settings.deliveryFee)
          : "gratis";
    items.push(html`<span class="fact">${icon("bike")} Domicilio
      <span class="num font-[720]">${price}</span>
      ${settings.deliveryArea ? html`<span class="text-paper/55">· ${settings.deliveryArea}</span>` : ""}</span>`);
  }
  if (settings.pickupEnabled) items.push(html`<span class="fact">${icon("shopping-bag")} Recoger en el local</span>`);
  if (settings.minimumOrder > 0) {
    items.push(html`<span class="fact">${icon("receipt")} Mínimo <span class="num font-[720]">${formatCOP(settings.minimumOrder)}</span></span>`);
  }
  if (settings.paymentMethods.length > 0) {
    items.push(html`<span class="fact">${icon("wallet")} ${settings.paymentMethods.map((method) => PAYMENT_LABEL[method] ?? method).join(" · ")}</span>`);
  }
  if (business.address || business.city) {
    const place = [business.address, business.city].filter(Boolean).join(", ");
    items.push(html`<a class="fact" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}" target="_blank" rel="noopener">
      ${icon("map-pin")} ${place}
    </a>`);
  }
  items.push(html`<button type="button" class="fact" aria-expanded="false" aria-controls="hours-panel" data-hours-toggle>
    ${icon("clock")} Horario <span class="text-paper/60">· ${todayHours(settings)}</span> ${icon("chevron-down", "!h-4 !w-4 !text-current")}
  </button>`);
  return html`<div class="mx-auto max-w-[72rem]">
    <ul class="no-scrollbar flex gap-2 overflow-x-auto px-4 pt-2 pb-1 sm:px-8 lg:flex-wrap lg:overflow-visible" aria-label="Datos del negocio">
      ${items.map((item) => html`<li class="flex-none">${item}</li>`)}
    </ul>
    <div id="hours-panel" class="mx-4 mt-2 max-w-sm rounded-[20px] bg-ink-2 p-2 sm:mx-8" hidden>${hoursList(settings)}</div>
  </div>`;
}

/** Aviso sobre el menú cuando no se reciben pedidos en este momento. */
function orderingNotice(store) {
  if (canOrder(store) || store.categories.length === 0) return "";
  const { status } = store;
  let title = "Por ahora no recibimos pedidos en línea";
  let text = "Puedes ver el menú y escribirle al negocio.";
  if (!status.isOpen) {
    title = "Estamos cerrados";
    const detail = statusInfo(status).detail;
    text = `Puedes ver el menú; ${detail}${detail.endsWith(".") ? "" : "."}`;
  } else if (!status.acceptingOrders) {
    title = "Pedidos en pausa";
    text = "El negocio no está recibiendo pedidos en este momento. Vuelve a intentarlo más tarde.";
  }
  return html`<div class="mx-auto max-w-[72rem] px-4 pt-6 sm:px-8">
    <div class="flex items-start gap-3 rounded-[18px] bg-ink-2 px-4 py-3.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]">
      <span class="mt-0.5 text-mustard">${icon("clock")}</span>
      <p class="text-[0.9375rem] text-paper/80"><span class="font-[720] text-paper">${title}.</span> ${text}</p>
    </div>
  </div>`;
}

/** Producto del menú: fila con foto a la derecha en el celular; tarjeta con foto arriba en escritorio. */
function productCard(product, orderable) {
  const soldOut = !product.isAvailable;
  return html`<li class="menu-row product-card ${soldOut ? "is-sold-out" : ""}">
    <div class="flex min-w-0 flex-col">
      <h3>
        <button type="button" class="product-open text-left text-[1.0625rem] leading-snug font-[700] ${soldOut ? "text-paper/55" : ""}" data-product="${product.id}">
          ${product.name}
        </button>
      </h3>
      ${product.description ? html`<p class="mt-1 line-clamp-2 text-[0.9375rem] leading-snug text-paper/65">${product.description}</p>` : ""}
      <p class="mt-auto flex flex-wrap items-center gap-2 pt-3">
        <span class="num text-[1.125rem] font-[780] ${soldOut ? "text-paper/45 line-through decoration-1" : "text-mustard"}">${formatCOP(product.price)}</span>
        ${soldOut ? html`<span class="badge bg-tomato-glow/15 text-tomato-glow">Agotado</span>` : ""}
        ${orderable && !soldOut ? html`<span class="ml-auto" data-qty="${product.id}"></span>` : ""}
      </p>
    </div>
    ${product.imageUrl
      ? html`<div class="menu-photo photo">
          <img src="${product.imageUrl}" alt="${product.name}" loading="lazy" decoding="async" width="400" height="300" />
        </div>`
      : html`<div class="menu-noimage" aria-hidden="true">${icon("utensils", "h-8 w-8")}</div>`}
  </li>`;
}

/** Carrusel de cine: los más pedidos del último mes (o, sin ventas aún, los productos con foto). */
function featured(store, orderable) {
  const byId = new Map(store.categories.flatMap((category) => category.products).map((product) => [product.id, product]));
  const items = (store.featured?.productIds ?? []).map((id) => byId.get(id)).filter(Boolean);
  if (items.length < 2) return "";
  const popular = store.featured.kind === "popular";
  return html`<section class="pt-12" aria-labelledby="featured-title">
    <div class="mx-auto flex max-w-[72rem] items-end justify-between gap-4 px-4 sm:px-8">
      <h2 id="featured-title" class="display text-[2.75rem] sm:text-[3.75rem]">
        ${popular ? html`Los más <span class="text-outline">pedidos</span>` : html`Para abrir <span class="text-outline">el apetito</span>`}
      </h2>
      ${popular ? html`<span class="badge mb-1.5 flex-none bg-mustard text-ink">${icon("flame", "h-3.5 w-3.5")} Este mes</span>` : ""}
    </div>
    <ul class="reel mt-6">
      ${items.map(
        (product, index) => html`<li class="reel-card product-card ${product.isAvailable ? "" : "is-sold-out"}">
          <img src="${product.imageUrl}" alt="${product.name}" loading="${index < 2 ? "eager" : "lazy"}" decoding="async" width="400" height="500" />
          ${popular && index < 3 ? html`<span class="reel-rank" aria-hidden="true">${index + 1}</span>` : ""}
          <div class="flex items-end gap-3 p-4">
            <button type="button" class="product-open min-w-0 flex-1 text-left" data-product="${product.id}">
              <span class="block text-[1.375rem] leading-[1.02] font-[800] [font-stretch:76%]">${product.name}</span>
              <span class="num mt-1.5 block text-[1.0625rem] font-[780] text-mustard">${formatCOP(product.price)}</span>
            </button>
            ${orderable && product.isAvailable ? html`<span class="flex-none" data-qty="${product.id}"></span>` : ""}
          </div>
        </li>`,
      )}
    </ul>
  </section>`;
}

/** Ficha del producto con la foto en grande (se abre al tocar un producto). */
function detailView(product, orderable) {
  const soldOut = !product.isAvailable;
  return html`<div class="relative flex min-h-0 flex-auto flex-col">
    <div class="min-h-0 flex-auto overflow-y-auto">
      ${product.imageUrl
        ? html`<div class="photo aspect-[4/3] w-full sm:aspect-[16/10]" data-detail-photo>
            <img src="${product.imageUrl}" alt="${product.name}" class="${soldOut ? "opacity-60 grayscale" : ""}" />
          </div>`
        : html`<div class="menu-noimage grid h-32" aria-hidden="true">${icon("utensils", "h-8 w-8")}</div>`}
      <div class="grid gap-3 px-5 pt-6 pb-7 sm:px-7" data-detail-body>
        <h2 id="detail-title" class="display text-[2.5rem] outline-none sm:text-[3rem]" tabindex="-1">${product.name}</h2>
        <p class="flex flex-wrap items-center gap-2">
          <span class="num text-[1.5rem] font-[800] ${soldOut ? "text-paper/45 line-through decoration-1" : "text-mustard"}">${formatCOP(product.price)}</span>
          ${soldOut ? html`<span class="badge bg-tomato-glow/15 text-tomato-glow">Agotado</span>` : ""}
        </p>
        ${product.description ? html`<p class="max-w-[60ch] text-[1.0625rem] leading-relaxed text-paper/75">${product.description}</p>` : ""}
      </div>
    </div>
    <footer class="border-t border-paper/10 px-5 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-7" data-detail-footer>
      ${orderable && !soldOut
        ? html`<div data-qty="${product.id}" data-qty-size="lg"></div>`
        : html`<p class="py-2 text-center text-[0.9375rem] text-paper/65">
            ${soldOut ? "Este producto está agotado por ahora." : "Por ahora no recibimos pedidos en línea."}
          </p>`}
    </footer>
    <button type="button" class="btn btn-icon absolute top-3 right-3 rounded-full bg-ink/85 text-paper shadow-[var(--shadow-lift)] hover:bg-ink" data-close-detail aria-label="Cerrar">
      ${icon("x")}
    </button>
  </div>`;
}

const sectionId = (index) => `cat-${index}`;

function menu(store) {
  if (store.categories.length === 0) {
    return html`<div class="mx-auto max-w-[72rem] px-4 pt-10 sm:px-8">
      <div class="grid justify-items-center gap-3 rounded-[22px] bg-ink-2 px-6 py-16 text-center">
        <span class="grid h-14 w-14 place-items-center rounded-full bg-mustard text-ink">${icon("utensils", "h-7 w-7")}</span>
        <p class="display text-[2rem]">El menú está en preparación</p>
        <p class="max-w-[38ch] text-[0.9375rem] text-paper/65">Este negocio todavía no ha publicado sus productos. Vuelve pronto.</p>
      </div>
    </div>`;
  }

  const nav =
    store.categories.length > 1
      ? html`<nav aria-label="Categorías del menú" class="night-nav mt-12">
          <ul class="no-scrollbar mx-auto flex max-w-[72rem] gap-2 overflow-x-auto px-4 py-3 sm:px-8" data-chips>
            ${store.categories.map(
              (category, index) => html`<li class="flex-none">
                <a class="cat-chip" href="#${sectionId(index)}" data-chip="${sectionId(index)}">${category.name}</a>
              </li>`,
            )}
          </ul>
        </nav>`
      : html`<div class="mt-6"></div>`;

  const orderable = canOrder(store);
  return html`${featured(store, orderable)} ${nav} ${orderingNotice(store)}
    <div class="mx-auto grid max-w-[72rem] gap-14 px-4 pt-9 sm:px-8 lg:gap-16">
      ${store.categories.map(
        (category, index) => html`<section id="${sectionId(index)}" class="scroll-mt-20" aria-labelledby="${sectionId(index)}-title">
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="${sectionId(index)}-title" class="display text-[2.5rem] sm:text-[3.25rem]">${category.name}</h2>
            <span class="num text-sm font-[650] whitespace-nowrap text-paper/50">${category.products.length} ${category.products.length === 1 ? "producto" : "productos"}</span>
          </div>
          <ul class="mt-2 lg:mt-6 lg:grid lg:grid-cols-3 lg:gap-5">
            ${category.products.map((product) => productCard(product, orderable))}
          </ul>
        </section>`,
      )}
    </div>`;
}

function footer(store) {
  const { business } = store;
  return html`<footer class="mt-24 border-t border-paper/10">
    <div class="mx-auto grid max-w-[72rem] gap-2 px-4 pt-10 pb-28 text-sm text-paper/60 sm:px-8">
      <p class="display text-[2.25rem] text-paper">${business.name}</p>
      ${business.address ? html`<p>${[business.address, business.city].filter(Boolean).join(", ")}</p>` : ""}
      <p>Teléfono: <a class="text-paper underline" href="tel:+${business.phone}">${formatPhone(business.phone)}</a></p>
      <p class="mt-5">Tienda creada con <a class="font-[700] text-mustard" href="/">Pedify</a></p>
    </div>
  </footer>`;
}

/**
 * Cliente en el local: llegó por el QR de una mesa (?mesa=4) o el general del local (?local=1).
 * Se recuerda en esta pestaña por si recarga la página. null si pide desde fuera del local.
 */
function inStoreVisit(store) {
  if (!store.settings.dineInEnabled) return null;
  const key = `pedify:mesa:${slug}`;
  const params = new URLSearchParams(location.search);
  let visit = null;
  if (params.has("mesa")) visit = { table: params.get("mesa").trim().slice(0, 20) || null };
  else if (params.has("local")) visit = { table: null };
  try {
    if (visit) sessionStorage.setItem(key, JSON.stringify(visit));
    else visit = JSON.parse(sessionStorage.getItem(key) ?? "null");
  } catch {
    // Sin almacenamiento: vale mientras la página siga abierta.
  }
  return visit;
}

/** Franja de bienvenida para quien pide desde la mesa. */
function tableBanner(visit, store) {
  return html`<section class="bg-mustard text-ink" aria-label="Pedido desde la mesa">
    <div class="mx-auto flex max-w-[72rem] items-center gap-3 px-4 py-3 sm:px-8">
      <span class="grid h-10 w-10 flex-none place-items-center rounded-full bg-ink text-mustard">${icon("utensils", "h-5 w-5")}</span>
      <p class="min-w-0 text-[0.9375rem] leading-snug">
        <span class="font-[800]">${visit.table ? `Estás en la mesa ${visit.table}` : `Estás en ${store.business.name}`}.</span>
        Pide desde tu celular y te lo llevamos a la mesa.
      </p>
    </div>
  </section>`;
}

function page(store, visit) {
  return html`${hero(store)} ${visit ? tableBanner(visit, store) : ""} ${facts(store)}
    <main id="menu" class="scroll-mt-4">${menu(store)}</main>
    ${footer(store)}
    <dialog id="product-detail" class="sheet sheet-night" aria-labelledby="detail-title"></dialog>`;
}

function errorPage(error) {
  const notFound = error instanceof ApiError && error.status === 404;
  return html`<div class="grid min-h-dvh place-items-center p-6 text-center">
    <div class="grid max-w-sm justify-items-center gap-4">
      <span class="grid h-14 w-14 place-items-center rounded-full ${notFound ? "bg-mustard text-ink" : "bg-tomato-glow/15 text-tomato-glow"}">
        ${icon(notFound ? "store" : "circle-alert", "h-7 w-7")}
      </span>
      <h1 class="display text-[2.5rem]">${notFound ? "Esta tienda no está disponible" : "No pudimos cargar el menú"}</h1>
      <p class="text-paper/70">${notFound ? "Revisa el enlace o pídele al negocio que te lo envíe de nuevo." : error.message}</p>
      ${notFound ? html`<a class="btn btn-primary" href="/">Ir a Pedify</a>` : html`<a class="btn btn-primary" href="">Intentar de nuevo</a>`}
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

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE_OUT_EXPO = "cubic-bezier(0.16, 1, 0.3, 1)";

/** Foto de un producto en la página (fila del menú o tarjeta del carrusel). */
const photoOf = (element) => element?.closest(".product-card")?.querySelector(".menu-photo img, .reel-card > img") ?? null;

/**
 * La foto vuela desde la tarjeta hasta su lugar en la ficha. Va en una capa superior (popover) para
 * pasar por encima de la ficha abierta; sin soporte de popover o con «reducir movimiento», la ficha
 * se abre como siempre.
 */
function morphFromCard(dialog, source) {
  const target = dialog.querySelector("[data-detail-photo]");
  if (!source || !target || reducedMotion() || !("showPopover" in HTMLElement.prototype)) return false;
  const from = source.getBoundingClientRect();
  if (from.width === 0 || from.bottom < 0 || from.top > window.innerHeight) return false;

  dialog.classList.add("is-morph");
  const to = target.getBoundingClientRect();
  const ghost = document.createElement("img");
  ghost.src = source.currentSrc || source.src;
  ghost.alt = "";
  ghost.className = "morph-ghost";
  ghost.popover = "manual";
  Object.assign(ghost.style, { inset: "auto", left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, padding: "0", border: "0", background: "transparent", overflow: "visible" });
  document.body.append(ghost);
  ghost.showPopover();
  target.style.visibility = "hidden";

  // Escala para cubrir la foto de origen y recorte con su forma (redondeada) al empezar.
  const scale = Math.max(from.width / to.width, from.height / to.height);
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const insetX = Math.max(0, (to.width - from.width / scale) / 2);
  const insetY = Math.max(0, (to.height - from.height / scale) / 2);
  const radius = (parseFloat(getComputedStyle(source.parentElement).borderTopLeftRadius) || 20) / scale;
  const flight = ghost.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, clipPath: `inset(${insetY}px ${insetX}px round ${radius}px)` },
      { transform: "none", clipPath: "inset(0px 0px round 0px)" },
    ],
    { duration: 620, easing: EASE_OUT_EXPO },
  );
  dialog.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
  for (const [element, delay] of [
    [dialog.querySelector("[data-detail-body]"), 140],
    [dialog.querySelector("[data-detail-footer]"), 200],
  ]) {
    element?.animate([{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }], { duration: 520, delay, easing: EASE_OUT_EXPO, fill: "backwards" });
  }
  const land = () => {
    target.style.visibility = "";
    ghost.remove();
  };
  flight.finished.then(land, land);
  return true;
}

/** Al agregar desde el menú, el plato vuela hasta el contador de la barra del carrito. */
function flyToCart(fromRect, src) {
  const counter = document.querySelector(".cart-bar[data-open-cart] > span");
  if (!counter || reducedMotion()) return;
  const to = counter.getBoundingClientRect();
  const size = Math.min(fromRect.width, fromRect.height, 88);
  const left = fromRect.left + fromRect.width / 2 - size / 2;
  const top = fromRect.top + fromRect.height / 2 - size / 2;
  const outer = document.createElement("div");
  outer.className = "fly-ghost";
  Object.assign(outer.style, { left: `${left}px`, top: `${top}px`, width: `${size}px`, height: `${size}px` });
  const inner = document.createElement(src ? "img" : "span");
  if (src) {
    inner.src = src;
    inner.alt = "";
  }
  Object.assign(inner.style, {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    borderRadius: "999px",
    background: "var(--color-mustard)",
    boxShadow: "0 0 0 3px var(--color-mustard), 0 14px 30px -10px rgb(0 0 0 / 0.7)",
  });
  outer.append(inner);
  document.body.append(outer);

  const dx = to.left + to.width / 2 - (left + size / 2);
  const dy = to.top + to.height / 2 - (top + size / 2);
  const duration = 720;
  // Horizontal parejo y vertical en dos tramos (sube frenando, cae acelerando): describe un arco.
  const lift = Math.min(90, Math.max(40, Math.abs(dy) * 0.18));
  const end = Math.max(0.2, to.height / size);
  outer.animate([{ transform: "translateX(0)" }, { transform: `translateX(${dx}px)` }], { duration, easing: "cubic-bezier(0.4, 0, 0.6, 1)", fill: "forwards" });
  const fall = inner.animate(
    [
      { transform: "translateY(0) scale(1)", easing: "cubic-bezier(0.2, 0.6, 0.4, 1)" },
      { transform: `translateY(${-lift}px) scale(0.92)`, offset: 0.3, easing: "cubic-bezier(0.6, 0, 0.9, 0.4)" },
      { transform: `translateY(${dy}px) scale(${end})`, opacity: 0.85 },
    ],
    { duration, fill: "forwards" },
  );
  const done = () => {
    outer.remove();
    document
      .querySelector(".cart-bar[data-open-cart] > span")
      ?.animate([{ transform: "scale(1)" }, { transform: "scale(1.5)" }, { transform: "scale(1)" }], { duration: 460, easing: EASE_OUT_EXPO });
  };
  fall.finished.then(done, done);
}

function bindFlights() {
  // En captura: se mide la foto antes de que el carrito vuelva a dibujar el control.
  document.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest?.("[data-inc]");
      if (!button || button.disabled || !root.contains(button) || button.closest("dialog")) return;
      const photo = photoOf(button);
      const fromRect = (photo ?? button).getBoundingClientRect();
      const src = photo ? photo.currentSrc || photo.src : null;
      requestAnimationFrame(() => flyToCart(fromRect, src));
    },
    { capture: true },
  );
}

/** Ficha del horario: despliega la semana debajo de las fichas del negocio. */
function bindHours() {
  root.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-hours-toggle]");
    if (!toggle) return;
    const panel = document.getElementById("hours-panel");
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    panel.hidden = !open;
  });
}

/** Ficha del producto: se abre al tocar un producto; el control de cantidad lo dibuja el carrito. */
function bindDetail(store, cart) {
  const dialog = document.getElementById("product-detail");
  const products = new Map(store.categories.flatMap((category) => category.products).map((product) => [product.id, product]));
  let opener = null;

  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-product]");
    const product = button && products.get(button.dataset.product);
    if (!product) return;
    opener = button;
    render(dialog, detailView(product, Boolean(cart) && canOrder(store)));
    cart?.refresh();
    dialog.showModal();
    try {
      morphFromCard(dialog, photoOf(button));
    } catch {
      // Si algo falla en la animación, la ficha ya está abierta y se ve completa.
      dialog.querySelector("[data-detail-photo]")?.style.removeProperty("visibility");
    }
    dialog.querySelector("#detail-title")?.focus({ preventScroll: true });
  });
  dialog.addEventListener("click", (event) => {
    // "Ver mi pedido" abre el carrito: primero se cierra la ficha.
    if (event.target === dialog || event.target.closest("[data-close-detail], [data-open-cart]")) dialog.close();
  });
  dialog.addEventListener("close", () => {
    dialog.classList.remove("is-morph");
    opener?.focus({ preventScroll: true });
  });
}

try {
  const store = await loadStore();
  const visit = inStoreVisit(store);
  render(root, page(store, visit));
  trackCategories();
  bindHours();
  // Con la tienda cerrada igual se inicia: muestra el seguimiento del último pedido.
  const cart = initCart({ store, slug, root, orderable: canOrder(store), inStore: visit });
  bindDetail(store, cart);
  bindFlights();
} catch (error) {
  const failure =
    error instanceof ApiError ? error : new ApiError(0, "NETWORK_ERROR", "Sin conexión. Revisa tu internet e intenta de nuevo.");
  render(root, errorPage(failure));
}
