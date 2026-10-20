// Mi tienda: logo, portada, vista previa y opciones para compartir el enlace
// (sección 6 del documento: "Mi tienda — Personalizar catálogo y compartir el enlace").
import { api, upload } from "./api.js";
import { initPanel, renderNoBusiness } from "./dashboard.js";
import { checkImageFile, copyText, html, icon, render, setBusy, shrinkPhoto, toast } from "./ui.js";

const state = { business: null, isOwner: false };
let main;

const IMAGES = {
  banner: {
    field: "bannerUrl",
    title: "Portada",
    hint: "Una foto horizontal de tu local o de tu plato estrella. Se ve mejor de al menos 1200 px de ancho.",
    empty: "Agregar portada",
    saved: "Portada actualizada.",
    removed: "Quitaste la portada.",
  },
  logo: {
    field: "logoUrl",
    title: "Logo",
    hint: "Cuadrado, de al menos 400 × 400 px. Se muestra en un círculo.",
    empty: "Agregar logo",
    saved: "Logo actualizado.",
    removed: "Quitaste el logo.",
  },
};

// ───────────────────────────── Plantillas ─────────────────────────────

function imageControls(kind) {
  const config = IMAGES[kind];
  const url = state.business[config.field];
  if (!state.isOwner) return "";
  return html`<div class="flex flex-wrap gap-2">
    <button type="button" class="btn btn-ghost btn-sm" data-pick="${kind}">${icon("upload")} ${url ? "Cambiar" : "Subir"} ${config.title.toLowerCase()}</button>
    ${url ? html`<button type="button" class="btn btn-quiet btn-sm text-tomato" data-remove="${kind}">Quitar</button>` : ""}
  </div>`;
}

function dropzone(kind, shape) {
  const config = IMAGES[kind];
  const url = state.business[config.field];
  const Tag = state.isOwner ? "label" : "div";
  return html`<${Tag} class="dropzone ${shape} ${state.isOwner ? "" : "cursor-default"}" data-dropzone="${kind}">
    ${state.isOwner ? html`<input type="file" accept="image/*" class="sr-only" data-file="${kind}" aria-label="${config.title} de la tienda" />` : ""}
    ${url
      ? html`<img src="${url}" alt="${config.title} actual" />`
      : html`<span class="grid justify-items-center gap-1 px-2 text-center text-xs font-[620]">${icon("image-plus", "h-6 w-6")} ${config.empty}</span>`}
    <span class="absolute inset-0 hidden place-items-center bg-paper/70" data-busy-overlay>
      <span class="h-6 w-6 animate-spin rounded-full border-2 border-ink border-r-transparent"></span>
    </span>
  </${Tag}>`;
}

function appearance() {
  return html`<section class="panel" aria-labelledby="appearance-title">
    <header class="border-b border-line px-4 py-4 sm:px-6">
      <h2 id="appearance-title" class="text-lg font-[740]">Portada y logo</h2>
      <p class="mt-0.5 text-sm text-muted">Es lo primero que ven tus clientes al abrir el enlace.</p>
    </header>
    <div class="grid gap-6 p-4 sm:p-6" data-appearance>
      <div class="grid gap-3">
        <p class="font-[650]">${IMAGES.banner.title}</p>
        ${dropzone("banner", "aspect-[16/7] w-full")}
        <p class="hint">${IMAGES.banner.hint}</p>
        ${imageControls("banner")}
      </div>
      <div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 border-t border-line pt-6">
        ${dropzone("logo", "h-24 w-24 rounded-full")}
        <div class="grid gap-2">
          <p class="font-[650]">${IMAGES.logo.title}</p>
          <p class="hint">${IMAGES.logo.hint}</p>
          ${imageControls("logo")}
        </div>
      </div>
      ${state.isOwner
        ? html`<p class="rounded-[10px] bg-ground px-3.5 py-3 text-sm text-muted">
            El nombre, la descripción y el enlace de tu tienda se cambian en
            <a class="font-[650] text-ink" href="/panel/configuracion#negocio">Configuración</a>.
          </p>`
        : html`<p class="flex items-start gap-2.5 rounded-[10px] bg-sky-soft px-3.5 py-3 text-sm font-medium text-sky">
            ${icon("info", "mt-0.5")} Solo el propietario puede cambiar el logo y la portada.
          </p>`}
    </div>
  </section>`;
}

function share() {
  const { business } = state;
  const url = new URL(business.storeUrl);
  const message = `¡Hola! Mira el menú de ${business.name} y haz tu pedido aquí: ${business.storeUrl}`;
  return html`<section class="panel overflow-hidden" aria-labelledby="share-title">
    <header class="border-b border-line px-4 py-4 sm:px-6">
      <h2 id="share-title" class="text-lg font-[740]">Comparte tu tienda</h2>
      <p class="mt-0.5 text-sm text-muted">Ponla en tu estado de WhatsApp, en Instagram o en la puerta de tu local.</p>
    </header>
    <div class="grid gap-6 p-4 sm:p-6">
      <div class="grid gap-3">
        <p class="rounded-[12px] bg-ink px-4 py-3.5 text-[1.0625rem] leading-snug text-paper [overflow-wrap:anywhere]">
          <span class="text-ink-soft">${url.host}/tienda/</span><span class="font-[750] text-mustard">${business.slug}</span>
        </p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn btn-primary" data-copy>${icon("copy")} Copiar enlace</button>
          <a class="btn btn-ghost" href="https://wa.me/?text=${encodeURIComponent(message)}" target="_blank" rel="noopener">
            ${icon("message-circle", "text-[#128c4b]")} Enviar por WhatsApp
          </a>
          ${"share" in navigator ? html`<button type="button" class="btn btn-ghost" data-native-share>${icon("share-2")} Compartir</button>` : ""}
        </div>
      </div>

      <div class="grid items-center gap-5 border-t border-line pt-6 sm:grid-cols-[auto_minmax(0,1fr)]">
        <img
          src="/api/v1/businesses/current/qr?format=svg"
          alt="Código QR que abre ${business.storeUrl}"
          class="h-40 w-40 rounded-[12px] border border-line bg-paper p-2"
          width="160"
          height="160"
        />
        <div class="grid gap-2">
          <p class="font-[650]">Código QR</p>
          <p class="text-sm text-muted">
            Imprímelo y ponlo en el mostrador, en las mesas o en tus volantes. Al escanearlo con la cámara del celular se abre tu tienda.
          </p>
          <div>
            <a class="btn btn-ghost btn-sm" href="/api/v1/businesses/current/qr?format=png&download=1" download>${icon("download")} Descargar QR (PNG)</a>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

// La tienda a 390 px de ancho, reducida para caber justo en el marco del celular (278 × 619 px por dentro).
// El marco usa overflow-clip y no overflow-hidden: este último se puede desplazar por código, y al abrir el
// carrito o el seguimiento dentro de la vista previa el navegador lo corría y la hoja quedaba cortada.
function preview() {
  return html`<aside class="hidden lg:block" aria-labelledby="preview-title">
    <div class="sticky top-10 grid justify-items-center gap-3">
      <div class="flex w-[292px] items-center justify-between">
        <h2 id="preview-title" class="text-sm font-[700]">Vista previa</h2>
        <a class="text-sm font-[620] text-muted hover:text-ink" href="${state.business.storeUrl}" target="_blank" rel="noopener">Abrir ${icon("external-link", "inline h-4 w-4 align-[-3px]")}</a>
      </div>
      <div class="h-[633px] w-[292px] overflow-clip rounded-[2rem] border-[7px] border-ink bg-paper shadow-[var(--shadow-pop)]">
        <iframe
          src="/tienda/${state.business.slug}"
          title="Vista previa de tu tienda"
          class="h-[868px] w-[390px] origin-top-left scale-[0.71282]"
          loading="lazy"
          data-preview
        ></iframe>
      </div>
      <p class="max-w-[292px] text-center text-xs text-muted">Así se ve tu tienda en un celular.</p>
    </div>
  </aside>`;
}

function page() {
  return html`<div class="grid grid-cols-[minmax(0,1fr)] gap-6 lg:gap-8">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div class="min-w-0">
        <h1 class="text-[1.875rem] leading-tight font-[780] sm:text-[2.375rem]">Mi tienda</h1>
        <p class="mt-1 text-[0.9375rem] text-muted">Personaliza tu tienda y comparte el enlace con tus clientes.</p>
      </div>
      <a class="btn btn-ghost" href="${state.business.storeUrl}" target="_blank" rel="noopener">${icon("external-link")} Abrir mi tienda</a>
    </header>
    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_292px] lg:gap-10">
      <div class="grid min-w-0 gap-6"><div data-appearance-slot>${appearance()}</div> ${share()}</div>
      ${preview()}
    </div>
  </div>`;
}

// ───────────────────────────── Acciones ─────────────────────────────

function redrawAppearance() {
  render(main.querySelector("[data-appearance-slot]"), appearance());
}

function reloadPreview() {
  const frame = main.querySelector("[data-preview]");
  try {
    frame?.contentWindow?.location.reload();
  } catch {
    if (frame) frame.src = frame.src;
  }
}

function setZoneBusy(kind, busy) {
  const overlay = main.querySelector(`[data-dropzone="${kind}"] [data-busy-overlay]`);
  overlay?.classList.toggle("hidden", !busy);
  overlay?.classList.toggle("grid", busy);
}

/** Refleja el logo nuevo en el selector de negocio de la barra lateral. */
function updateShellLogo() {
  document.querySelectorAll("[data-business-logo]").forEach((image) => {
    if (state.business.logoUrl) image.src = state.business.logoUrl;
  });
}

async function uploadImage(kind, file) {
  const problem = checkImageFile(file);
  if (problem) {
    toast(problem, "error");
    return;
  }
  setZoneBusy(kind, true);
  try {
    state.business = await upload(`/businesses/current/${kind}`, await shrinkPhoto(file, kind === "banner" ? 2000 : 1200));
    redrawAppearance();
    reloadPreview();
    updateShellLogo();
    toast(IMAGES[kind].saved);
  } catch (error) {
    setZoneBusy(kind, false);
    toast(error.message, "error");
  }
}

async function removeImage(kind, button) {
  setBusy(button, true);
  try {
    state.business = await api(`/businesses/current/${kind}`, { method: "DELETE" });
    redrawAppearance();
    reloadPreview();
    toast(IMAGES[kind].removed);
  } catch (error) {
    setBusy(button, false);
    toast(error.message, "error");
  }
}

function bindPage() {
  main.addEventListener("change", (event) => {
    const input = event.target.closest("[data-file]");
    if (!input?.files?.[0]) return;
    uploadImage(input.dataset.file, input.files[0]);
    input.value = "";
  });

  main.addEventListener("click", async (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.matches("[data-pick]")) main.querySelector(`[data-file="${target.dataset.pick}"]`)?.click();
    if (target.matches("[data-remove]")) removeImage(target.dataset.remove, target);
    if (target.matches("[data-copy]")) {
      if (await copyText(state.business.storeUrl)) toast("Enlace copiado. Pégalo donde quieras compartirlo.");
      else toast(`Copia este enlace: ${state.business.storeUrl}`, "info");
    }
    if (target.matches("[data-native-share]")) {
      try {
        await navigator.share({ title: state.business.name, text: `Mira el menú de ${state.business.name}`, url: state.business.storeUrl });
      } catch {
        // El usuario canceló el diálogo de compartir.
      }
    }
  });

  // Arrastrar y soltar una imagen sobre la zona.
  main.addEventListener("dragover", (event) => {
    const zone = event.target.closest("label[data-dropzone]");
    if (!zone) return;
    event.preventDefault();
    zone.classList.add("is-over");
  });
  main.addEventListener("dragleave", (event) => event.target.closest("[data-dropzone]")?.classList.remove("is-over"));
  main.addEventListener("drop", (event) => {
    const zone = event.target.closest("label[data-dropzone]");
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove("is-over");
    const file = event.dataTransfer?.files?.[0];
    if (file) uploadImage(zone.dataset.dropzone, file);
  });
}

// ───────────────────────────── Arranque ─────────────────────────────

const context = await initPanel("tienda");
if (context) {
  main = context.main;
  if (!context.business) {
    renderNoBusiness(main);
  } else {
    state.business = context.business;
    state.isOwner = context.business.role === "OWNER";
    render(main, page());
    bindPage();
  }
}
