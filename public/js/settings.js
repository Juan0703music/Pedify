// Página de Configuración: datos del negocio, WhatsApp, horario, entrega, pagos, equipo y cuenta.
import { api, formatPhone, parseMoney } from "./api.js";
import { initPanel, renderNoBusiness, ROLE_LABEL, showChangedElsewhere } from "./dashboard.js";
import { onLive } from "./notifications.js";
import { distanceFields, mountDistancePricing, pricingChoice } from "./delivery-pricing-ui.js";
import { mountPaymentAccounts } from "./payment-accounts-ui.js";
import { mountPush } from "./push-ui.js";
import {
  clearFieldErrors,
  formAlert,
  formatMoneyField,
  html,
  icon,
  initials,
  moneyInput,
  raw,
  readForm,
  render,
  setBusy,
  showErrors,
  time12,
  toast,
} from "./ui.js";

/** Semana colombiana: de lunes a domingo (day: 0 = domingo). */
const DAYS = [
  { day: 1, label: "Lunes" },
  { day: 2, label: "Martes" },
  { day: 3, label: "Miércoles" },
  { day: 4, label: "Jueves" },
  { day: 5, label: "Viernes" },
  { day: 6, label: "Sábado" },
  { day: 0, label: "Domingo" },
];

const PAYMENT_METHODS = [
  { value: "CASH", label: "Efectivo", icon: "banknote" },
  { value: "NEQUI", label: "Nequi", icon: "smartphone" },
  { value: "DAVIPLATA", label: "Daviplata", icon: "smartphone" },
  { value: "BANK_TRANSFER", label: "Transferencia bancaria", icon: "wallet" },
  { value: "BRE_B", label: "Llave Bre-B", icon: "key-round" },
  { value: "CARD", label: "Datáfono (tarjeta)", icon: "wallet" },
];

// La configuración del negocio es del propietario; un empleado ve sus avisos y su cuenta.
const SECTIONS = [
  { id: "negocio", label: "Negocio", ownerOnly: true },
  { id: "whatsapp", label: "Pedidos", employeeLabel: "Avisos" },
  { id: "horario", label: "Horario", ownerOnly: true },
  { id: "entrega", label: "Entrega", ownerOnly: true },
  { id: "pagos", label: "Pagos", ownerOnly: true },
  { id: "ventas", label: "Ventas", ownerOnly: true },
  { id: "equipo", label: "Equipo", ownerOnly: true },
  { id: "plan", label: "Mi plan", ownerOnly: true },
  { id: "cuenta", label: "Mi cuenta" },
];

const state = { me: null, business: null, settings: null, members: [], isOwner: false };
/** Editor del domicilio según la distancia (sección Entrega, solo el propietario). */
let distancePricing = { read: () => ({}) };

/** Permisos que el propietario elige para cada empleado (el servidor los verifica en cada petición). */
const PERMISSION_OPTIONS = [
  { id: "markSoldOut", label: "Marcar agotados", hint: "Activar o desactivar productos agotados en Mi menú." },
  { id: "viewSales", label: "Ver ventas del día", hint: "Ventas, pedidos y ticket promedio en Inicio." },
  { id: "viewCustomers", label: "Ver clientes", hint: "Lista de clientes con celular, direcciones e historial." },
  { id: "viewAnalytics", label: "Ver analíticas", hint: "Ventas por día, horas pico y productos más vendidos." },
];
const DEFAULT_PERMISSIONS = { markSoldOut: true, viewSales: true, viewCustomers: true, viewAnalytics: false };

/** Casilla de un permiso (en la lista del equipo o al agregar a alguien). */
function permissionChoice(name, option, checked, attributes = "") {
  return html`<label class="choice min-h-10 text-sm" title="${option.hint}">
    <input type="checkbox" name="${name}" ${checked ? "checked" : ""} ${raw(attributes)} />
    <span class="choice-check" aria-hidden="true">${icon("check", "h-3 w-3")}</span>
    ${option.label}
  </label>`;
}

// ───────────────────────────── Utilidades ─────────────────────────────

function saveBar(label = "Guardar cambios") {
  return html`<div class="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
    <span class="mr-auto hidden text-sm font-medium text-mustard-deep" data-dirty-note>Tienes cambios sin guardar</span>
    <button class="btn btn-ink" type="submit" disabled data-save>${label}</button>
  </div>`;
}

function section(id, title, description, body) {
  return html`<section id="${id}" aria-labelledby="${id}-title" class="panel scroll-mt-32 lg:scroll-mt-8">
    <header class="border-b border-line px-4 py-4 sm:px-6">
      <h2 id="${id}-title" class="text-lg font-[740]">${title}</h2>
      <p class="mt-0.5 text-sm text-muted">${description}</p>
    </header>
    <div class="p-4 sm:p-6">${body}</div>
  </section>`;
}

function switchRow(id, name, checked, title, text, { disabled = false } = {}) {
  return html`<label for="${id}" class="flex cursor-pointer items-start justify-between gap-4 ${disabled ? "cursor-not-allowed" : ""}">
    <span class="grid gap-0.5">
      <span class="font-[650]">${title}</span>
      ${text ? html`<span class="text-sm text-muted">${text}</span>` : ""}
    </span>
    <input type="checkbox" role="switch" class="switch mt-0.5" id="${id}" name="${name}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
  </label>`;
}

/** Documentos de quien vende (como en el registro). */
const ID_TYPES = [
  ["CC", "Cédula (C.C.)"],
  ["NIT", "NIT"],
  ["CE", "Cédula de extranjería"],
  ["PPT", "PPT"],
  ["PA", "Pasaporte"],
];

// ───────────────────────────── Secciones ─────────────────────────────

function businessSection() {
  const { business, isOwner } = state;
  const host = new URL(business.storeUrl).host;
  return section(
    "negocio",
    "Datos del negocio",
    "Así te verán tus clientes en tu tienda.",
    html`<form data-form="negocio" novalidate>
      <fieldset class="grid gap-5 sm:grid-cols-2" ${isOwner ? "" : "disabled"}>
        <div class="sm:col-span-2">${formAlert()}</div>
        <div class="field">
          <label class="label" for="b-name">Nombre del negocio</label>
          <input class="input" id="b-name" name="name" value="${business.name}" maxlength="80" required />
        </div>
        <div class="field">
          <label class="label" for="b-phone">Teléfono de contacto</label>
          <input class="input" id="b-phone" name="phone" type="tel" inputmode="tel" value="${formatPhone(business.phone)}" required />
        </div>
        <div class="field">
          <label class="label" for="b-city">Ciudad</label>
          <input class="input" id="b-city" name="city" value="${business.city ?? ""}" placeholder="Sincelejo" maxlength="80" />
        </div>
        <div class="field">
          <label class="label" for="b-address">Dirección</label>
          <input class="input" id="b-address" name="address" value="${business.address ?? ""}" placeholder="Calle 20 #15-30" maxlength="160" />
        </div>
        <div class="field sm:col-span-2">
          <div class="flex items-baseline justify-between gap-3">
            <label class="label" for="b-description">Descripción</label>
            <span class="num text-xs text-muted" data-counter-for="b-description"></span>
          </div>
          <textarea class="input" id="b-description" name="description" maxlength="300" rows="3" placeholder="Hamburguesas, salchipapas y bebidas con el sabor de la costa.">${business.description ?? ""}</textarea>
        </div>
        <div class="field sm:col-span-2">
          <label class="label" for="b-slug">Enlace de tu tienda</label>
          <div class="input-group">
            <span class="addon max-w-[55%] min-w-0"><span class="truncate">${host}/tienda/</span></span>
            <input class="input" id="b-slug" name="slug" value="${business.slug}" autocapitalize="none" autocomplete="off" spellcheck="false" maxlength="50" />
          </div>
          <p class="hint">Solo letras minúsculas sin tildes, números y guiones. Si lo cambias, el enlace anterior dejará de funcionar.</p>
        </div>
        <div class="grid scroll-mt-40 gap-1 border-t border-line pt-5 sm:col-span-2 lg:scroll-mt-8" id="quien-vende">
          <h3 class="font-[720]">Quién vende</h3>
          <p class="text-sm text-muted">
            La ley (Estatuto del Consumidor) exige que tu tienda muestre estos datos para que tus clientes sepan a quién le compran. Si tienes
            empresa, usa su razón social y su NIT.
          </p>
        </div>
        <div class="field sm:col-span-2">
          <label class="label" for="b-legal-name">Nombre o razón social</label>
          <input class="input" id="b-legal-name" name="legalName" value="${business.legalName ?? ""}" maxlength="120" placeholder="Ana Pérez o Sabores del Caribe S.A.S." />
        </div>
        <div class="field">
          <label class="label" for="b-id-type">Documento</label>
          <select class="input" id="b-id-type" name="idType">
            <option value="" ${business.idType ? "" : "selected"}>Elige</option>
            ${ID_TYPES.map(([value, label]) => html`<option value="${value}" ${business.idType === value ? "selected" : ""}>${label}</option>`)}
          </select>
        </div>
        <div class="field">
          <label class="label" for="b-id-number">Número de documento</label>
          <input class="input" id="b-id-number" name="idNumber" value="${business.idNumber ?? ""}" maxlength="20" autocomplete="off" placeholder="1102345678 o 900123456-7" />
        </div>
        <div class="field sm:col-span-2">
          <label class="label" for="b-contact-email">Correo para tus clientes</label>
          <input class="input" id="b-contact-email" name="contactEmail" type="email" inputmode="email" value="${business.contactEmail ?? ""}" placeholder="contacto@tunegocio.com" maxlength="254" />
          <p class="hint">Aparece en tu tienda para que tus clientes te escriban sus peticiones, quejas o reclamos.</p>
        </div>
      </fieldset>
      ${isOwner ? saveBar() : ""}
    </form>`,
  );
}

function whatsappSection() {
  const { settings, isOwner } = state;
  return section(
    "whatsapp",
    "Pedidos y WhatsApp",
    "Los pedidos llegan directo a tu panel. El WhatsApp es para que tus clientes te escriban.",
    html`<form data-form="whatsapp" novalidate>
      <fieldset class="grid gap-6" ${isOwner ? "" : "disabled"}>
        ${formAlert()}
        <div class="field max-w-sm">
          <label class="label" for="s-whatsapp">Celular con WhatsApp</label>
          <div class="input-group">
            <span class="addon">${icon("message-circle")}</span>
            <input class="input" id="s-whatsapp" name="whatsappPhone" type="tel" inputmode="tel" value="${formatPhone(settings.whatsappPhone)}" placeholder="300 123 4567" />
          </div>
          <p class="hint">Opcional. Aparece en tu tienda como «Escribir por WhatsApp» y en el seguimiento del pedido.</p>
        </div>
        ${switchRow(
          "s-accepting",
          "acceptingOrders",
          settings.acceptingOrders,
          "Recibir pedidos ahora",
          "Apágalo si se te acabó la masa o cerraste temprano. Tu tienda mostrará que no estás recibiendo pedidos.",
        )}
      </fieldset>
      ${isOwner ? saveBar() : ""}
    </form>
    <div class="mt-8 grid gap-3">
      <h3 class="font-[740]">Avisos de pedidos nuevos</h3>
      <div data-push-section></div>
    </div>`,
  );
}

/** Empleados: solo los avisos de pedidos de su dispositivo. */
function employeeAlertsSection() {
  return section(
    "whatsapp",
    "Avisos de pedidos nuevos",
    "Recibe cada pedido en tu celular o computador, aunque cierres el panel.",
    html`<div data-push-section></div>`,
  );
}

/** Horas para abrir y cerrar cada media hora, en hora normal (6:00 a. m., 6:30 a. m.…). */
const HALF_HOURS = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`);

/** Lista de horas; si el horario guardado no cae en media hora exacta (p. ej. 11:15), también aparece. */
function hourSelect(id, name, value, disabled) {
  const hours = HALF_HOURS.includes(value) ? HALF_HOURS : [...HALF_HOURS, value].sort();
  return html`<select class="input num w-full min-w-0 px-2.5" id="${id}" name="${name}" ${disabled ? "disabled" : ""}>
    ${hours.map((hour) => html`<option value="${hour}" ${hour === value ? "selected" : ""}>${time12(hour)}</option>`)}
  </select>`;
}

/** Elige una hora en la lista (la agrega si no está, p. ej. al copiar un 11:15 del lunes). */
function setHour(select, value) {
  if (![...select.options].some((option) => option.value === value)) select.add(new Option(time12(value), value));
  select.value = value;
}

function scheduleRow({ day, label }) {
  const entry = state.settings.openingHours.find((item) => item.day === day) ?? { day, closed: true, open: "11:00", close: "22:00" };
  const open = !entry.closed;
  return html`<li class="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 border-t border-line py-3 first:border-t-0 sm:grid-cols-[8rem_7.5rem_1fr]" data-day="${day}">
    <span class="font-[650]">${label}</span>
    <label class="flex items-center gap-2.5 justify-self-end sm:justify-self-start">
      <input type="checkbox" role="switch" class="switch" name="day-${day}-open" ${open ? "checked" : ""} aria-label="${label} abierto" />
      <span class="w-14 text-sm text-muted" data-open-label>${open ? "Abierto" : "Cerrado"}</span>
    </label>
    <div class="col-span-2 grid max-w-[22rem] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:col-span-1 ${open ? "" : "opacity-40"}" data-times>
      <label class="sr-only" for="h-${day}-open">${label}: abre</label>
      ${hourSelect(`h-${day}-open`, `openingHours.${day}.open`, entry.open, !open)}
      <span class="text-sm text-muted">a</span>
      <label class="sr-only" for="h-${day}-close">${label}: cierra</label>
      ${hourSelect(`h-${day}-close`, `openingHours.${day}.close`, entry.close, !open)}
    </div>
  </li>`;
}

function scheduleSection() {
  const { isOwner } = state;
  return section(
    "horario",
    "Horario de atención",
    "Tu tienda muestra si estás abierto según la hora de Colombia.",
    html`<form data-form="horario" novalidate>
      <fieldset ${isOwner ? "" : "disabled"}>
        ${formAlert()}
        <ul>
          ${DAYS.map(scheduleRow)}
        </ul>
        <div class="mt-4 flex flex-wrap items-center gap-3">
          ${isOwner ? html`<button type="button" class="btn btn-ghost btn-sm" data-copy-monday>${icon("copy")} Usar el horario del lunes para todos</button>` : ""}
          <p class="hint">Si cierras a medianoche o después, elige la hora del día siguiente: 12:00 a. m. es medianoche (ej.: 6:00 p. m. a 2:00 a. m.).</p>
        </div>
      </fieldset>
      ${isOwner ? saveBar() : ""}
    </form>`,
  );
}

function deliverySection() {
  const { settings, isOwner } = state;
  return section(
    "entrega",
    "Entrega",
    "Cómo reciben tus clientes el pedido.",
    html`<form data-form="entrega" novalidate>
      <fieldset class="grid gap-6" ${isOwner ? "" : "disabled"}>
        ${formAlert()}
        <div class="grid gap-5 rounded-[12px] border border-line p-4">
          ${switchRow("d-delivery", "deliveryEnabled", settings.deliveryEnabled, "Domicilio", "Llevas el pedido a la dirección del cliente.")}
          <div class="grid gap-5" data-delivery-fields>
            ${pricingChoice(settings, !settings.deliveryEnabled)}
            <div class="field max-w-[12rem]" data-pricing="FIXED">
              <label class="label" for="d-fee">Valor del domicilio</label>
              ${moneyInput("d-fee", "deliveryFee", settings.deliveryFee, { disabled: !settings.deliveryEnabled })}
            </div>
            <div data-pricing="DISTANCE" hidden>${distanceFields(settings, !settings.deliveryEnabled)}</div>
            <div class="field">
              <label class="label" for="d-area">Zona de cobertura</label>
              <input class="input" id="d-area" name="deliveryArea" value="${settings.deliveryArea ?? ""}" placeholder="Ej.: Todo Sincelejo" maxlength="200" ${settings.deliveryEnabled ? "" : "disabled"} />
              <p class="hint">Un texto que ven tus clientes, por ejemplo «Todo Sincelejo».</p>
            </div>
          </div>
        </div>
        <div class="rounded-[12px] border border-line p-4">
          ${switchRow("d-pickup", "pickupEnabled", settings.pickupEnabled, "Recoger en el local", "El cliente pasa por su pedido.")}
        </div>
        <div class="grid gap-2 rounded-[12px] border border-line p-4">
          ${switchRow("d-dine-in", "dineInEnabled", settings.dineInEnabled, "Comer en el local", "Tus clientes escanean el QR de la mesa y piden desde su celular; se lo llevas a la mesa.")}
          <a class="w-fit text-sm font-[650] underline underline-offset-2" href="/panel/tienda#mesas">Imprimir los QR de las mesas</a>
        </div>
        <div class="field max-w-[12rem]">
          <label class="label" for="d-minimum">Pedido mínimo</label>
          ${moneyInput("d-minimum", "minimumOrder", settings.minimumOrder)}
          <p class="hint">$0 si no tienes mínimo.</p>
        </div>
      </fieldset>
      ${isOwner ? saveBar() : ""}
    </form>`,
  );
}

function paymentsSection() {
  const { settings, isOwner } = state;
  return section(
    "pagos",
    "Métodos de pago",
    "Se muestran en tu tienda para que el cliente elija cómo pagar. Abajo configuras tus QR: con ellos, Nequi, Daviplata, transferencia y llave Bre-B se pagan antes de enviar el pedido (en la mesa, al terminar de comer).",
    html`<form data-form="pagos" novalidate>
      <fieldset ${isOwner ? "" : "disabled"}>
        <legend class="sr-only">Métodos de pago aceptados</legend>
        ${formAlert()}
        <div class="flex flex-wrap gap-2.5">
          ${PAYMENT_METHODS.map(
            (method) => html`<label class="choice">
              <input type="checkbox" name="paymentMethods" data-group value="${method.value}" ${settings.paymentMethods.includes(method.value) ? "checked" : ""} />
              <span class="choice-check">${icon("check", "h-3 w-3")}</span>
              ${method.label}
            </label>`,
          )}
        </div>
      </fieldset>
      ${isOwner ? saveBar() : ""}
    </form>
    ${isOwner ? html`<div class="mt-6 border-t border-line pt-6" data-payment-accounts></div>` : ""}`,
  );
}

const SALES_POLICIES = [
  { value: "ACCEPTED", title: "Cuando acepto el pedido", text: "Cuenta desde que lo confirmas. Recomendado para la mayoría de negocios." },
  { value: "DELIVERED", title: "Cuando lo entrego", text: "Solo los pedidos marcados como entregados." },
  { value: "PAID", title: "Cuando lo marco como pagado", text: "Solo los pedidos con el pago registrado." },
];

function salesSection() {
  const { settings, isOwner } = state;
  return section(
    "ventas",
    "Ventas y reportes",
    "Qué pedidos cuentan como venta en el Inicio y en Analíticas. Un pedido cancelado nunca cuenta.",
    html`<form data-form="ventas" novalidate>
      <fieldset class="grid gap-2.5" ${isOwner ? "" : "disabled"}>
        <legend class="sr-only">Política de ventas</legend>
        ${formAlert()}
        ${SALES_POLICIES.map(
          (policy) => html`<label class="choice min-h-0 items-start justify-start gap-3 py-3">
            <input type="radio" name="salesPolicy" value="${policy.value}" ${settings.salesPolicy === policy.value ? "checked" : ""} />
            <span class="choice-check mt-0.5 rounded-full">${icon("check", "h-3 w-3")}</span>
            <span class="grid gap-0.5"><span class="font-[650]">${policy.title}</span><span class="text-sm font-normal text-muted">${policy.text}</span></span>
          </label>`,
        )}
      </fieldset>
      ${isOwner ? saveBar() : ""}
    </form>`,
  );
}

function memberRow(member) {
  const isMe = member.user.id === state.me.user.id;
  return html`<li class="flex flex-wrap items-center gap-3 border-t border-line py-3.5 first:border-t-0" data-member="${member.id}">
    <span class="grid h-10 w-10 flex-none place-items-center rounded-full bg-ground text-sm font-bold" aria-hidden="true">${initials(member.user.name)}</span>
    <span class="min-w-0 flex-1">
      <span class="block truncate font-[650]">${member.user.name}${isMe ? html` <span class="font-normal text-muted">(tú)</span>` : ""}</span>
      <span class="block truncate text-sm text-muted">${member.user.email}</span>
    </span>
    <span class="flex items-center gap-2" data-member-actions>
      <label class="sr-only" for="role-${member.id}">Rol de ${member.user.name}</label>
      <select class="input min-h-9 w-auto py-1.5 text-sm" id="role-${member.id}" data-role-select="${member.id}">
        ${Object.entries(ROLE_LABEL).map(([value, label]) => html`<option value="${value}" ${member.role === value ? "selected" : ""}>${label}</option>`)}
      </select>
      <button type="button" class="btn btn-quiet btn-icon text-muted hover:text-tomato" data-remove-member="${member.id}" aria-label="Quitar a ${member.user.name} del equipo" title="Quitar del equipo">
        ${icon("trash-2")}
      </button>
    </span>
    ${member.role === "EMPLOYEE"
      ? html`<fieldset class="w-full sm:pl-[3.25rem]">
          <legend class="mb-2 text-sm font-[650] text-muted">Puede, además de atender pedidos:</legend>
          <div class="flex flex-wrap gap-2">
            ${PERMISSION_OPTIONS.map((option) =>
              permissionChoice(`perm-${member.id}-${option.id}`, option, member.permissions?.[option.id], `data-member-permission="${member.id}" data-permission="${option.id}"`),
            )}
          </div>
        </fieldset>`
      : html`<p class="w-full text-sm text-muted sm:pl-[3.25rem]">Propietario: puede ver y cambiar todo.</p>`}
    <div class="hidden w-full items-center justify-end gap-2 rounded-[10px] bg-tomato-soft px-3 py-2.5" data-confirm-remove>
      <span class="mr-auto text-sm font-medium text-tomato">¿Quitar a ${member.user.name}? Perderá el acceso de inmediato.</span>
      <button type="button" class="btn btn-ghost btn-sm" data-cancel-remove>Cancelar</button>
      <button type="button" class="btn btn-danger btn-sm" data-confirm-remove-btn="${member.id}">Quitar</button>
    </div>
  </li>`;
}

function teamSection() {
  return section(
    "equipo",
    "Equipo",
    "Las personas que pueden entrar al panel de este negocio.",
    html`<div class="grid gap-6">
      <ul data-member-list>
        ${state.members.map(memberRow)}
      </ul>
      <details class="rounded-[12px] border border-line" ${state.members.length < 2 ? "open" : ""}>
        <summary class="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-[650]">${icon("user-plus")} Agregar a alguien</summary>
        <form data-form="miembro" class="grid gap-5 border-t border-line p-4 sm:grid-cols-2" novalidate>
          <div class="sm:col-span-2">${formAlert()}</div>
          <div class="field">
            <label class="label" for="m-name">Nombre</label>
            <input class="input" id="m-name" name="name" required maxlength="80" />
          </div>
          <div class="field">
            <label class="label" for="m-email">Correo</label>
            <input class="input" id="m-email" name="email" type="email" inputmode="email" autocomplete="off" required />
          </div>
          <div class="field">
            <label class="label" for="m-password">Contraseña inicial</label>
            <input class="input" id="m-password" name="password" type="text" autocomplete="new-password" minlength="8" />
            <p class="hint">Para crearle la cuenta. Si su correo ya tiene cuenta en Pedify, entrará con su propia contraseña. Compártela en persona.</p>
          </div>
          <div class="field">
            <label class="label" for="m-role">Rol</label>
            <select class="input" id="m-role" name="role">
              <option value="EMPLOYEE">Empleado: atiende pedidos</option>
              <option value="OWNER">Propietario: también configura el negocio</option>
            </select>
          </div>
          <fieldset class="sm:col-span-2" data-new-permissions>
            <legend class="label mb-2">Qué puede hacer, además de atender pedidos</legend>
            <div class="flex flex-wrap gap-2">
              ${PERMISSION_OPTIONS.map((option) => permissionChoice(`perm_${option.id}`, option, DEFAULT_PERMISSIONS[option.id]))}
            </div>
            <p class="hint mt-2">Lo puedes cambiar después. Editar el menú, la configuración, el plan y el equipo son siempre solo del propietario.</p>
          </fieldset>
          <div class="flex justify-end sm:col-span-2">
            <button class="btn btn-ink" type="submit">${icon("user-plus")} Agregar al equipo</button>
          </div>
        </form>
      </details>
    </div>`,
  );
}

function planSection() {
  const subscription = state.business.subscription;
  const status = { TRIAL: "En prueba gratis", ACTIVE: "Activo", PAST_DUE: "Vencido (en periodo de gracia)", EXPIRED: "Vencido" }[subscription.status];
  return section(
    "plan",
    "Mi plan",
    "Tu suscripción a Pedify.",
    html`<div class="flex flex-wrap items-center justify-between gap-4">
      <p><span class="font-[700]">Plan ${subscription.planName}</span> · ${status}</p>
      <a class="btn btn-ghost" href="/panel/plan">Ver plan, límites y pagos</a>
    </div>`,
  );
}

function accountSection() {
  const { me } = state;
  return section(
    "cuenta",
    "Mi cuenta",
    "Tus datos de acceso a Pedify.",
    html`<div class="grid gap-8">
      <form data-form="perfil" class="grid gap-5 sm:grid-cols-2" novalidate>
        <div class="sm:col-span-2">${formAlert()}</div>
        <div class="field">
          <label class="label" for="a-name">Tu nombre</label>
          <input class="input" id="a-name" name="name" value="${me.user.name}" required maxlength="80" autocomplete="name" />
        </div>
        <div class="field">
          <label class="label" for="a-email">Correo</label>
          <input class="input" id="a-email" value="${me.user.email}" disabled />
        </div>
        <div class="sm:col-span-2">${saveBar("Guardar nombre")}</div>
      </form>

      <form data-form="clave" class="grid gap-5 border-t border-line pt-6 sm:grid-cols-2" novalidate>
        <h3 class="text-base font-[720] sm:col-span-2">Cambiar contraseña</h3>
        <div class="sm:col-span-2">${formAlert()}</div>
        <div class="field">
          <label class="label" for="a-current">Contraseña actual</label>
          <input class="input" id="a-current" name="currentPassword" type="password" autocomplete="current-password" required />
        </div>
        <div class="field">
          <label class="label" for="a-new">Nueva contraseña</label>
          <input class="input" id="a-new" name="newPassword" type="password" autocomplete="new-password" minlength="8" required />
          <p class="hint">Mínimo 8 caracteres. Se cerrará tu sesión en los demás dispositivos.</p>
        </div>
        <div class="sm:col-span-2">${saveBar("Cambiar contraseña")}</div>
      </form>

      <div class="grid gap-3 border-t border-line pt-6 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <h3 class="text-base font-[720]">Cerrar sesión en todos los dispositivos</h3>
          <p class="text-sm text-muted">Úsalo si perdiste el celular o entraste desde un computador ajeno.</p>
        </div>
        <button type="button" class="btn btn-danger" data-logout-all>${icon("log-out")} Cerrar todas las sesiones</button>
      </div>
    </div>`,
  );
}

function sectionNav() {
  const items = SECTIONS.filter((item) => !item.ownerOnly || state.isOwner);
  return html`<nav aria-label="Secciones de configuración" class="min-w-0 sticky top-[3.75rem] z-20 -mx-4 bg-ground/95 px-4 py-2 sm:-mx-6 sm:px-6 lg:top-8 lg:m-0 lg:self-start lg:bg-transparent lg:p-0">
    <ul class="scroll-thin flex gap-1.5 overflow-x-auto lg:grid lg:gap-0.5 lg:overflow-visible">
      ${items.map(
        (item) => html`<li class="flex-none">
          <a href="#${item.id}" data-section-link="${item.id}" class="block rounded-full border border-line bg-paper px-3.5 py-2 text-sm font-[620] whitespace-nowrap text-muted no-underline hover:text-ink aria-[current=true]:border-ink aria-[current=true]:bg-ink aria-[current=true]:text-paper lg:rounded-[10px] lg:border-0 lg:bg-transparent lg:px-3 lg:py-2.5 lg:text-[0.9375rem] lg:aria-[current=true]:bg-paper lg:aria-[current=true]:text-ink lg:aria-[current=true]:shadow-[var(--shadow-lift)]">${!state.isOwner && item.employeeLabel ? item.employeeLabel : item.label}</a>
        </li>`,
      )}
    </ul>
  </nav>`;
}

function page() {
  const { isOwner } = state;
  return html`<div class="grid grid-cols-[minmax(0,1fr)] gap-6 lg:gap-8">
    <header>
      <h1 class="text-[1.875rem] leading-tight font-[780] sm:text-[2.375rem]">Configuración</h1>
      <p class="mt-1 text-[0.9375rem] text-muted">${state.business.name}</p>
    </header>
    ${isOwner
      ? ""
      : html`<p class="flex items-start gap-2.5 rounded-[12px] border border-sky/20 bg-sky-soft px-4 py-3 text-[0.9375rem] font-medium text-sky">
          ${icon("lock", "mt-0.5")} La configuración del negocio la maneja el propietario. Aquí activas tus avisos de pedidos y editas tu cuenta.
        </p>`}
    <div class="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-10">
      ${sectionNav()}
      <div class="grid min-w-0 gap-6">
        ${isOwner
          ? html`${businessSection()} ${whatsappSection()} ${scheduleSection()} ${deliverySection()} ${paymentsSection()} ${salesSection()}
              ${teamSection()} ${planSection()}`
          : employeeAlertsSection()}
        ${accountSection()}
      </div>
    </div>
  </div>`;
}

// ───────────────────────────── Envío de formularios ─────────────────────────────

/** Arma el cuerpo de cada formulario. */
const PAYLOADS = {
  negocio: (form) => readForm(form),
  whatsapp: (form) => readForm(form),
  horario: (form) => ({
    openingHours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day,
      closed: !form.elements[`day-${day}-open`].checked,
      open: form.elements[`openingHours.${day}.open`].value,
      close: form.elements[`openingHours.${day}.close`].value,
    })),
  }),
  entrega: (form) => ({
    deliveryEnabled: form.elements.deliveryEnabled.checked,
    ...distancePricing.read(),
    deliveryFee: parseMoney(form.elements.deliveryFee.value),
    deliveryArea: form.elements.deliveryArea.value.trim(),
    pickupEnabled: form.elements.pickupEnabled.checked,
    dineInEnabled: form.elements.dineInEnabled.checked,
    minimumOrder: parseMoney(form.elements.minimumOrder.value),
  }),
  pagos: (form) => ({ paymentMethods: readForm(form).paymentMethods ?? [] }),
  ventas: (form) => ({ salesPolicy: form.querySelector('[name="salesPolicy"]:checked')?.value }),
  perfil: (form) => readForm(form),
  clave: (form) => readForm(form),
  miembro: (form) => {
    const data = readForm(form);
    if (!data.password) delete data.password;
    const permissions = {};
    for (const option of PERMISSION_OPTIONS) {
      permissions[option.id] = Boolean(data[`perm_${option.id}`]);
      delete data[`perm_${option.id}`];
    }
    if (data.role === "EMPLOYEE") data.permissions = permissions;
    return data;
  },
};

const ENDPOINTS = {
  negocio: ["PATCH", "/businesses/current", "Datos del negocio guardados."],
  whatsapp: ["PATCH", "/businesses/current/settings", "Pedidos y WhatsApp actualizados."],
  horario: ["PATCH", "/businesses/current/settings", "Horario guardado."],
  entrega: ["PATCH", "/businesses/current/settings", "Opciones de entrega guardadas."],
  pagos: ["PATCH", "/businesses/current/settings", "Métodos de pago guardados."],
  ventas: ["PATCH", "/businesses/current/settings", "Listo: tus reportes usan la nueva política de ventas."],
  perfil: ["PATCH", "/auth/me", "Tu nombre quedó actualizado."],
  clave: ["PATCH", "/auth/password", "Contraseña cambiada. Cerramos tus otras sesiones."],
  miembro: ["POST", "/businesses/current/members", "Persona agregada al equipo."],
};

function markDirty(form, dirty) {
  form.dataset.dirty = dirty ? "true" : "";
  const save = form.querySelector("[data-save]");
  if (save) save.disabled = !dirty;
  form.querySelector("[data-dirty-note]")?.classList.toggle("hidden", !dirty);
}

async function submitForm(form) {
  const name = form.dataset.form;
  const [method, path, message] = ENDPOINTS[name];
  const button = form.querySelector('[type="submit"]');
  clearFieldErrors(form);
  setBusy(button, true);
  try {
    const result = await api(path, { method, body: PAYLOADS[name](form) });
    setBusy(button, false);
    markDirty(form, false);
    toast(message);

    if (name === "negocio") {
      state.business = { ...state.business, ...result };
      document.querySelectorAll("[data-business-name]").forEach((element) => (element.textContent = result.name));
    } else if (["whatsapp", "horario", "entrega", "pagos", "ventas"].includes(name)) {
      state.settings = result;
      if (name === "whatsapp") form.elements.whatsappPhone.value = formatPhone(result.whatsappPhone);
    } else if (name === "perfil") {
      state.me.user = result.user;
    } else if (name === "clave") {
      form.reset();
      markDirty(form, false);
    } else if (name === "miembro") {
      const { existingAccount, ...member } = result;
      state.members.push(member);
      const typedPassword = Boolean(form.elements.password?.value);
      form.reset();
      form.querySelector("[data-new-permissions]").hidden = false;
      redrawMembers();
      if (existingAccount) {
        // La cuenta ya existía: entra con su propia contraseña (la que se escribió no se usa).
        showMemberNotice(member, typedPassword);
      }
    }
  } catch (error) {
    setBusy(button, false);
    showErrors(form, error);
  }
}

/** Aviso que queda a la vista (no un mensaje que desaparece): cómo entra la persona agregada. */
function showMemberNotice(member, typedPassword) {
  const list = document.querySelector("[data-member-list]");
  if (!list) return;
  document.querySelector("[data-member-notice]")?.remove();
  const notice = document.createElement("div");
  notice.dataset.memberNotice = "";
  notice.setAttribute("role", "status");
  notice.className = "mb-4 flex items-start gap-3 rounded-[12px] border border-sky/25 bg-sky-soft px-4 py-3 text-[0.9375rem] text-sky";
  render(
    notice,
    html`${icon("info", "mt-0.5 flex-none")}
      <div class="grid gap-1">
        <p class="font-[700]">${member.user.name} ya tenía cuenta en Pedify con ${member.user.email}.</p>
        <p>
          ${typedPassword ? "Por seguridad no cambiamos su contraseña por la que escribiste: " : ""}entra con la contraseña que ya usaba,
          eligiendo «${member.role === "OWNER" ? "Soy el dueño" : "Soy empleado"}». Si no la recuerda, que toque «¿La olvidaste?» en el inicio de sesión.
        </p>
      </div>
      <button type="button" class="btn btn-quiet btn-icon -mt-1 -mr-2 ml-auto flex-none text-sky" aria-label="Cerrar aviso" data-close-notice>${icon("x")}</button>`,
  );
  notice.querySelector("[data-close-notice]").addEventListener("click", () => notice.remove());
  list.before(notice);
  notice.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function redrawMembers() {
  const list = document.querySelector("[data-member-list]");
  if (list) render(list, html`${state.members.map(memberRow)}`);
}

// ───────────────────────────── Interacciones ─────────────────────────────

function bindPage(main) {
  main.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-form]");
    if (!form) return;
    event.preventDefault();
    submitForm(form);
  });

  main.addEventListener("input", (event) => {
    const input = event.target;
    const form = input.closest("[data-form]");
    if (input.matches("[data-money]")) formatMoneyField(input);
    if (input.id === "b-description") updateCounter(input);
    if (input.getAttribute("aria-invalid") === "true") {
      input.removeAttribute("aria-invalid");
      form?.querySelector(`[data-error-for="${CSS.escape(input.name)}"]`)?.remove();
    }
    if (form && form.dataset.form !== "miembro") markDirty(form, true);
  });

  main.addEventListener("change", (event) => {
    const input = event.target;
    const form = input.closest("[data-form]");

    // Horario: un día cerrado deshabilita sus horas.
    const dayRow = input.closest("[data-day]");
    if (dayRow && input.matches('[role="switch"]')) {
      const times = dayRow.querySelector("[data-times]");
      times.classList.toggle("opacity-40", !input.checked);
      times.querySelectorAll("select").forEach((time) => (time.disabled = !input.checked));
      dayRow.querySelector("[data-open-label]").textContent = input.checked ? "Abierto" : "Cerrado";
    }
    if (input.name === "deliveryEnabled") {
      main.querySelectorAll("[data-delivery-fields] :is(input, button)").forEach((field) => (field.disabled = !input.checked));
    }
    if (input.matches("[data-role-select]")) changeRole(input);
    if (input.matches("[data-member-permission]")) changePermission(input);
    if (input.name === "role" && form?.dataset.form === "miembro") {
      form.querySelector("[data-new-permissions]").hidden = input.value !== "EMPLOYEE";
    }
    if (form && form.dataset.form !== "miembro") markDirty(form, true);
  });

  main.addEventListener("click", async (event) => {
    const target = event.target.closest("button");
    if (!target) return;

    if (target.matches("[data-copy-monday]")) {
      const form = target.closest("form");
      const monday = {
        open: form.elements["day-1-open"].checked,
        from: form.elements["openingHours.1.open"].value,
        to: form.elements["openingHours.1.close"].value,
      };
      for (const { day } of DAYS) {
        const toggle = form.elements[`day-${day}-open`];
        toggle.checked = monday.open;
        toggle.dispatchEvent(new Event("change", { bubbles: true }));
        setHour(form.elements[`openingHours.${day}.open`], monday.from);
        setHour(form.elements[`openingHours.${day}.close`], monday.to);
      }
      markDirty(form, true);
    }

    if (target.matches("[data-remove-member]")) {
      const row = target.closest("[data-member]");
      row.querySelector("[data-member-actions]").classList.add("hidden");
      const confirm = row.querySelector("[data-confirm-remove]");
      confirm.classList.replace("hidden", "flex");
      confirm.querySelector("[data-cancel-remove]").focus();
    }
    if (target.matches("[data-cancel-remove]")) {
      const row = target.closest("[data-member]");
      row.querySelector("[data-confirm-remove]").classList.replace("flex", "hidden");
      row.querySelector("[data-member-actions]").classList.remove("hidden");
      row.querySelector("[data-remove-member]").focus();
    }
    if (target.matches("[data-confirm-remove-btn]")) await removeMember(target);

    if (target.matches("[data-logout-all]")) {
      if (target.dataset.armed !== "true") {
        target.dataset.armed = "true";
        target.lastChild.textContent = " Confirmar: cerrar todas";
        return;
      }
      setBusy(target, true);
      try {
        await api("/auth/logout-all", { method: "POST" });
      } finally {
        location.assign("/login");
      }
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (main.querySelector('[data-dirty="true"]')) event.preventDefault();
  });
}

function updateCounter(textarea) {
  if (!textarea) return;
  const counter = document.querySelector(`[data-counter-for="${textarea.id}"]`);
  if (counter) counter.textContent = `${textarea.value.length}/${textarea.maxLength}`;
}

async function changeRole(select) {
  const membershipId = select.dataset.roleSelect;
  const member = state.members.find((item) => item.id === membershipId);
  select.disabled = true;
  try {
    const updated = await api(`/businesses/current/members/${membershipId}`, { method: "PATCH", body: { role: select.value } });
    Object.assign(member, updated);
    toast(`${updated.user.name} ahora es ${ROLE_LABEL[updated.role].toLowerCase()}.`);
    redrawMembers();
    if (updated.user.id === state.me.user.id && updated.role !== "OWNER") location.reload();
  } catch (error) {
    select.value = member.role;
    toast(error.message, "error");
  } finally {
    select.disabled = false;
  }
}

async function changePermission(input) {
  const membershipId = input.dataset.memberPermission;
  const member = state.members.find((item) => item.id === membershipId);
  const option = PERMISSION_OPTIONS.find((item) => item.id === input.dataset.permission);
  input.disabled = true;
  try {
    const updated = await api(`/businesses/current/members/${membershipId}`, {
      method: "PATCH",
      body: { permissions: { [option.id]: input.checked } },
    });
    Object.assign(member, updated);
    toast(`${member.user.name}: ${input.checked ? "ahora puede" : "ya no puede"} ${option.label.toLowerCase()}.`);
  } catch (error) {
    input.checked = !input.checked;
    toast(error.message, "error");
  } finally {
    input.disabled = false;
  }
}

async function removeMember(button) {
  const membershipId = button.dataset.confirmRemoveBtn;
  const member = state.members.find((item) => item.id === membershipId);
  setBusy(button, true);
  try {
    await api(`/businesses/current/members/${membershipId}`, { method: "DELETE" });
    state.members = state.members.filter((item) => item.id !== membershipId);
    toast(`${member.user.name} ya no hace parte del equipo.`);
    if (member.user.id === state.me.user.id) return location.assign("/panel");
    redrawMembers();
  } catch (error) {
    setBusy(button, false);
    toast(error.message, "error");
  }
}

/** Resalta en la navegación la sección visible. */
function trackSections(main) {
  const links = new Map([...main.querySelectorAll("[data-section-link]")].map((link) => [link.dataset.sectionLink, link]));
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;
      links.forEach((link, id) => link.setAttribute("aria-current", id === visible.target.id ? "true" : "false"));
      // En celulares la navegación es una fila desplazable: se mueve sin desplazar la página.
      const active = links.get(visible.target.id);
      const list = active?.closest("ul");
      if (list && list.scrollWidth > list.clientWidth) {
        list.scrollTo({ left: active.offsetLeft - list.offsetLeft - 16, behavior: "smooth" });
      }
    },
    { rootMargin: "-20% 0px -65% 0px" },
  );
  main.querySelectorAll("section[id]").forEach((element) => observer.observe(element));
}

// ───────────────────────────── Arranque ─────────────────────────────

const context = await initPanel("configuracion");
if (context) {
  const { me, business, main } = context;
  if (!business) {
    renderNoBusiness(main);
  } else {
    state.me = me;
    state.business = business;
    state.isOwner = business.role === "OWNER";
    try {
      const [settings, members] = await Promise.all([
        api("/businesses/current/settings"),
        state.isOwner ? api("/businesses/current/members") : Promise.resolve([]),
      ]);
      state.settings = settings;
      state.members = members;
      render(main, page());
      void mountPush(main.querySelector("[data-push-section]"), "section");
      void mountPaymentAccounts(main.querySelector("[data-payment-accounts]"));
      const deliveryForm = main.querySelector('[data-form="entrega"]');
      if (deliveryForm) distancePricing = mountDistancePricing(deliveryForm, settings);
      updateCounter(main.querySelector("#b-description"));
      bindPage(main);
      trackSections(main);
      // Otro dispositivo guardó cambios: se ofrece actualizar (redibujar podría borrar lo que escribes).
      onLive("changed", ({ scope }) => {
        if (scope === "business") showChangedElsewhere();
        if (scope === "subscription") showChangedElsewhere("Tu plan se actualizó.");
      });
      if (location.hash) main.querySelector(location.hash)?.scrollIntoView();
    } catch (error) {
      render(main, html`<p class="text-tomato">${error.message}</p>`);
    }
  }
}
