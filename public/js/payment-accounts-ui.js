// Configuración → Pagos: QR y llaves para cobrar por transferencia (Nequi, Bre-B, Daviplata).
// El propietario sube el QR que le da su app (un pantallazo sirve); el servidor lee el código y lo
// devuelve dibujado de nuevo. El domiciliario lo muestra al entregar para que el cliente lo escanee.
import { api, upload } from "./api.js";
import { checkImageFile, clearFieldErrors, formAlert, html, icon, raw, readForm, render, setBusy, showErrors, toast } from "./ui.js";

const KINDS = [
  {
    kind: "NEQUI",
    title: "Nequi",
    keyLabel: "Número de Nequi",
    keyPlaceholder: "300 123 4567",
    help: "En la app de Nequi busca tu código QR para recibir plata y guarda la imagen o toma un pantallazo.",
  },
  {
    kind: "BRE_B",
    title: "Bre-B",
    subtitle: "de cualquier banco",
    keyLabel: "Llave Bre-B",
    keyPlaceholder: "@minegocio, celular, correo o cédula",
    help: "En la app de tu banco entra a tus llaves Bre-B y descarga el QR de la llave (o toma un pantallazo). Se paga desde cualquier banco o billetera.",
  },
  {
    kind: "DAVIPLATA",
    title: "Daviplata",
    keyLabel: "Número de Daviplata",
    keyPlaceholder: "300 123 4567",
    help: "En la app de Daviplata busca la opción para recibir con código QR y guarda la imagen o toma un pantallazo.",
  },
];

let container = null;
let accounts = new Map();

function statusBadge(account) {
  if (account?.qrSvg) return html`<span class="badge badge-dot bg-leaf-soft text-leaf">QR listo</span>`;
  if (account?.accountKey) return html`<span class="badge badge-dot bg-mustard-soft text-mustard-deep">Solo llave</span>`;
  return html`<span class="badge bg-ground text-muted">Sin configurar</span>`;
}

function card(config) {
  const account = accounts.get(config.kind);
  const id = config.kind.toLowerCase();
  return html`<article class="rounded-[14px] border border-line p-4 sm:p-5" data-account="${config.kind}">
    <div class="grid gap-4 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-5">
      <label
        class="dropzone aspect-square w-36 justify-self-center sm:w-full ${account?.qrSvg ? "border-solid border-line bg-paper" : ""}"
        data-qr-zone="${config.kind}"
        title="${account?.qrSvg ? "Cambiar el QR" : "Subir el QR"}"
      >
        <input type="file" accept="image/*" class="sr-only" data-qr-file="${config.kind}" aria-label="Imagen del QR de ${config.title}" />
        ${account?.qrSvg
          ? html`<span class="absolute inset-1.5 [&_svg]:h-full [&_svg]:w-full" role="img" aria-label="QR de ${config.title}">${raw(account.qrSvg)}</span>`
          : html`<span class="grid justify-items-center gap-1.5 px-3 text-center text-xs font-[620]">
              ${icon("qr-code", "h-7 w-7")} Subir QR
              <span class="font-normal">Pantallazo o imagen</span>
            </span>`}
        <span class="absolute inset-0 hidden place-items-center bg-paper/75" data-busy-overlay>
          <span class="h-6 w-6 animate-spin rounded-full border-2 border-ink border-r-transparent"></span>
        </span>
      </label>

      <form class="grid content-start gap-3" data-account-form="${config.kind}" novalidate>
        <header class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 class="text-[1.0625rem] font-[740]">${config.title}</h3>
          ${config.subtitle ? html`<span class="text-sm text-muted">${config.subtitle}</span>` : ""}
          <span class="ml-auto">${statusBadge(account)}</span>
        </header>
        <p class="text-sm text-muted">${config.help}</p>
        ${formAlert()}
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="field">
            <label class="label" for="pa-${id}-key">${config.keyLabel}</label>
            <input class="input" id="pa-${id}-key" name="accountKey" value="${account?.accountKey ?? ""}" placeholder="${config.keyPlaceholder}" maxlength="80" autocomplete="off" />
          </div>
          <div class="field">
            <label class="label" for="pa-${id}-holder">A nombre de</label>
            <input class="input" id="pa-${id}-holder" name="holderName" value="${account?.holderName ?? ""}" placeholder="Titular de la cuenta" maxlength="80" autocomplete="off" />
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button type="submit" class="btn btn-ink btn-sm" data-account-save disabled>Guardar</button>
          <button type="button" class="btn btn-ghost btn-sm" data-qr-pick="${config.kind}">${icon("upload")} ${account?.qrSvg ? "Cambiar QR" : "Subir QR"}</button>
          ${account
            ? html`<button type="button" class="btn btn-quiet btn-sm ml-auto text-tomato" data-account-remove="${config.kind}">${icon("trash-2")} Quitar</button>`
            : ""}
        </div>
      </form>
    </div>
  </article>`;
}

function view() {
  return html`<div class="grid gap-4">
    <div class="grid gap-1">
      <h3 class="flex items-center gap-2 text-[1.0625rem] font-[740]">${icon("qr-code")} Cobrar con QR al entregar</h3>
      <p class="text-sm text-muted">
        Cuando el cliente paga por transferencia, el domiciliario le muestra tu QR en su celular y el cliente lo escanea con Nequi, Daviplata o la
        app de su banco. Sube el QR para recibir pagos que te da tu app: Pedify lo lee y lo muestra nítido. Ese QR no trae el valor, así que el
        cliente escribe el total que le aparece al domiciliario.
      </p>
    </div>
    ${KINDS.map(card)}
  </div>`;
}

function redraw() {
  render(container, view());
}

function setZoneBusy(kind, busy) {
  const overlay = container.querySelector(`[data-qr-zone="${kind}"] [data-busy-overlay]`);
  overlay?.classList.toggle("hidden", !busy);
  overlay?.classList.toggle("grid", busy);
}

async function uploadQr(kind, file) {
  const problem = checkImageFile(file);
  if (problem) {
    toast(problem, "error");
    return;
  }
  setZoneBusy(kind, true);
  try {
    // Sin reducir en el navegador: el código se lee mejor de la imagen original.
    accounts.set(kind, await upload(`/businesses/current/payment-accounts/${kind}/qr`, file));
    redraw();
    toast("Listo: leímos tu QR. El domiciliario lo verá al entregar.");
  } catch (error) {
    setZoneBusy(kind, false);
    toast(error.message, "error");
  }
}

async function save(form) {
  const kind = form.dataset.accountForm;
  const button = form.querySelector("[data-account-save]");
  clearFieldErrors(form);
  setBusy(button, true);
  try {
    const { accountKey, holderName } = readForm(form);
    accounts.set(kind, await api(`/businesses/current/payment-accounts/${kind}`, { method: "PUT", body: { accountKey, holderName } }));
    redraw();
    toast("Datos de cobro guardados.");
  } catch (error) {
    setBusy(button, false);
    showErrors(form, error);
  }
}

async function remove(button) {
  const kind = button.dataset.accountRemove;
  if (button.dataset.armed !== "true") {
    button.dataset.armed = "true";
    button.lastChild.textContent = " ¿Quitar QR y llave?";
    return;
  }
  setBusy(button, true);
  try {
    await api(`/businesses/current/payment-accounts/${kind}`, { method: "DELETE" });
    accounts.delete(kind);
    redraw();
    toast("Quitaste esa cuenta de cobro.");
  } catch (error) {
    setBusy(button, false);
    toast(error.message, "error");
  }
}

function bind() {
  container.addEventListener("change", (event) => {
    const input = event.target.closest("[data-qr-file]");
    if (!input?.files?.[0]) return;
    uploadQr(input.dataset.qrFile, input.files[0]);
    input.value = "";
  });
  container.addEventListener("input", (event) => {
    const form = event.target.closest("[data-account-form]");
    if (form) form.querySelector("[data-account-save]").disabled = false;
  });
  container.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-account-form]");
    if (!form) return;
    event.preventDefault();
    save(form);
  });
  container.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.matches("[data-qr-pick]")) container.querySelector(`[data-qr-file="${button.dataset.qrPick}"]`)?.click();
    if (button.matches("[data-account-remove]")) remove(button);
  });

  // Arrastrar y soltar la imagen sobre el recuadro del QR.
  container.addEventListener("dragover", (event) => {
    const zone = event.target.closest("[data-qr-zone]");
    if (!zone) return;
    event.preventDefault();
    zone.classList.add("is-over");
  });
  container.addEventListener("dragleave", (event) => event.target.closest("[data-qr-zone]")?.classList.remove("is-over"));
  container.addEventListener("drop", (event) => {
    const zone = event.target.closest("[data-qr-zone]");
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove("is-over");
    const file = event.dataTransfer?.files?.[0];
    if (file) uploadQr(zone.dataset.qrZone, file);
  });
}

/** Monta la sección (solo el propietario). */
export async function mountPaymentAccounts(element) {
  if (!element) return;
  container = element;
  try {
    accounts = new Map((await api("/businesses/current/payment-accounts")).map((account) => [account.kind, account]));
    redraw();
    bind();
  } catch (error) {
    render(container, html`<p class="text-sm text-tomato">${error.message}</p>`);
  }
}
