// Página /app: instalar Pedify como app en el celular o el computador. Muestra el botón según el
// equipo (o los pasos para hacerlo a mano), resalta «Tu equipo» y, en el computador, el código QR
// para instalarla también en el celular.
import { installApp, installLabel, installState, installSteps, isIOS, isPhone } from "./install.js";
import { html, icon, render } from "./ui.js";

/** Tarjeta de pasos que corresponde a este equipo (Android, iPhone o computador). */
function platformOf() {
  if (isIOS()) return "ios";
  return isPhone() ? "android-menu" : "desktop-menu";
}

function installBox(state) {
  if (state === "installed") {
    return html`<div class="flex flex-wrap items-center gap-3">
      <a href="/panel/pedidos" class="btn btn-primary">${icon("receipt")} Abrir mis pedidos</a>
      <p class="flex items-center gap-2 text-[0.9375rem] text-paper/75">${icon("circle-check", "text-leaf")} Ya estás usando la app en este equipo.</p>
    </div>`;
  }
  const qr = isPhone()
    ? ""
    : html`<div class="flex w-fit items-center gap-4 rounded-[16px] bg-ink-2 p-3 pr-5 ring-1 ring-paper/10">
        <img src="/app/qr.svg" alt="Código QR para abrir esta página en el celular" class="h-24 w-24 rounded-[10px] bg-paper p-1" width="96" height="96" />
        <span class="grid max-w-[14rem] gap-1 text-[0.9375rem]">
          <span class="font-[720] text-paper">¿Y en tu celular?</span>
          <span class="text-paper/70">Escanea este código con la cámara y sigue los pasos.</span>
        </span>
      </div>`;
  return html`<div class="flex flex-wrap gap-3">
      <button type="button" class="btn btn-primary" data-install>${icon("download")} ${state === "ready" ? installLabel() : "Cómo instalarla aquí"}</button>
      <a href="/panel" class="btn btn-quiet text-paper hover:bg-ink-3">Entrar a mi panel</a>
    </div>
    ${qr}`;
}

function draw() {
  const state = installState();
  render(document.querySelector("[data-install-box]"), installBox(state));
  const mine = platformOf();
  document.querySelectorAll("[data-platform]").forEach((card) => {
    const yours = card.dataset.platform === mine;
    card.classList.toggle("ring-2", yours);
    card.classList.toggle("ring-mustard", yours);
    card.querySelector("[data-yours]").classList.toggle("hidden", !yours);
  });
}

document.querySelectorAll("[data-steps]").forEach((slot) => render(slot, installSteps(slot.dataset.steps)));
draw();
window.addEventListener("pedify:install", draw);
document.querySelector("[data-install-box]").addEventListener("click", (event) => {
  if (event.target.closest("[data-install]")) void installApp();
});
