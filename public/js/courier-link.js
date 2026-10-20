// Panel: enlace para que el domiciliario comparta su ubicación (código QR, WhatsApp o copiar).
// Cada vez que se genera, el enlace anterior de ese pedido deja de funcionar.
import { api } from "./api.js";
import { copyText, html, icon, raw, render, toast } from "./ui.js";

let dialog = null;

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "sheet";
  dialog.setAttribute("aria-labelledby", "courier-link-title");
  document.body.append(dialog);
  dialog.addEventListener("click", async (event) => {
    if (event.target === dialog || event.target.closest("[data-close-courier]")) return dialog.close();
    const copy = event.target.closest("[data-copy-courier]");
    if (copy) {
      const ok = await copyText(copy.dataset.copyCourier);
      toast(ok ? "Enlace copiado. Envíaselo al domiciliario." : "No pudimos copiar el enlace.", ok ? "success" : "error");
    }
  });
  return dialog;
}

function view(order, link) {
  const message = `Hola. Te comparto la entrega del pedido #${order.number}. Abre este enlace en tu celular, toca «Empezar entrega» y déjalo abierto mientras vas: ${link.url}`;
  return html`<div class="flex min-h-0 flex-1 flex-col">
    <header class="flex items-center gap-3 border-b border-line py-3 pr-3 pl-5">
      <h2 id="courier-link-title" class="text-lg font-[780] outline-none" tabindex="-1">Domiciliario del pedido #${order.number}</h2>
      <button type="button" class="btn btn-quiet btn-icon ml-auto" data-close-courier aria-label="Cerrar">${icon("x")}</button>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5">
      <div class="grid gap-5">
        <p class="text-[0.9375rem] text-muted">
          Con este enlace el domiciliario ve la dirección y lo que debe cobrar, y comparte su ubicación: el cliente lo ve acercarse en un
          mapa. No necesita cuenta en Pedify.
        </p>
        <div class="grid justify-items-center gap-2 rounded-[16px] bg-ground p-5">
          <div class="h-48 w-48 rounded-[12px] bg-paper p-2 [&_svg]:h-full [&_svg]:w-full" aria-label="Código QR del enlace del domiciliario" role="img">
            ${raw(link.qrSvg)}
          </div>
          <p class="text-sm text-muted">El domiciliario lo escanea con la cámara de su celular.</p>
        </div>
        <div class="grid gap-2">
          <a class="btn btn-whatsapp w-full" href="https://wa.me/?text=${encodeURIComponent(message)}" target="_blank" rel="noopener">
            ${icon("message-circle")} Enviar por WhatsApp
          </a>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" class="btn btn-ghost" data-copy-courier="${link.url}">${icon("copy")} Copiar enlace</button>
            <a class="btn btn-ghost" href="${link.url}" target="_blank" rel="noopener">${icon("external-link")} Abrir aquí</a>
          </div>
        </div>
        <p class="text-xs text-muted">
          El enlace sirve para este pedido hasta que se entregue o se cancele (máximo 12 horas). Si generas otro, este deja de funcionar.
        </p>
      </div>
    </div>
  </div>`;
}

/** Genera el enlace y lo muestra. `order`: { id, number }. */
export async function openCourierLink(order) {
  try {
    const link = await api(`/orders/${order.id}/courier-link`, { method: "POST" });
    const sheet = ensureDialog();
    render(sheet, view(order, link));
    if (!sheet.open) sheet.showModal();
    sheet.querySelector("#courier-link-title")?.focus();
  } catch (error) {
    toast(error.message, "error");
  }
}
