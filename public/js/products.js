// Mi menú: productos y categorías (sección 6 del documento: "Menú digital" y "Categorías").
// Crear, editar, desactivar, marcar agotados y ordenar productos; fotos procesadas en el servidor.
import { api, formatCOP, formatThousands, parseMoney, upload } from "./api.js";
import { initPanel, renderNoBusiness } from "./dashboard.js";
import {
  checkImageFile,
  clearFieldErrors,
  formAlert,
  formatMoneyField,
  html,
  icon,
  moneyInput,
  render,
  setBusy,
  showErrors,
  shrinkPhoto,
  toast,
} from "./ui.js";

const CATEGORY_SUGGESTIONS = ["Salchipapas", "Hamburguesas", "Perros calientes", "Pizzas", "Bebidas", "Adicionales"];

const state = {
  business: null,
  isOwner: false,
  categories: [],
  products: [],
  ordering: false,
  query: "",
  /** Producto abierto en el editor: { product, photo: File|null, removePhoto, previewUrl } */
  editing: null,
};

let main;

// ───────────────────────────── Datos ─────────────────────────────

const normalize = (text) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const byPosition = (a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt);

function productsIn(categoryId) {
  return state.products.filter((product) => product.categoryId === categoryId).sort(byPosition);
}

/** Grupos en el orden de la tienda; "Sin categoría" al final si tiene productos. */
function groups() {
  const known = new Set(state.categories.map((category) => category.id));
  const result = state.categories.map((category) => ({ category, products: productsIn(category.id) }));
  const loose = state.products.filter((product) => !product.categoryId || !known.has(product.categoryId)).sort(byPosition);
  if (loose.length > 0) result.push({ category: null, products: loose });
  return result;
}

function matches(product) {
  if (!state.query) return true;
  const query = normalize(state.query);
  return normalize(product.name).includes(query) || normalize(product.description ?? "").includes(query);
}

async function loadMenu() {
  const [categories, products] = await Promise.all([api("/categories"), api("/products")]);
  state.categories = categories;
  state.products = products;
}

function syncCounts() {
  for (const category of state.categories) category.productCount = productsIn(category.id).length;
}

// ───────────────────────────── Plantillas ─────────────────────────────

function statsText() {
  const total = state.products.length;
  const soldOut = state.products.filter((product) => !product.isAvailable).length;
  const hidden = state.products.filter((product) => !product.isActive).length;
  const parts = [`${total} ${total === 1 ? "producto" : "productos"}`, `${state.categories.length} ${state.categories.length === 1 ? "categoría" : "categorías"}`];
  if (soldOut) parts.push(`${soldOut} agotado${soldOut === 1 ? "" : "s"}`);
  if (hidden) parts.push(`${hidden} oculto${hidden === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function thumb(product, size = "h-14 w-14") {
  return html`<span class="thumb ${size}">
    ${product.imageUrl ? html`<img src="${product.imageUrl}" alt="" loading="lazy" />` : icon("image", "h-5 w-5")}
  </span>`;
}

function moveButtons(kind, id, index, total, label) {
  return html`<span class="flex flex-none items-center gap-1">
    <button type="button" class="btn btn-ghost h-10 w-10 p-0" data-move-${kind}="${id}" data-delta="-1" ${index === 0 ? "disabled" : ""} aria-label="Subir ${label}">
      ${icon("arrow-up")}
    </button>
    <button type="button" class="btn btn-ghost h-10 w-10 p-0" data-move-${kind}="${id}" data-delta="1" ${index === total - 1 ? "disabled" : ""} aria-label="Bajar ${label}">
      ${icon("arrow-down")}
    </button>
  </span>`;
}

function productRow(product, index, list) {
  const { isOwner, ordering } = state;
  return html`<li class="flex items-center gap-3 px-4 py-3 sm:px-5" data-product="${product.id}">
    ${thumb(product)}
    <div class="min-w-0 flex-1">
      ${isOwner && !ordering
        ? html`<button type="button" class="line-clamp-2 max-w-full text-left leading-snug font-[650] hover:underline" data-edit="${product.id}">${product.name}</button>`
        : html`<p class="line-clamp-2 leading-snug font-[650]">${product.name}</p>`}
      <p class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span class="num font-[700]">${formatCOP(product.price)}</span>
        ${product.isActive ? "" : html`<span class="badge bg-ground text-muted">${icon("eye-off", "h-3.5 w-3.5")} Oculto</span>`}
        ${product.isAvailable ? "" : html`<span class="badge bg-tomato-soft text-tomato">Agotado</span>`}
      </p>
    </div>
    ${ordering
      ? moveButtons("product", product.id, index, list.length, product.name)
      : html`<label class="flex flex-none cursor-pointer items-center gap-2.5">
            <span class="hidden w-[4.75rem] text-right text-sm text-muted sm:inline">${product.isAvailable ? "Disponible" : "Agotado"}</span>
            <input type="checkbox" role="switch" class="switch" data-available="${product.id}" ${product.isAvailable ? "checked" : ""} aria-label="Disponible: ${product.name}" />
          </label>
          ${isOwner
            ? html`<button type="button" class="btn btn-quiet btn-icon hidden flex-none text-muted hover:text-ink sm:inline-flex" data-edit="${product.id}" aria-label="Editar ${product.name}" title="Editar">
                ${icon("pencil")}
              </button>`
            : ""}`}
  </li>`;
}

function categoryHeader(group, index, total) {
  const { category, products } = group;
  const { isOwner, ordering } = state;
  const name = category ? category.name : "Sin categoría";
  const actions =
    !isOwner || !category
      ? ""
      : ordering
        ? moveButtons("category", category.id, index, total, `la categoría ${category.name}`)
        : html`<span class="flex items-center">
            <button type="button" class="btn btn-quiet btn-icon text-muted hover:text-ink" data-rename="${category.id}" aria-label="Renombrar ${category.name}" title="Renombrar">
              ${icon("pencil")}
            </button>
            <button type="button" class="btn btn-quiet btn-icon text-muted hover:text-tomato" data-delete-category="${category.id}" aria-label="Eliminar ${category.name}" title="Eliminar categoría">
              ${icon("trash-2")}
            </button>
          </span>`;

  return html`<header class="flex min-h-[3.75rem] items-center gap-2 border-b border-line py-2 pr-2 pl-4 sm:pl-5" data-category-header>
      <h2 class="min-w-0 truncate text-lg font-[740]">${name}</h2>
      <span class="badge num bg-ground text-muted">${products.length}</span>
      <span class="ml-auto">${actions}</span>
    </header>
    ${category && isOwner
      ? html`<form class="hidden items-center gap-2 border-b border-line bg-ground/60 px-4 py-3 sm:px-5" data-rename-form="${category.id}" novalidate>
            <label class="sr-only" for="rename-${category.id}">Nuevo nombre de ${category.name}</label>
            <input class="input min-w-0 flex-1" id="rename-${category.id}" name="name" value="${category.name}" maxlength="40" required />
            <button type="submit" class="btn btn-ink">Guardar</button>
            <button type="button" class="btn btn-ghost" data-cancel-rename>Cancelar</button>
          </form>
          <div class="hidden flex-wrap items-center justify-end gap-2 border-b border-line bg-tomato-soft px-4 py-3 sm:px-5" data-delete-confirm="${category.id}">
            <p class="mr-auto text-sm font-medium text-tomato">
              ¿Eliminar «${category.name}»?
              ${products.length > 0
                ? `Sus ${products.length === 1 ? "un producto pasará" : `${products.length} productos pasarán`} a «Sin categoría».`
                : ""}
            </p>
            <button type="button" class="btn btn-ghost btn-sm" data-cancel-delete-category>Cancelar</button>
            <button type="button" class="btn btn-danger btn-sm" data-confirm-delete-category="${category.id}">Eliminar</button>
          </div>`
      : ""}`;
}

function categoryBlock(group, index, total) {
  const { category } = group;
  const visible = group.products.filter(matches);
  if (state.query && visible.length === 0) return "";
  const canAdd = state.isOwner && !state.ordering && !state.query;

  return html`<section class="panel overflow-hidden" data-group="${category?.id ?? "none"}" aria-label="${category ? category.name : "Sin categoría"}">
    ${categoryHeader(group, index, total)}
    ${visible.length > 0
      ? html`<ul class="divide-y divide-line">${visible.map((product, i) => productRow(product, i, visible))}</ul>`
      : html`<p class="px-5 py-5 text-[0.9375rem] text-muted">Aún no hay productos en esta categoría.</p>`}
    ${canAdd
      ? html`<button type="button" class="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-left text-[0.9375rem] font-[650] text-muted transition-colors hover:bg-ground hover:text-ink sm:px-5" data-new-product="${category?.id ?? ""}">
          ${icon("plus")}<span class="min-w-0 truncate">Agregar producto${category ? ` a ${category.name}` : ""}</span>
        </button>`
      : ""}
  </section>`;
}

function emptyMenu() {
  const existing = new Set(state.categories.map((category) => normalize(category.name)));
  const chips = [
    ...state.categories.map((category) => ({ name: category.name, done: true })),
    ...CATEGORY_SUGGESTIONS.filter((name) => !existing.has(normalize(name))).map((name) => ({ name, done: false })),
  ];
  return html`<section class="panel grid gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-10">
    <div class="grid gap-5">
      <span class="grid h-12 w-12 place-items-center rounded-full bg-mustard-soft">${icon("utensils", "h-6 w-6")}</span>
      <div class="grid gap-2">
        <h2 class="text-2xl font-[780]">Arma tu menú</h2>
        <p class="max-w-[46ch] text-muted">
          Empieza por las categorías de tu carta y luego agrega cada producto con su foto y su precio. Tus clientes lo verán en tu tienda al instante.
        </p>
      </div>
      <div class="grid gap-2.5">
        <p class="text-sm font-[650]">1. Toca para crear las categorías de tu carta:</p>
        <ul class="flex flex-wrap gap-2">
          ${chips.map((chip) =>
            chip.done
              ? html`<li class="choice cursor-default border-ink bg-mustard-soft">
                  <span class="choice-check border-ink bg-ink text-mustard">${icon("check", "h-3 w-3")}</span> ${chip.name}
                  <span class="sr-only">(creada)</span>
                </li>`
              : html`<li><button type="button" class="choice" data-suggest="${chip.name}">${icon("plus", "h-4 w-4")} ${chip.name}</button></li>`,
          )}
        </ul>
        <p class="text-sm font-[650]">2. Agrega tus productos con foto y precio:</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-primary" data-new-product="">${icon("plus")} Agregar mi primer producto</button>
        <button type="button" class="btn btn-ghost" data-show-category-form>${icon("folder-plus")} Otra categoría</button>
      </div>
      ${categoryForm({ inPanel: true })}
    </div>
    <div class="hidden self-stretch place-items-center rounded-[12px] bg-ground p-8 lg:grid" aria-hidden="true">
    <figure class="ticket ticket-shadow w-full max-w-[19rem] rotate-[1.5deg] p-5">
      <p class="display text-[1.6rem]">Salchipapas</p>
      <hr class="ticket-rule my-3" />
      <ul class="grid gap-2.5 text-[0.9375rem]">
        <li class="flex justify-between gap-3"><span>Salchipapa sencilla</span><span class="num font-[700]">$12.000</span></li>
        <li class="flex justify-between gap-3"><span>Salchipapa especial</span><span class="num font-[700]">$18.000</span></li>
        <li class="flex justify-between gap-3"><span>Salchipapa ranchera</span><span class="num font-[700]">$22.000</span></li>
      </ul>
      <hr class="ticket-rule my-3" />
      <p class="text-xs text-muted">Ejemplo ilustrativo</p>
    </figure>
    </div>
  </section>`;
}

function categoryForm({ inPanel = false } = {}) {
  return html`<form class="${inPanel ? "" : "panel p-4 sm:p-5"} hidden flex-wrap items-end gap-3" data-category-form novalidate>
    <div class="field min-w-[12rem] flex-1">
      <label class="label" for="new-category">Nueva categoría</label>
      <input class="input" id="new-category" name="name" maxlength="40" placeholder="Ej.: Bebidas" required />
    </div>
    <div class="flex gap-2">
      <button type="submit" class="btn btn-ink">${icon("plus")} Agregar</button>
      <button type="button" class="btn btn-ghost" data-hide-category-form>Cancelar</button>
    </div>
  </form>`;
}

function toolbar() {
  const { isOwner } = state;
  return html`<div class="flex flex-wrap items-center gap-2">
    <div class="input-group min-w-0 flex-1 basis-[16rem]">
      <label class="addon border-0 bg-transparent pr-0" for="menu-search">${icon("search")}<span class="sr-only">Buscar en el menú</span></label>
      <input class="input" id="menu-search" type="search" placeholder="Buscar producto" autocomplete="off" data-search />
    </div>
    ${isOwner
      ? html`<button type="button" class="btn btn-ghost" data-show-category-form>${icon("folder-plus")} Nueva categoría</button>
          <button type="button" class="btn btn-ghost" data-toggle-ordering aria-pressed="false">
            <span class="contents" data-order-icon>${icon("arrow-up-down")}</span> <span data-order-label>Ordenar</span>
          </button>`
      : ""}
  </div>`;
}

function switchRow(id, name, title, text) {
  return html`<label for="${id}" class="flex cursor-pointer items-start justify-between gap-4">
    <span class="grid gap-0.5">
      <span class="font-[650]">${title}</span>
      <span class="text-sm text-muted">${text}</span>
    </span>
    <input type="checkbox" role="switch" class="switch mt-0.5" id="${id}" name="${name}" />
  </label>`;
}

function editorDialog() {
  return html`<dialog id="product-editor" class="sheet" aria-labelledby="editor-title">
    <form class="flex min-h-0 flex-1 flex-col" data-product-form novalidate>
      <header class="flex items-center justify-between gap-3 border-b border-line py-3 pr-3 pl-5">
        <h2 id="editor-title" class="text-lg font-[760] outline-none" tabindex="-1">Nuevo producto</h2>
        <button type="button" class="btn btn-quiet btn-icon" data-close-editor aria-label="Cerrar">${icon("x")}</button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div class="grid gap-5">
          ${formAlert()}
          <div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
            <label class="dropzone h-28 w-28 sm:h-32 sm:w-32" data-dropzone>
              <input type="file" accept="image/*" class="sr-only" data-photo-input aria-label="Foto del producto" />
              <span class="grid justify-items-center gap-1 px-2 text-center text-xs font-[620]" data-photo-empty>
                ${icon("image-plus", "h-6 w-6")} Agregar foto
              </span>
              <img alt="" hidden data-photo-preview />
            </label>
            <div class="grid gap-2">
              <p class="font-[650]">Foto del producto</p>
              <p class="hint">Con buena luz y de frente se ve mejor. JPG, PNG o WebP de hasta 8 MB.</p>
              <div class="flex flex-wrap gap-2">
                <button type="button" class="btn btn-ghost btn-sm" data-pick-photo>${icon("upload")} <span data-pick-label>Elegir foto</span></button>
                <button type="button" class="btn btn-quiet btn-sm text-tomato" data-remove-photo hidden>Quitar foto</button>
              </div>
            </div>
          </div>

          <div class="field">
            <label class="label" for="p-name">Nombre</label>
            <input class="input" id="p-name" name="name" maxlength="80" placeholder="Ej.: Salchipapa especial" required />
          </div>

          <div class="grid gap-5 sm:grid-cols-2">
            <div class="field">
              <label class="label" for="p-price">Precio</label>
              ${moneyInput("p-price", "price", "", { required: true, placeholder: "15.000" })}
            </div>
            <div class="field">
              <label class="label" for="p-category">Categoría</label>
              <select class="input" id="p-category" name="categoryId"></select>
            </div>
          </div>

          <div class="field">
            <div class="flex items-baseline justify-between gap-3">
              <label class="label" for="p-description">Descripción <span class="font-normal text-muted">(opcional)</span></label>
              <span class="num text-xs text-muted" data-counter></span>
            </div>
            <textarea class="input" id="p-description" name="description" rows="3" maxlength="300" placeholder="Ej.: Papas a la francesa, salchicha, queso costeño y salsas de la casa."></textarea>
          </div>

          <div class="grid gap-4 rounded-[12px] border border-line p-4">
            ${switchRow("p-active", "isActive", "Visible en la tienda", "Apágalo para ocultarlo sin borrarlo (por ejemplo, un producto de temporada).")}
            ${switchRow("p-available", "isAvailable", "Disponible", "Apágalo cuando se agote: tus clientes lo verán como agotado.")}
          </div>
        </div>
      </div>

      <footer class="border-t border-line px-5 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))]">
        <div class="flex flex-wrap items-center justify-end gap-2" data-editor-actions>
          <button type="button" class="btn btn-quiet mr-auto px-3 text-tomato" data-delete-product aria-label="Eliminar producto" hidden>
            ${icon("trash-2")}<span class="hidden sm:inline">Eliminar</span>
          </button>
          <button type="button" class="btn btn-ghost" data-close-editor>Cancelar</button>
          <button type="submit" class="btn btn-ink">Guardar producto</button>
        </div>
        <div class="hidden flex-wrap items-center justify-end gap-2" data-delete-product-confirm>
          <p class="mr-auto text-sm font-medium text-tomato">¿Eliminar este producto? Si ya aparece en pedidos, se archiva.</p>
          <button type="button" class="btn btn-ghost btn-sm" data-cancel-delete-product>Cancelar</button>
          <button type="button" class="btn btn-danger btn-sm" data-confirm-delete-product>Sí, eliminar</button>
        </div>
      </footer>
    </form>
  </dialog>`;
}

function archivedSection() {
  return html`<details class="panel group" data-archived>
    <summary class="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 sm:px-5">
      ${icon("archive", "text-muted")}
      <span class="min-w-0 flex-1">
        <span class="block font-[650]">Productos archivados</span>
        <span class="block text-sm text-muted">Los que eliminaste pero aparecen en pedidos anteriores.</span>
      </span>
      ${icon("chevron-down", "text-muted transition-transform group-open:rotate-180")}
    </summary>
    <div class="border-t border-line" data-archived-list></div>
  </details>`;
}

function page() {
  const { isOwner, business } = state;
  return html`<div class="grid grid-cols-[minmax(0,1fr)] gap-6">
      <header class="flex flex-wrap items-end justify-between gap-4">
        <div class="min-w-0">
          <h1 class="text-[1.875rem] leading-tight font-[780] sm:text-[2.375rem]">Mi menú</h1>
          <p class="mt-1 text-[0.9375rem] text-muted" data-stats>${statsText()}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <a class="btn btn-ghost" href="${business.storeUrl}" target="_blank" rel="noopener">${icon("external-link")} Ver mi tienda</a>
          ${isOwner ? html`<button type="button" class="btn btn-primary" data-new-product="">${icon("plus")} Nuevo producto</button>` : ""}
        </div>
      </header>
      ${isOwner
        ? ""
        : html`<p class="flex items-start gap-2.5 rounded-[12px] border border-sky/20 bg-sky-soft px-4 py-3 text-[0.9375rem] font-medium text-sky">
            ${icon("info", "mt-0.5")} Puedes marcar productos como agotados o disponibles. Para editar el menú, pídeselo al propietario.
          </p>`}
      <div class="grid gap-3" data-toolbar-area></div>
      <div class="grid gap-5" data-menu></div>
      ${isOwner ? archivedSection() : ""}
    </div>
    ${isOwner ? editorDialog() : ""}`;
}

// ───────────────────────────── Dibujo ─────────────────────────────

function drawMenu() {
  syncCounts();
  main.querySelector("[data-stats]").textContent = statsText();
  const area = main.querySelector("[data-toolbar-area]");
  // Sin productos se muestra la guía para armar el menú (con las categorías ya creadas).
  const hasContent = state.products.length > 0;

  // La barra se dibuja una sola vez para no perder el foco del buscador.
  if (hasContent && !area.querySelector("[data-search]")) {
    render(area, html`${toolbar()} ${state.isOwner ? categoryForm() : ""}`);
  } else if (!hasContent) {
    // La guía de menú vacío trae su propio formulario de categoría.
    render(area, "");
  }
  area.hidden = !hasContent;
  const orderButton = area.querySelector("[data-toggle-ordering]");
  if (orderButton) {
    orderButton.setAttribute("aria-pressed", String(state.ordering));
    orderButton.classList.toggle("btn-ink", state.ordering);
    orderButton.classList.toggle("btn-ghost", !state.ordering);
    orderButton.querySelector("[data-order-label]").textContent = state.ordering ? "Listo" : "Ordenar";
    orderButton.querySelector("[data-order-icon]").innerHTML = String(icon(state.ordering ? "check" : "arrow-up-down"));
    orderButton.disabled = Boolean(state.query);
  }

  const list = main.querySelector("[data-menu]");
  if (!hasContent) {
    render(list, state.isOwner ? emptyMenu() : html`<p class="panel p-6 text-muted">Este negocio aún no tiene productos en su menú.</p>`);
    return;
  }

  const all = groups();
  const ordered = all.filter((group) => group.category);
  const blocks = all.map((group) => categoryBlock(group, ordered.indexOf(group), ordered.length));
  const anyVisible = state.products.some(matches);
  render(
    list,
    state.query && !anyVisible
      ? html`<p class="panel p-6 text-center text-muted">No hay productos que coincidan con «${state.query}».</p>`
      : html`${state.ordering
          ? html`<p class="flex items-start gap-2.5 rounded-[12px] bg-mustard-soft px-4 py-3 text-[0.9375rem] font-medium text-mustard-deep">
              ${icon("info", "mt-0.5")} Usa las flechas para cambiar el orden. Así aparecerán en tu tienda. Toca «Listo» al terminar.
            </p>`
          : ""}
        ${blocks}`,
  );
}

function refocus(selector) {
  requestAnimationFrame(() => main.querySelector(selector)?.focus());
}

// ───────────────────────────── Editor de productos ─────────────────────────────

const editor = () => document.getElementById("product-editor");
const editorForm = () => editor().querySelector("[data-product-form]");

function setPhotoPreview(url) {
  const form = editorForm();
  const preview = form.querySelector("[data-photo-preview]");
  preview.hidden = !url;
  if (url) preview.src = url;
  else preview.removeAttribute("src");
  form.querySelector("[data-photo-empty]").hidden = Boolean(url);
  form.querySelector("[data-remove-photo]").hidden = !url;
  form.querySelector("[data-pick-label]").textContent = url ? "Cambiar foto" : "Elegir foto";
}

function releasePreview() {
  if (state.editing?.previewUrl) URL.revokeObjectURL(state.editing.previewUrl);
}

function updateCounter() {
  const form = editorForm();
  const textarea = form.elements.description;
  form.querySelector("[data-counter]").textContent = `${textarea.value.length}/${textarea.maxLength}`;
}

function showDeleteConfirm(show) {
  const form = editorForm();
  form.querySelector("[data-editor-actions]").classList.toggle("hidden", show);
  form.querySelector("[data-editor-actions]").classList.toggle("flex", !show);
  form.querySelector("[data-delete-product-confirm]").classList.toggle("hidden", !show);
  form.querySelector("[data-delete-product-confirm]").classList.toggle("flex", show);
  if (show) form.querySelector("[data-cancel-delete-product]").focus();
}

function openEditor(product, categoryId = null) {
  const dialog = editor();
  const form = editorForm();
  releasePreview();
  state.editing = { product, photo: null, removePhoto: false, previewUrl: null, dirty: false };

  clearFieldErrors(form);
  form.reset();
  dialog.querySelector("#editor-title").textContent = product ? "Editar producto" : "Nuevo producto";

  const select = form.elements.categoryId;
  render(
    select,
    html`<option value="">Sin categoría</option>
      ${state.categories.map((category) => html`<option value="${category.id}">${category.name}</option>`)}`,
  );
  select.value = (product ? product.categoryId : categoryId) ?? "";

  form.elements.name.value = product?.name ?? "";
  form.elements.price.value = product ? formatThousands(product.price) : "";
  form.elements.description.value = product?.description ?? "";
  form.elements.isActive.checked = product ? product.isActive : true;
  form.elements.isAvailable.checked = product ? product.isAvailable : true;
  setPhotoPreview(product?.imageUrl ?? null);
  updateCounter();

  form.querySelector("[data-delete-product]").hidden = !product;
  showDeleteConfirm(false);

  dialog.showModal();
  // Al editar no se abre el teclado del celular: el foco va al título de la hoja.
  if (product) dialog.querySelector("#editor-title").focus();
  else form.elements.name.focus();
}

function closeEditor() {
  releasePreview();
  state.editing = null;
  editor().close();
}

function pickPhoto(file) {
  const form = editorForm();
  const problem = checkImageFile(file);
  if (problem) {
    showErrors(form, { message: problem });
    return;
  }
  clearFieldErrors(form);
  releasePreview();
  state.editing.photo = file;
  state.editing.removePhoto = false;
  state.editing.previewUrl = URL.createObjectURL(file);
  state.editing.dirty = true;
  setPhotoPreview(state.editing.previewUrl);
}

function upsertProduct(product) {
  const index = state.products.findIndex((item) => item.id === product.id);
  if (index === -1) state.products.push(product);
  else state.products[index] = product;
}

async function saveProduct(form) {
  const button = form.querySelector('[type="submit"]');
  const editing = state.editing;
  clearFieldErrors(form);
  setBusy(button, true);

  const priceText = form.elements.price.value.trim();
  const body = {
    name: form.elements.name.value.trim(),
    price: priceText === "" ? undefined : parseMoney(priceText),
    categoryId: form.elements.categoryId.value || null,
    description: form.elements.description.value.trim(),
    isActive: form.elements.isActive.checked,
    isAvailable: form.elements.isAvailable.checked,
  };

  let product;
  try {
    product = editing.product
      ? await api(`/products/${editing.product.id}`, { method: "PATCH", body })
      : await api("/products", { method: "POST", body });
  } catch (error) {
    setBusy(button, false);
    showErrors(form, error);
    return;
  }

  const isNew = !editing.product;
  editing.product = product;
  upsertProduct(product);

  try {
    if (editing.photo) {
      product = await upload(`/products/${product.id}/image`, await shrinkPhoto(editing.photo));
    } else if (editing.removePhoto) {
      product = await api(`/products/${product.id}/image`, { method: "DELETE" });
    }
    upsertProduct(product);
  } catch (error) {
    // El producto quedó guardado; solo falló la foto. Se deja el editor abierto para reintentar.
    setBusy(button, false);
    editor().querySelector("#editor-title").textContent = "Editar producto";
    form.querySelector("[data-delete-product]").hidden = false;
    drawMenu();
    showErrors(form, { message: `Guardamos el producto, pero la foto no se pudo subir: ${error.message}` });
    return;
  }

  setBusy(button, false);
  closeEditor();
  drawMenu();
  toast(isNew ? `«${product.name}» ya está en tu menú.` : "Cambios guardados.");
  refocus(`[data-edit="${product.id}"]`);
}

async function deleteProduct(button) {
  const product = state.editing.product;
  setBusy(button, true);
  try {
    const { result } = await api(`/products/${product.id}`, { method: "DELETE" });
    state.products = state.products.filter((item) => item.id !== product.id);
    setBusy(button, false);
    closeEditor();
    drawMenu();
    toast(
      result === "archived"
        ? `Archivamos «${product.name}» porque aparece en pedidos. Ya no se muestra en tu tienda.`
        : `Eliminaste «${product.name}».`,
    );
    const archived = main.querySelector("[data-archived]");
    if (archived?.open) loadArchived();
  } catch (error) {
    setBusy(button, false);
    showDeleteConfirm(false);
    showErrors(editorForm(), error);
  }
}

function bindEditor() {
  const dialog = editor();
  if (!dialog) return;
  const form = editorForm();
  const input = form.querySelector("[data-photo-input]");
  const dropzone = form.querySelector("[data-dropzone]");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveProduct(form);
  });

  form.addEventListener("input", (event) => {
    if (state.editing) state.editing.dirty = true;
    if (event.target.matches("[data-money]")) formatMoneyField(event.target);
    if (event.target.name === "description") updateCounter();
    if (event.target.getAttribute("aria-invalid") === "true") {
      event.target.removeAttribute("aria-invalid");
      form.querySelector(`[data-error-for="${CSS.escape(event.target.name)}"]`)?.remove();
    }
  });

  input.addEventListener("change", () => {
    if (input.files?.[0]) pickPhoto(input.files[0]);
    input.value = "";
  });

  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("is-over");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-over"));
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-over");
    const file = event.dataTransfer?.files?.[0];
    if (file) pickPhoto(file);
  });

  form.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.matches("[data-close-editor]")) closeEditor();
    if (target.matches("[data-pick-photo]")) input.click();
    if (target.matches("[data-remove-photo]")) {
      releasePreview();
      state.editing.photo = null;
      state.editing.previewUrl = null;
      state.editing.removePhoto = Boolean(state.editing.product?.imageUrl);
      state.editing.dirty = true;
      setPhotoPreview(null);
    }
    if (target.matches("[data-delete-product]")) showDeleteConfirm(true);
    if (target.matches("[data-cancel-delete-product]")) {
      showDeleteConfirm(false);
      form.querySelector("[data-delete-product]").focus();
    }
    if (target.matches("[data-confirm-delete-product]")) deleteProduct(target);
  });

  // Tocar fuera de la hoja la cierra, salvo que haya cambios sin guardar.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && !state.editing?.dirty) closeEditor();
  });
  dialog.addEventListener("close", releasePreview);
}

// ───────────────────────────── Acciones del menú ─────────────────────────────

async function toggleAvailability(input) {
  const product = state.products.find((item) => item.id === input.dataset.available);
  const next = input.checked;
  input.disabled = true;
  try {
    upsertProduct(await api(`/products/${product.id}`, { method: "PATCH", body: { isAvailable: next } }));
    drawMenu();
    toast(next ? `«${product.name}» está disponible de nuevo.` : `Marcaste «${product.name}» como agotado.`);
    refocus(`[data-available="${product.id}"]`);
  } catch (error) {
    input.checked = !next;
    input.disabled = false;
    toast(error.message, "error");
  }
}

async function moveProduct(button) {
  const product = state.products.find((item) => item.id === button.dataset.moveProduct);
  const delta = Number(button.dataset.delta);
  const siblings = productsIn(product.categoryId);
  const from = siblings.indexOf(product);
  const to = from + delta;
  if (to < 0 || to >= siblings.length) return;

  siblings.splice(to, 0, siblings.splice(from, 1)[0]);
  siblings.forEach((item, position) => (item.position = position));
  drawMenu();
  refocus(`[data-move-product="${product.id}"][data-delta="${delta}"]:not(:disabled), [data-move-product="${product.id}"]:not(:disabled)`);

  try {
    await api("/products/order", { method: "PUT", body: { categoryId: product.categoryId, productIds: siblings.map((item) => item.id) } });
  } catch (error) {
    toast(error.message, "error");
    await loadMenu();
    drawMenu();
  }
}

async function moveCategory(button) {
  const id = button.dataset.moveCategory;
  const delta = Number(button.dataset.delta);
  const list = [...state.categories].sort(byPosition);
  const from = list.findIndex((category) => category.id === id);
  const to = from + delta;
  if (to < 0 || to >= list.length) return;

  list.splice(to, 0, list.splice(from, 1)[0]);
  list.forEach((category, position) => (category.position = position));
  state.categories = list;
  drawMenu();
  refocus(`[data-move-category="${id}"][data-delta="${delta}"]:not(:disabled), [data-move-category="${id}"]:not(:disabled)`);

  try {
    await api("/categories/order", { method: "PUT", body: { categoryIds: list.map((category) => category.id) } });
  } catch (error) {
    toast(error.message, "error");
    await loadMenu();
    drawMenu();
  }
}

async function createCategory(name) {
  const category = await api("/categories", { method: "POST", body: { name } });
  state.categories.push(category);
  drawMenu();
  toast(`Categoría «${category.name}» creada.`);
  return category;
}

function toggleCategoryForm(show) {
  const form = main.querySelector("[data-category-form]");
  if (!form) return;
  form.classList.toggle("hidden", !show);
  form.classList.toggle("flex", show);
  if (show) form.elements.name.focus();
  else {
    form.reset();
    clearFieldErrors(form);
  }
}

function toggleInline(groupElement, selector, show) {
  const element = groupElement.querySelector(selector);
  element.classList.toggle("hidden", !show);
  element.classList.toggle("flex", show);
  groupElement.querySelector("[data-category-header]").classList.toggle("hidden", show);
}

async function loadArchived() {
  const container = main.querySelector("[data-archived-list]");
  render(container, html`<p class="px-5 py-4 text-sm text-muted">Cargando…</p>`);
  try {
    const archived = await api("/products?status=archived");
    render(
      container,
      archived.length === 0
        ? html`<p class="px-5 py-4 text-sm text-muted">No tienes productos archivados.</p>`
        : html`<ul class="divide-y divide-line">
            ${archived.map(
              (product) => html`<li class="flex items-center gap-3 px-4 py-3 sm:px-5">
                ${thumb(product, "h-11 w-11")}
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-[620]">${product.name}</span>
                  <span class="num block text-sm text-muted">${formatCOP(product.price)}</span>
                </span>
                <button type="button" class="btn btn-ghost btn-sm" data-restore="${product.id}">${icon("archive-restore")} Restaurar</button>
              </li>`,
            )}
          </ul>`,
    );
  } catch (error) {
    render(container, html`<p class="px-5 py-4 text-sm text-tomato">${error.message}</p>`);
  }
}

function bindPage() {
  main.addEventListener("click", async (event) => {
    const target = event.target.closest("button");
    if (!target) return;

    if (target.matches("[data-new-product]")) openEditor(null, target.dataset.newProduct || null);
    if (target.matches("[data-edit]")) {
      const product = state.products.find((item) => item.id === target.dataset.edit);
      if (product) openEditor(product);
    }
    if (target.matches("[data-move-product]")) moveProduct(target);
    if (target.matches("[data-move-category]")) moveCategory(target);
    if (target.matches("[data-toggle-ordering]")) {
      state.ordering = !state.ordering;
      drawMenu();
      if (!state.ordering) toast("Orden guardado. Así se verá tu menú en la tienda.");
    }
    if (target.matches("[data-show-category-form]")) toggleCategoryForm(true);
    if (target.matches("[data-hide-category-form]")) toggleCategoryForm(false);

    if (target.matches("[data-suggest]")) {
      setBusy(target, true);
      try {
        await createCategory(target.dataset.suggest);
      } catch (error) {
        setBusy(target, false);
        toast(error.message, "error");
      }
    }

    const group = target.closest("[data-group]");
    if (target.matches("[data-rename]")) {
      toggleInline(group, "[data-rename-form]", true);
      group.querySelector("[data-rename-form] input").select();
    }
    if (target.matches("[data-cancel-rename]")) {
      toggleInline(group, "[data-rename-form]", false);
      group.querySelector("[data-rename]").focus();
    }
    if (target.matches("[data-delete-category]")) {
      toggleInline(group, "[data-delete-confirm]", true);
      group.querySelector("[data-cancel-delete-category]").focus();
    }
    if (target.matches("[data-cancel-delete-category]")) {
      toggleInline(group, "[data-delete-confirm]", false);
      group.querySelector("[data-delete-category]").focus();
    }
    if (target.matches("[data-confirm-delete-category]")) {
      const category = state.categories.find((item) => item.id === target.dataset.confirmDeleteCategory);
      setBusy(target, true);
      try {
        await api(`/categories/${category.id}`, { method: "DELETE" });
        await loadMenu();
        drawMenu();
        toast(`Eliminaste la categoría «${category.name}».`);
      } catch (error) {
        setBusy(target, false);
        toast(error.message, "error");
      }
    }

    if (target.matches("[data-restore]")) {
      setBusy(target, true);
      try {
        const product = await api(`/products/${target.dataset.restore}/restore`, { method: "POST" });
        upsertProduct(product);
        drawMenu();
        loadArchived();
        toast(`«${product.name}» volvió a tu menú.`);
      } catch (error) {
        setBusy(target, false);
        toast(error.message, "error");
      }
    }
  });

  main.addEventListener("submit", async (event) => {
    const form = event.target;
    if (form.matches("[data-category-form]")) {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      setBusy(button, true);
      try {
        await createCategory(form.elements.name.value.trim());
        toggleCategoryForm(false);
      } catch (error) {
        showErrors(form, error);
      } finally {
        setBusy(button, false);
      }
    }
    if (form.matches("[data-rename-form]")) {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      setBusy(button, true);
      try {
        const updated = await api(`/categories/${form.dataset.renameForm}`, { method: "PATCH", body: { name: form.elements.name.value.trim() } });
        Object.assign(
          state.categories.find((item) => item.id === updated.id),
          updated,
        );
        drawMenu();
        toast("Categoría renombrada.");
        refocus(`[data-rename="${updated.id}"]`);
      } catch (error) {
        setBusy(button, false);
        showErrors(form, error);
      }
    }
  });

  main.addEventListener("input", (event) => {
    if (event.target.matches("[data-search]")) {
      state.query = event.target.value.trim();
      if (state.query) state.ordering = false;
      drawMenu();
    }
  });

  main.addEventListener("change", (event) => {
    if (event.target.matches("[data-available]")) toggleAvailability(event.target);
  });

  main.querySelector("[data-archived]")?.addEventListener("toggle", (event) => {
    if (event.target.open) loadArchived();
  });
}

// ───────────────────────────── Arranque ─────────────────────────────

const context = await initPanel("menu");
if (context) {
  main = context.main;
  if (!context.business) {
    renderNoBusiness(main);
  } else {
    state.business = context.business;
    state.isOwner = context.business.role === "OWNER";
    render(main, html`<div class="grid gap-6" aria-busy="true" aria-label="Cargando el menú"><div class="skeleton h-12 w-48"></div><div class="skeleton h-11"></div><div class="skeleton h-64"></div><div class="skeleton h-48"></div></div>`);
    try {
      await loadMenu();
      render(main, page());
      drawMenu();
      bindPage();
      bindEditor();
    } catch (error) {
      render(main, html`<p class="text-tomato">${error.message}</p>`);
    }
  }
}

