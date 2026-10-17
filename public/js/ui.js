// Utilidades de interfaz compartidas: plantillas HTML seguras, íconos, avisos, formularios e imágenes.
import { formatThousands, parseMoney } from "./api.js";

const SPRITE = "/assets/icons/sprite.svg";

class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

/** Marca un texto como HTML ya seguro (no se escapa). */
export const raw = (value) => new SafeHtml(String(value));

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function interpolate(value) {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(interpolate).join("");
  return escapeHtml(value);
}

/**
 * Plantilla que escapa todos los valores interpolados (protección contra XSS con datos
 * escritos por usuarios, como nombres de negocios). Los resultados anidados de `html` no se re-escapan.
 */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, index) => {
    out += interpolate(value) + strings[index + 1];
  });
  return new SafeHtml(out);
}

export function icon(name, className = "") {
  return raw(`<svg class="icon ${className}" aria-hidden="true" focusable="false"><use href="${SPRITE}#i-${name}"></use></svg>`);
}

export function render(element, template) {
  element.innerHTML = String(template);
}

/** Logotipo de Pedify: comanda + nombre. */
export function brand({ onInk = false, size = "md" } = {}) {
  const box = size === "lg" ? "h-9 w-9" : "h-7 w-7";
  const text = size === "lg" ? "text-[1.6rem]" : "text-[1.3rem]";
  return html`<span class="inline-flex items-center gap-2">
    <img src="/assets/icons/logo.svg" alt="" class="${box}" width="32" height="32" />
    <span class="${text} leading-none font-[850] tracking-tight [font-stretch:72%] ${onInk ? "text-paper" : "text-ink"}"
      >Pedify</span
    >
  </span>`;
}

// ─── Avisos ───

let toastRegion;

/** Muestra un aviso breve. `tone`: "success" | "error" | "info". */
export function toast(message, tone = "success") {
  if (!toastRegion) {
    toastRegion = document.createElement("div");
    toastRegion.className =
      "pointer-events-none fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-50 grid justify-items-center gap-2 px-4 lg:bottom-6";
    toastRegion.setAttribute("role", "status");
    toastRegion.setAttribute("aria-live", "polite");
    document.body.append(toastRegion);
  }
  const iconName = tone === "error" ? "circle-alert" : tone === "info" ? "bell" : "circle-check";
  const element = document.createElement("div");
  element.className = "toast pointer-events-auto";
  element.dataset.tone = tone;
  element.innerHTML = `${icon(iconName)}<span>${escapeHtml(message)}</span>`;
  toastRegion.append(element);
  setTimeout(() => {
    element.classList.add("is-leaving");
    element.addEventListener("animationend", () => element.remove(), { once: true });
  }, tone === "error" ? 6000 : 3500);
}

// ─── Formularios ───

/** Activa el estado de carga de un botón (spinner, deshabilitado). */
export function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  if (busy) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
}

export function clearFieldErrors(form) {
  form.querySelectorAll("[data-error-for]").forEach((element) => element.remove());
  form.querySelectorAll('[aria-invalid="true"]').forEach((element) => {
    element.removeAttribute("aria-invalid");
    element.removeAttribute("aria-errormessage");
  });
  const alert = form.querySelector("[data-form-alert]");
  if (alert) alert.hidden = true;
}

/**
 * Muestra los errores devueltos por la API junto a cada campo (`fields`: nombre → mensaje).
 * Los errores sin campo se muestran en el aviso general del formulario.
 */
export function showErrors(form, error) {
  clearFieldErrors(form);
  const fields = error?.fields ?? {};
  let first = null;
  const unplaced = [];

  for (const [name, message] of Object.entries(fields)) {
    const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!input) {
      unplaced.push(message);
      continue;
    }
    const id = `${input.id || name}-error`;
    const note = document.createElement("p");
    note.className = "field-error";
    note.id = id;
    note.dataset.errorFor = name;
    note.innerHTML = `${icon("circle-alert", "mt-px h-4 w-4")}<span>${escapeHtml(message)}</span>`;
    // Grupos de opciones (radios) marcan dónde va el mensaje con data-error-anchor.
    const anchor = form.querySelector(`[data-error-anchor="${CSS.escape(name)}"]`) ?? input.closest(".input-group") ?? input;
    anchor.insertAdjacentElement("afterend", note);
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-errormessage", id);
    first ??= input;
  }

  const hasFields = Object.keys(fields).length > 0;
  const alertMessage = hasFields ? unplaced.join(" ") : error?.message;
  const alert = form.querySelector("[data-form-alert]");
  if (alert && alertMessage) {
    alert.querySelector("[data-form-alert-text]").textContent = alertMessage;
    alert.hidden = false;
  } else if (alertMessage) {
    toast(alertMessage, "error");
  }

  (first ?? alert)?.focus?.();
}

/** Bloque de error general de un formulario (inicialmente oculto). */
export function formAlert() {
  return html`<div
    data-form-alert
    hidden
    tabindex="-1"
    class="flex items-start gap-2.5 rounded-[10px] border border-tomato/25 bg-tomato-soft px-3.5 py-3 text-[0.9375rem] font-medium text-tomato"
  >
    ${icon("circle-alert", "mt-0.5")}<span data-form-alert-text></span>
  </div>`;
}

/** Lee los campos con nombre de un formulario: texto recortado, checkboxes como booleanos. */
export function readForm(form) {
  const data = {};
  for (const element of form.elements) {
    if (!element.name || element.disabled) continue;
    if (element.type === "checkbox" && element.dataset.group === undefined) data[element.name] = element.checked;
    else if (element.type === "checkbox") {
      data[element.name] ??= [];
      if (element.checked) data[element.name].push(element.value);
    } else data[element.name] = element.value.trim();
  }
  return data;
}

/** Campo de dinero en pesos con separador de miles (se lee con `parseMoney`). */
export function moneyInput(id, name, value, { disabled = false, required = false, placeholder = "" } = {}) {
  return html`<div class="input-group">
    <span class="addon">$</span>
    <input
      class="input num"
      id="${id}"
      name="${name}"
      inputmode="numeric"
      autocomplete="off"
      data-money
      value="${value === "" || value === null || value === undefined ? "" : formatThousands(value)}"
      placeholder="${placeholder}"
      ${disabled ? "disabled" : ""}
      ${required ? "required" : ""}
    />
  </div>`;
}

/** Reformatea un campo de dinero mientras se escribe, conservando la posición del cursor. */
export function formatMoneyField(input) {
  const fromEnd = input.value.length - input.selectionStart;
  const value = parseMoney(input.value);
  input.value = input.value.trim() === "" ? "" : formatThousands(String(value));
  const position = Math.max(0, input.value.length - fromEnd);
  input.setSelectionRange(position, position);
}

/** Copia texto al portapapeles; devuelve false si el navegador no lo permite. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ─── Imágenes ───

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Reduce en el navegador las fotos JPEG grandes (las del celular pesan 3–6 MB) antes de subirlas:
 * ahorra datos y tiempo. El servidor de todas formas valida y vuelve a procesar la imagen.
 * PNG y WebP se envían tal cual para no perder la transparencia de los logos.
 */
export async function shrinkPhoto(file, maxSide = 1600) {
  if (file.type !== "image/jpeg" || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/** Valida en el navegador el archivo elegido; devuelve un mensaje de error o null. */
export function checkImageFile(file) {
  if (!file) return "Selecciona una foto.";
  if (!/^image\/(jpeg|png|webp|avif|gif|heic|heif)$/.test(file.type) && file.type !== "") {
    return "Ese archivo no es una foto. Usa JPG, PNG o WebP.";
  }
  if (file.size > MAX_UPLOAD_BYTES) return "La foto pesa más de 8 MB. Elige una más liviana.";
  return null;
}

/** Iniciales para el avatar: "Ana María Pérez" → "AP". */
export function initials(name) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)[0] : "")).toUpperCase();
}
