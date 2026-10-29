// Panel central de Pedify (sección 16 del documento): resumen del negocio de Pedify, analíticas en 3D,
// negocios registrados con su plan y su estado, los pagos de los planes por Nequi o Bre-B que esperan
// revisión, los ingresos y las cuentas de Pedify que los reciben. Solo para administradores.
import { api, formatCOP, formatPhone, redirectToLogin } from "./api.js";
import { chart3d } from "./chart3d.js";
import { installApp, installLabel, installState, isInstalled, openInstallHelp } from "./install.js";
import { mountPaymentAccounts } from "./payment-accounts-ui.js";
import { adminPush } from "./push.js";
import { brand, clearFieldErrors, formAlert, html, icon, initials, raw, readForm, render, setBusy, showErrors, toast } from "./ui.js";

const STATUS = {
  TRIAL: { label: "Prueba", badge: "bg-mustard-soft text-mustard-deep" },
  ACTIVE: { label: "Activo", badge: "bg-leaf-soft text-leaf" },
  PAST_DUE: { label: "En gracia", badge: "bg-mustard text-ink" },
  EXPIRED: { label: "Vencido", badge: "bg-tomato-soft text-tomato" },
  SUSPENDED: { label: "Suspendido", badge: "bg-ink text-paper" },
};
/** Filtros de la lista de negocios y la métrica que dice cuántos hay en cada uno. */
const FILTERS = [
  ["", "Todos", "total"],
  ["EXPIRING", "Por vencer", "expiring"],
  ["TRIAL", "Prueba", "trial"],
  ["ACTIVE", "Activos", "active"],
  ["PAST_DUE", "En gracia", "pastDue"],
  ["EXPIRED", "Vencidos", "expired"],
  ["SUSPENDED", "Suspendidos", "suspended"],
];
const METHODS = [["NEQUI", "Nequi"], ["BRE_B", "Llave Bre-B"], ["DAVIPLATA", "Daviplata"], ["TRANSFERENCIA", "Transferencia"], ["EFECTIVO", "Efectivo"], ["OTRO", "Otro"]];
const METHOD_LABEL = Object.fromEntries(METHODS);
const PLAN_NAME = { EMPRENDEDOR: "Emprendedor", NEGOCIO: "Negocio", EMPRESA: "Empresa" };
/** Último recordatorio de vencimiento enviado al propietario (correo y aviso al celular). */
const REMINDER_LABEL = { DAYS_5: "5 días antes", DAY_1: "1 día antes", EXPIRED: "al vencer" };
const SECTIONS = [
  { id: "resumen", label: "Resumen", icon: "house" },
  { id: "pagos", label: "Pagos por revisar", short: "Pagos", icon: "receipt" },
  { id: "negocios", label: "Negocios", icon: "store" },
  { id: "ingresos", label: "Ingresos", icon: "banknote" },
  { id: "analiticas", label: "Analíticas", icon: "chart-column" },
  { id: "cuentas", label: "Cuentas de cobro", short: "Cuentas", icon: "wallet" },
  { id: "cuenta", label: "Mi cuenta", icon: "key-round" },
];
/** Barra inferior del celular; las demás secciones quedan en «Más». */
const TABBAR = ["resumen", "pagos", "negocios", "analiticas"];
const TRANSFER_FILTERS = [["PENDING", "Por revisar"], ["APPROVED", "Aprobados"], ["REJECTED", "Rechazados"]];
const REJECT_REASONS = ["No llegó el dinero a la cuenta.", "El valor no coincide con el plan.", "No se ve bien el comprobante."];
/** Cada cuánto se revisa si llegaron pagos nuevos mientras el panel está abierto. */
const POLL_MS = 30_000;
/** Avisos de pagos en este dispositivo: estado (de push.js), texto corto y explicación. */
const PUSH_COPY = {
  on: { label: "Activo", hint: "Te llega un aviso a este dispositivo con cada pago por revisar, aunque cierres el panel." },
  off: { label: "Activar", hint: "Recibe en este celular o computador cada pago de un plan por revisar, aunque cierres el panel." },
  denied: { label: "Bloqueados", hint: "Los bloqueaste en este navegador. Actívalos en la configuración del sitio (el candado junto a la dirección)." },
  "ios-install": { label: "Ver cómo", hint: "En iPhone, primero toca Compartir → «Agregar a inicio», abre Pedify Admin desde ese ícono y activa los avisos ahí." },
  insecure: { label: "No disponible", hint: "Los avisos solo funcionan con la dirección segura (https) de Pedify." },
  unsupported: { label: "No disponible", hint: "Este navegador no permite avisos. Prueba con Chrome, Edge, Firefox o Safari actualizados." },
  disabled: { label: "No configurado", hint: "Los avisos al celular aún no están configurados en este servidor." },
};
/** «Ahora no» en la tarjeta que invita a activar los avisos (se recuerda en este dispositivo). */
const PUSH_CARD_KEY = "pedify:admin-push-card";

// Colores de las gráficas 3D sobre la tarjeta tinta (validados: contraste ≥ 3:1 con el fondo; los
// estados, además, separables con daltonismo gracias a los 2 px entre tramos, la leyenda y la tabla).
const MONEY = "#ffc72c";
const COUNT = "#e9e7f0";
const HEAT = ["#6b5000", "#966b00", "#c08c00", "#e8ad00", "#ffd34d"];
const PLAN_STATES = [
  ["TRIAL", "En prueba", "#5a93f2"],
  ["ACTIVE", "Pagando", "#2aa660"],
  ["PAST_DUE", "En gracia", "#c08000"],
  ["EXPIRED", "Vencidos", "#e04f6b"],
  ["SUSPENDED", "Suspendidos", "#8d8b97"],
];
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const WEEKDAYS_LONG = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const date = (value) => (value ? new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Bogota" }).format(new Date(value)).replace(".", "") : "—");
const shortDate = (value) => new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "America/Bogota" }).format(new Date(value)).replace(".", "");
const dateTime = (value) =>
  new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" }).format(new Date(value)).replace(".", "");
const period = (months) => (months === 12 ? "1 año" : months === 1 ? "1 mes" : `${months} meses`);
const methodLabel = (payment) => (payment.method === "WOMPI" ? `Wompi (${payment.note ?? "en línea"})` : (METHOD_LABEL[payment.method] ?? payment.method));
const sectionFromHash = () => (SECTIONS.some((section) => section.id === location.hash.slice(1)) ? location.hash.slice(1) : "resumen");
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** Ejes: "$0", "$400 mil", "$1,2 M". */
const compact = new Intl.NumberFormat("es-CO", { notation: "compact", maximumFractionDigits: 1 });
const compactCOP = (value) => `$${compact.format(value)}`;
/** "2026-10" → "oct" / "octubre de 2026"; "2026-10-29" → "29 oct" / "jueves 29 de octubre". */
const monthLabel = (month, long = false) =>
  new Intl.DateTimeFormat("es-CO", long ? { month: "long", year: "numeric", timeZone: "UTC" } : { month: "short", timeZone: "UTC" })
    .format(new Date(`${month}-15T12:00:00Z`))
    .replace(".", "");
const dayLabel = (day, long = false) =>
  new Intl.DateTimeFormat("es-CO", long ? { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" } : { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${day}T12:00:00Z`))
    .replace(".", "")
    .replace(long ? /^$/ : / de /, " ");
const hourLabel = (hour) => `${hour % 12 || 12} ${hour < 12 ? "a. m." : "p. m."}`;
/** "hace 5 min" · "hace 3 h" · "hace 2 días". */
function ago(value) {
  if (!value) return "—";
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${plural(Math.round(hours / 24), "día", "días")}`;
}

const state = {
  me: null,
  metrics: null,
  /** Series de las gráficas (se cargan en Resumen, Analíticas e Ingresos). */
  analytics: null,
  /** Los que vencen pronto, para «Para atender» del resumen. */
  expiring: null,
  list: null,
  filter: "",
  search: "",
  page: 1,
  detail: null,
  tab: sectionFromHash(),
  transfers: { status: "PENDING", page: 1, data: null },
  payments: { page: 1, data: null },
  /** Cuentas de Pedify para recibir los pagos (sin ellas, los negocios no ven el pago directo). */
  accounts: [],
  /** Avisos de pagos en este dispositivo (ver PUSH_COPY); se averigua al cargar. */
  push: null,
};
const root = document.getElementById("app");

// ───────────────────────────── Piezas ─────────────────────────────

function tile(label, value, extra) {
  return html`<div class="panel flex min-w-0 flex-col gap-2 p-4 sm:p-5">
    <dt class="text-sm font-[620] text-muted">${label}</dt>
    <dd class="grid gap-1.5">
      <span class="truncate text-[1.75rem] leading-none font-[800] [font-stretch:80%] sm:text-[2rem]">${value}</span>
      ${typeof extra === "string" ? html`<span class="text-sm text-muted">${extra}</span>` : (extra ?? "")}
    </dd>
  </div>`;
}

/** Cambio contra el periodo anterior: «+12 % vs. septiembre». */
function delta(current, previous, label) {
  if (!previous) return html`<span class="text-sm text-muted">${current ? `Sin datos de ${label} para comparar` : `Igual que ${label}`}</span>`;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return html`<span class="text-sm text-muted">Igual que ${label}</span>`;
  const up = change > 0;
  return html`<span class="flex flex-wrap items-center gap-x-1 text-sm font-[620] ${up ? "text-leaf" : "text-tomato"}">
    <span class="inline-flex items-center gap-1 whitespace-nowrap">${icon(up ? "trending-up" : "trending-down", "h-4 w-4")} ${up ? "+" : "−"}${Math.abs(change)} %</span>
    <span class="font-normal text-muted">vs. ${label}</span>
  </span>`;
}

function statusBadge(status) {
  const info = STATUS[status] ?? { label: status, badge: "bg-ground text-muted" };
  return html`<span class="badge ${info.badge}">${info.label}</span>`;
}

function pendingBanner(metrics) {
  if (!metrics.pendingTransfers) return "";
  const count = metrics.pendingTransfers;
  return html`<div class="flex flex-wrap items-center gap-3 rounded-[14px] border-2 border-ink bg-mustard-soft px-4 py-3" role="status">
    ${icon("receipt", "h-5 w-5 flex-none")}
    <p class="min-w-0 flex-1 font-[680]">${count === 1 ? "Tienes 1 pago por revisar." : `Tienes ${count} pagos por revisar.`} <span class="font-normal text-muted">Mira que el dinero llegó y apruébalo.</span></p>
    <button type="button" class="btn btn-ink btn-sm" data-tab="pagos">Revisar</button>
  </div>`;
}

/** Tarjeta tinta de una gráfica 3D, con su leyenda y su tabla. */
function chartCard(id, title, subtitle, { legend = "", note = "", headers, rows }) {
  return html`<section class="night-card" aria-labelledby="${id}-title">
    <div class="grid gap-1">
      <h2 id="${id}-title" class="text-lg leading-snug font-[740]">${title}</h2>
      <p class="max-w-[62ch] text-sm text-ink-soft">${subtitle}</p>
    </div>
    ${note}
    <div data-c3d="${id}"></div>
    ${legend}
    <details class="night-table">
      <summary>Ver como tabla</summary>
      <div class="mt-3 max-h-72 overflow-auto rounded-[10px] border border-ink-3">
        <table>
          <thead><tr>${headers.map((header, index) => html`<th class="px-3 py-2 ${index ? "text-right" : ""}">${header}</th>`)}</tr></thead>
          <tbody>${rows.map((row) => html`<tr>${row.map((cell, index) => html`<td class="px-3 py-1.5 ${index ? "num text-right" : ""}">${cell}</td>`)}</tr>`)}</tbody>
        </table>
      </div>
    </details>
  </section>`;
}

// ───────────────────────────── Gráficas 3D ─────────────────────────────

const orders = (value) => plural(value, "pedido", "pedidos");
const businessesCount = (value) => plural(value, "negocio", "negocios");
const phone = () => window.innerWidth < 640;

/** Cada gráfica: sus datos para chart3d. Se montan en los `[data-c3d]` de la sección abierta. */
const CHARTS = {
  revenue() {
    const months = state.analytics.months;
    return {
      key: "revenue",
      label: "Ingresos por los planes en los últimos 12 meses",
      cols: months.map((month) => monthLabel(month.month)),
      cells: months.map((month, index) => ({
        col: index,
        segments: [{ value: month.revenue, color: MONEY }],
        title: `${monthLabel(month.month, true)}${index === months.length - 1 ? " (en curso)" : ""}`,
        detail: month.payments ? plural(month.payments, "pago", "pagos") : "sin pagos",
      })),
      format: formatCOP,
      tick: compactCOP,
      empty: "Aún no hay ingresos. Cuando apruebes el primer pago de un plan, aparece aquí.",
    };
  },
  growth() {
    const months = state.analytics.months;
    return {
      key: "growth",
      label: "Negocios nuevos por mes en los últimos 12 meses",
      cols: months.map((month) => monthLabel(month.month)),
      cells: months.map((month, index) => ({ col: index, segments: [{ value: month.newBusinesses, color: COUNT }], title: monthLabel(month.month, true) })),
      format: businessesCount,
      tick: String,
      empty: "Aún no se registran negocios.",
    };
  },
  days() {
    const days = state.analytics.days;
    return {
      key: "days",
      label: "Pedidos por día en todas las tiendas, últimos 30 días",
      cols: days.map((day) => dayLabel(day.day)),
      cells: days.map((day, index) => ({
        col: index,
        segments: [{ value: day.orders, color: COUNT }],
        title: dayLabel(day.day, true),
        detail: `ventas ${formatCOP(day.gmv)}`,
      })),
      colLabel: (index) => ((days.length - 1 - index) % (phone() ? 10 : 5) === 0 ? dayLabel(days[index].day) : null),
      format: orders,
      tick: String,
      empty: "Aún no hay pedidos en estos 30 días.",
    };
  },
  hours() {
    const grid = heatGrid();
    return {
      key: "hours",
      label: "Pedidos por día de la semana y hora, últimos 30 días",
      cols: Array.from({ length: 24 }, (_, hour) => hourLabel(hour)),
      rows: WEEKDAYS,
      cells: grid.cells.map(({ weekday, hour, value }) => ({
        col: hour,
        row: weekday,
        segments: [{ value, color: HEAT[Math.max(0, Math.ceil((value / grid.max) * HEAT.length) - 1)] }],
        title: `${WEEKDAYS_LONG[weekday]} · ${hourLabel(hour)} a ${hourLabel((hour + 1) % 24)}`,
      })),
      colLabel: (hour) => (hour % (phone() ? 6 : 3) === 0 ? hourLabel(hour) : null),
      rowLabel: (weekday) => (phone() && weekday % 2 === 1 ? null : WEEKDAYS[weekday]),
      views: ["iso", "top"],
      maxSlot: 40,
      height: phone() ? 300 : 420,
      format: orders,
      tick: String,
      empty: "Cuando las tiendas reciban pedidos, aquí verás a qué horas piden más.",
    };
  },
  plans() {
    const counts = planCounts();
    return {
      key: "plans",
      label: "Negocios por plan y estado de la suscripción",
      cols: state.metrics.plans.map((plan) => plan.name),
      cells: state.metrics.plans.map((plan, index) => ({
        col: index,
        segments: PLAN_STATES.map(([status, name, color]) => ({ value: counts[plan.code]?.[status] ?? 0, color, name })),
        title: `Plan ${plan.name}`,
        detail: `${formatCOP(plan.priceMonthly)}/mes`,
      })),
      maxSlot: 120,
      format: businessesCount,
      tick: String,
      empty: "Aún no hay negocios registrados.",
    };
  },
};

/** Las 7 × 24 casillas de la gráfica de horas (con 0 donde no hubo pedidos) y el máximo. */
function heatGrid() {
  const byKey = new Map(state.analytics.hours.map((cell) => [`${cell.weekday}-${cell.hour}`, cell.orders]));
  const cells = WEEKDAYS.flatMap((_, weekday) => Array.from({ length: 24 }, (__, hour) => ({ weekday, hour, value: byKey.get(`${weekday}-${hour}`) ?? 0 })));
  return { cells, max: Math.max(1, ...cells.map((cell) => cell.value)) };
}

/** { NEGOCIO: { TRIAL: 2, ACTIVE: 1 }, … } */
function planCounts() {
  const counts = {};
  for (const row of state.analytics.plans) (counts[row.plan] ??= {})[row.status] = row.count;
  return counts;
}

function mountCharts(container) {
  container.querySelectorAll("[data-c3d]").forEach((element) => {
    const spec = CHARTS[element.dataset.c3d];
    if (spec && state.analytics) chart3d(element, spec());
  });
}

function revenueChart() {
  const months = state.analytics.months;
  const total = months.reduce((sum, month) => sum + month.revenue, 0);
  return chartCard("revenue", "Ingresos por mes", `Lo que te han pagado por los planes en los últimos 12 meses: ${formatCOP(total)} en total.`, {
    headers: ["Mes", "Pagos", "Recibido"],
    rows: months.map((month) => [monthLabel(month.month, true), String(month.payments), formatCOP(month.revenue)]),
  });
}

// ───────────────────────────── Resumen ─────────────────────────────

function attentionView() {
  const { metrics } = state;
  const soon = state.expiring?.items ?? [];
  const { pastDue, expired } = metrics.businesses;
  const clear = !metrics.pendingTransfers && soon.length === 0 && !pastDue && !expired;
  return html`<section class="panel grid content-start gap-4 p-4 sm:p-5" aria-labelledby="attention-title">
    <h2 id="attention-title" class="text-lg font-[740]">Para atender</h2>
    ${clear
      ? html`<p class="flex items-start gap-3 rounded-[12px] bg-leaf-soft px-4 py-3 text-leaf">
          ${icon("circle-check", "mt-0.5 h-5 w-5 flex-none")} <span><strong class="font-[720]">Todo al día.</strong> No hay pagos por revisar ni planes por vencer esta semana.</span>
        </p>`
      : ""}
    ${metrics.pendingTransfers
      ? html`<button type="button" class="flex items-center gap-3 rounded-[12px] bg-mustard-soft px-4 py-3 text-left text-mustard-deep hover:bg-[#ffecb0]" data-tab="pagos">
          ${icon("receipt", "h-5 w-5 flex-none")}
          <span class="min-w-0 flex-1 font-[680]">${plural(metrics.pendingTransfers, "pago por revisar", "pagos por revisar")}</span>
          ${icon("arrow-right", "h-4 w-4 flex-none")}
        </button>`
      : html`<button type="button" class="flex items-center gap-3 rounded-[12px] bg-ground px-4 py-3 text-left hover:bg-line" data-tab="pagos">
          ${icon("receipt", "h-5 w-5 flex-none text-muted")}
          <span class="min-w-0 flex-1"><span class="block font-[680]">Pagos por revisar</span><span class="block text-sm text-muted">Ninguno ahora. Aquí ves y apruebas los pagos de los planes.</span></span>
          ${icon("arrow-right", "h-4 w-4 flex-none text-muted")}
        </button>`}
    <div class="grid gap-2">
      <h3 class="text-sm font-[680] text-muted">Vencen en los próximos 7 días</h3>
      ${soon.length === 0
        ? html`<p class="text-sm text-muted">Ningún plan ni prueba vence esta semana.</p>`
        : html`<ul class="grid divide-y divide-line">
            ${soon.map(
              (business) => html`<li>
                <button type="button" class="flex w-full items-center gap-3 py-2.5 text-left" data-business="${business.id}">
                  <span class="grid h-9 w-9 flex-none place-items-center rounded-full bg-ground text-sm font-[720]" aria-hidden="true">${initials(business.name)}</span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-[660]">${business.name}</span>
                    <span class="block truncate text-sm text-muted">
                      ${business.subscriptionStatus === "TRIAL" ? "Prueba" : PLAN_NAME[business.plan]} · vence el ${shortDate(business.endsAt)}
                      ${business.paymentInReview ? html` · <span class="font-[680] text-mustard-deep">pago en revisión</span>` : business.lastReminder ? ` · avisado ${REMINDER_LABEL[business.lastReminder]}` : ""}
                    </span>
                  </span>
                  ${icon("arrow-right", "h-4 w-4 flex-none text-muted")}
                </button>
              </li>`,
            )}
          </ul>`}
    </div>
    ${pastDue || expired
      ? html`<div class="flex flex-wrap gap-2 border-t border-line pt-4">
          ${pastDue ? html`<button type="button" class="cat-chip" data-goto-filter="PAST_DUE">${plural(pastDue, "en gracia", "en gracia")}</button>` : ""}
          ${expired ? html`<button type="button" class="cat-chip" data-goto-filter="EXPIRED">${plural(expired, "vencido", "vencidos")}</button>` : ""}
        </div>`
      : ""}
  </section>`;
}

function systemView() {
  const { system } = state.metrics;
  return html`${system.environment === "staging" ? html`<span class="badge bg-ink text-mustard">Entorno de pruebas</span>` : ""}
    ${system.warnings?.length
      ? html`<div class="rounded-[12px] border border-mustard-press bg-mustard-soft px-4 py-3 text-mustard-deep" role="status">
          <p class="flex items-center gap-2 font-[720]">${icon("circle-alert", "h-4 w-4")} Pendiente de configurar en el servidor</p>
          <ul class="mt-1.5 grid list-disc gap-1 pl-6 text-sm">${system.warnings.map((warning) => html`<li>${warning}</li>`)}</ul>
          <p class="mt-2 text-sm">Guía: docs/deployment.md</p>
        </div>`
      : ""}`;
}

/** Pedidos y ventas de las tiendas en los 30 días de las gráficas (para que las cifras coincidan). */
function last30() {
  return state.analytics.days.reduce((sum, day) => ({ orders: sum.orders + day.orders, gmv: sum.gmv + day.gmv }), { orders: 0, gmv: 0 });
}

function resumenView() {
  const { businesses, mrr, revenue } = state.metrics;
  const activity = last30();
  const months = state.analytics.months;
  const previousMonth = months.at(-2);
  return html`${pendingBanner(state.metrics)}
    <div class="contents" data-push-card>${pushCard()}</div>
    <dl class="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))] lg:gap-4">
      ${tile("Recibido este mes", formatCOP(revenue.month), delta(revenue.month, previousMonth?.revenue ?? 0, monthLabel(previousMonth.month, true).split(" ")[0]))}
      ${tile("Ingreso mensual de los planes", formatCOP(mrr), `${plural(businesses.active, "negocio pagando", "negocios pagando")}`)}
      ${tile("Negocios", String(businesses.total), `+${businesses.new30} en 30 días · ${businesses.trial} en prueba`)}
      ${tile("Pedidos en las tiendas (30 días)", String(activity.orders), delta(activity.orders, state.analytics.previous.orders, "los 30 días anteriores"))}
    </dl>
    <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-6">${revenueChart()} ${attentionView()}</div>
    ${systemView()}`;
}

// ───────────────────────────── Analíticas ─────────────────────────────

function hoursCard() {
  const grid = heatGrid();
  const busiest = grid.cells.reduce((best, cell) => (cell.value > best.value ? cell : best), grid.cells[0]);
  const note = busiest.value
    ? html`<p class="flex items-start gap-2 text-[0.9375rem]">
        ${icon("flame", "mt-0.5 h-4 w-4 flex-none text-mustard")}
        <span>Lo más movido: <strong class="font-[720]">${WEEKDAYS_LONG[busiest.weekday].toLowerCase()} de ${hourLabel(busiest.hour)} a ${hourLabel((busiest.hour + 1) % 24)}</strong> (${orders(busiest.value)}).</span>
      </p>`
    : "";
  const legend = html`<div class="night-legend" aria-label="Escala de color">
    <span>Menos</span>${HEAT.map((color) => html`<i style="background:${color}"></i>`)}<span>Más pedidos</span>
  </div>`;
  return chartCard("hours", "¿Cuándo piden?", "Pedidos de todas las tiendas en los últimos 30 días, por día de la semana y hora. Mira desde arriba para verlo como un mapa de calor.", {
    note,
    legend,
    headers: ["Día", ...Array.from({ length: 24 }, (_, hour) => hourLabel(hour))],
    rows: WEEKDAYS_LONG.map((name, weekday) => [name, ...grid.cells.filter((cell) => cell.weekday === weekday).map((cell) => String(cell.value))]),
  });
}

function daysCard() {
  const days = state.analytics.days;
  const total = days.reduce((sum, day) => sum + day.orders, 0);
  return chartCard("days", "Pedidos por día", `${orders(total)} en todas las tiendas en los últimos 30 días.`, {
    headers: ["Día", "Pedidos", "Ventas"],
    rows: days.map((day) => [dayLabel(day.day, true), String(day.orders), formatCOP(day.gmv)]),
  });
}

function growthCard() {
  const months = state.analytics.months;
  return chartCard("growth", "Negocios nuevos por mes", `${businessesCount(months.reduce((sum, month) => sum + month.newBusinesses, 0))} se registraron en los últimos 12 meses.`, {
    headers: ["Mes", "Negocios nuevos"],
    rows: months.map((month) => [monthLabel(month.month, true), String(month.newBusinesses)]),
  });
}

function plansCard() {
  const counts = planCounts();
  const totals = Object.fromEntries(PLAN_STATES.map(([status]) => [status, state.metrics.plans.reduce((sum, plan) => sum + (counts[plan.code]?.[status] ?? 0), 0)]));
  const legend = html`<div class="night-legend">
    ${PLAN_STATES.filter(([status]) => status !== "SUSPENDED" || totals.SUSPENDED).map(
      ([status, name, color]) => html`<span><i style="background:${color}"></i>${name} <strong class="num font-[700] text-paper">${totals[status]}</strong></span>`,
    )}
  </div>`;
  return chartCard("plans", "Negocios por plan", "Cada torre es un plan; sus tramos, cuántos negocios están en prueba, pagando, en gracia o vencidos.", {
    legend,
    headers: ["Plan", ...PLAN_STATES.map(([, name]) => name)],
    rows: state.metrics.plans.map((plan) => [plan.name, ...PLAN_STATES.map(([status]) => String(counts[plan.code]?.[status] ?? 0))]),
  });
}

function topStoresView() {
  const stores = state.analytics.topStores;
  const max = Math.max(1, ...stores.map((store) => store.orders));
  return html`<section class="panel grid content-start gap-4 p-4 sm:p-5" aria-labelledby="top-stores-title">
    <div class="grid gap-1">
      <h2 id="top-stores-title" class="text-lg font-[740]">Tiendas con más pedidos</h2>
      <p class="text-sm text-muted">Últimos 30 días.</p>
    </div>
    ${stores.length === 0
      ? html`<p class="text-sm text-muted">Aún no hay pedidos en estos 30 días.</p>`
      : html`<ol class="grid gap-1">
          ${stores.map(
            (store, index) => html`<li>
              <button type="button" class="grid w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-[10px] px-2 py-2 text-left hover:bg-ground" data-business="${store.id}">
                <span class="num text-sm font-[720] text-muted">${index + 1}</span>
                <span class="truncate font-[660]">${store.name}</span>
                <span class="num text-sm font-[700]">${orders(store.orders)}</span>
                <span class="col-start-2 h-1.5 rounded-full bg-ground" aria-hidden="true">
                  <span class="block h-full rounded-full bg-[var(--color-chart)]" style="width: ${Math.max(3, (store.orders / max) * 100)}%"></span>
                </span>
                <span class="num text-xs text-muted">${formatCOP(store.gmv)}</span>
              </button>
            </li>`,
          )}
        </ol>`}
  </section>`;
}

function analyticsView() {
  const { orders: recent, businesses } = state.metrics;
  const { previous } = state.analytics;
  const activity = last30();
  return html`<dl class="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))] lg:gap-4">
      ${tile("Pedidos (30 días)", String(activity.orders), delta(activity.orders, previous.orders, "los 30 días anteriores"))}
      ${tile("Ventas de las tiendas (30 días)", formatCOP(activity.gmv), delta(activity.gmv, previous.gmv, "los 30 días anteriores"))}
      ${tile("Tiendas con pedidos", String(recent.storesWithOrders7), `De ${businesses.total} negocios, en los últimos 7 días`)}
      ${tile("Negocios nuevos (30 días)", String(businesses.new30), `+${businesses.new7} en los últimos 7 días`)}
    </dl>
    ${hoursCard()}
    <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-6">${daysCard()} ${topStoresView()}</div>
    <div class="grid items-start gap-4 lg:grid-cols-2 lg:gap-6">${growthCard()} ${plansCard()}</div>`;
}

// ───────────────────────────── Negocios ─────────────────────────────

function businessRow(business) {
  return html`<tr class="cursor-pointer hover:bg-ground" data-business="${business.id}" tabindex="0">
    <td class="min-w-[17rem] px-4 py-3">
      <span class="flex items-center gap-3">
        <span class="grid h-9 w-9 flex-none place-items-center rounded-full bg-ground text-sm font-[720]" aria-hidden="true">${initials(business.name)}</span>
        <span class="min-w-0">
          <span class="block font-[680]">${business.name}</span>
          <span class="block text-sm text-muted [overflow-wrap:anywhere]">/tienda/${business.slug}${business.city ? ` · ${business.city}` : ""}</span>
        </span>
      </span>
    </td>
    <td class="px-3 py-3">
      <span class="block">${business.ownerName ?? "—"}</span>
      <span class="block text-sm text-muted">${business.ownerEmail ?? ""}</span>
    </td>
    <td class="px-3 py-3">${PLAN_NAME[business.plan] ?? business.plan}</td>
    <td class="px-3 py-3">
      ${statusBadge(business.subscriptionStatus)}
      <span class="mt-1 block text-xs whitespace-nowrap text-muted">
        ${business.paidUntil && new Date(business.paidUntil) > new Date(business.trialEndsAt) ? `Pagado hasta el ${shortDate(business.paidUntil)}` : `Prueba hasta el ${shortDate(business.trialEndsAt)}`}
      </span>
      ${business.paymentInReview
        ? html`<span class="mt-0.5 block text-xs font-[680] text-mustard-deep">Pago en revisión</span>`
        : business.lastReminder
          ? html`<span class="mt-0.5 block text-xs text-muted">Avisado ${REMINDER_LABEL[business.lastReminder]}</span>`
          : ""}
    </td>
    <td class="num px-3 py-3 text-right">${business.products}</td>
    <td class="num px-3 py-3 text-right">${business.orders30}</td>
    <td class="px-3 py-3 text-sm whitespace-nowrap text-muted">${ago(business.lastOrderAt)}</td>
    <td class="px-4 py-3 text-sm whitespace-nowrap text-muted">${shortDate(business.createdAt)} ${new Date(business.createdAt).getFullYear()}</td>
  </tr>`;
}

function listView() {
  const list = state.list;
  const counts = state.metrics.businesses;
  return html`<div class="flex flex-wrap items-center gap-2">
      ${FILTERS.map(
        ([value, label, metric]) => html`<button type="button" class="cat-chip" aria-pressed="${state.filter === value}" data-filter="${value}">
          ${label}<span class="num ml-1.5 opacity-70">${counts[metric] ?? 0}</span>
        </button>`,
      )}
      <div class="input-group w-full sm:ml-auto sm:max-w-xs">
        <label class="addon border-0 bg-transparent pr-0" for="admin-search">${icon("search")}<span class="sr-only">Buscar negocio</span></label>
        <input class="input" id="admin-search" type="search" placeholder="Negocio, enlace o correo" value="${state.search}" data-search autocomplete="off" />
      </div>
    </div>
    <div class="panel overflow-x-auto">
      <table class="w-full min-w-[62rem] text-left text-[0.9375rem]">
        <thead class="bg-ground text-sm text-muted">
          <tr>
            <th class="px-4 py-2.5 font-[650]">Negocio</th><th class="px-3 py-2.5 font-[650]">Propietario</th><th class="px-3 py-2.5 font-[650]">Plan</th>
            <th class="px-3 py-2.5 font-[650]">Estado</th><th class="px-3 py-2.5 text-right font-[650]">Productos</th><th class="px-3 py-2.5 text-right font-[650]">Pedidos 30 d</th>
            <th class="px-3 py-2.5 font-[650]">Último pedido</th><th class="px-4 py-2.5 font-[650]">Registro</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          ${list.items.length === 0 ? html`<tr><td colspan="8" class="px-4 py-8 text-center text-muted">No hay negocios con ese filtro.</td></tr>` : list.items.map(businessRow)}
        </tbody>
      </table>
    </div>
    ${list.totalPages > 1
      ? html`<div class="flex items-center justify-center gap-3 text-sm">
          <button type="button" class="btn btn-ghost btn-sm" data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>Anterior</button>
          <span>Página ${state.page} de ${list.totalPages}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-page="${state.page + 1}" ${state.page >= list.totalPages ? "disabled" : ""}>Siguiente</button>
        </div>`
      : ""}`;
}

function detailView(business) {
  const sub = business.subscription;
  const owner = business.memberships.find((member) => member.role === "OWNER")?.user;
  return html`<div class="flex min-h-0 flex-auto flex-col">
    <header class="flex items-center gap-3 border-b border-line py-3 pr-3 pl-5">
      <h2 id="detail-title" class="min-w-0 truncate text-lg font-[780] outline-none" tabindex="-1">${business.name}</h2>
      ${statusBadge(business.status === "SUSPENDED" ? "SUSPENDED" : sub.status)}
      <button type="button" class="btn btn-quiet btn-icon ml-auto" data-close aria-label="Cerrar">${icon("x")}</button>
    </header>
    <div class="min-h-0 flex-auto overflow-y-auto px-5 py-5">
      <div class="grid gap-6">
        <section class="grid gap-1 text-[0.9375rem]">
          <a class="font-[650]" href="${business.storeUrl}" target="_blank" rel="noopener">${business.storeUrl} ${icon("external-link", "inline h-4 w-4 align-[-3px]")}</a>
          <p class="text-muted">Teléfono ${formatPhone(business.phone)} · registrado el ${date(business.createdAt)}</p>
          <p>Propietario: <span class="font-[650]">${owner?.name ?? "—"}</span> <span class="text-muted">${owner?.email ?? ""}</span></p>
          <p class="text-muted">${business._count.products} productos · ${business._count.orders} pedidos · ${business._count.customers} clientes · ${business.memberships.length} personas en el equipo</p>
        </section>

        <section class="grid gap-2 rounded-[12px] bg-ground p-4">
          <p class="font-[740]">Plan ${sub.planName} · ${formatCOP(sub.priceMonthly)}/mes · ${formatCOP(sub.priceYearly)}/año</p>
          <p class="text-sm">Prueba hasta el ${date(sub.trialEndsAt)} · ${sub.paidUntil ? `pagado hasta el ${date(sub.paidUntil)}` : "sin pagos"}</p>
          ${sub.status === "PAST_DUE" ? html`<p class="text-sm text-mustard-deep">Vencido: recibe pedidos hasta el ${date(sub.graceEndsAt)}.</p>` : ""}
          ${sub.status === "EXPIRED" ? html`<p class="text-sm text-tomato">Vencido: la tienda no recibe pedidos en línea.</p>` : ""}
        </section>

        <form class="grid gap-4 rounded-[12px] border border-line p-4" data-payment-form novalidate>
          <h3 class="font-[740]">Registrar pago</h3>
          ${formAlert()}
          <div class="grid gap-4 sm:grid-cols-3">
            <div class="field">
              <label class="label" for="p-plan">Plan</label>
              <select class="input" id="p-plan" name="plan">
                ${state.metrics.plans.map((plan) => html`<option value="${plan.code}" ${plan.code === sub.plan ? "selected" : ""}>${plan.name} · ${formatCOP(plan.priceMonthly)}/mes</option>`)}
              </select>
            </div>
            <div class="field">
              <label class="label" for="p-months">Meses</label>
              <input class="input num" id="p-months" name="months" type="number" min="1" max="12" value="1" required />
              <p class="hint">12 meses = pago anual, con su descuento.</p>
            </div>
            <div class="field">
              <label class="label" for="p-amount">Valor recibido</label>
              <input class="input num" id="p-amount" name="amount" inputmode="numeric" placeholder="Precio del plan" />
            </div>
            <div class="field">
              <label class="label" for="p-method">Medio</label>
              <select class="input" id="p-method" name="method">${METHODS.map(([value, label]) => html`<option value="${value}">${label}</option>`)}</select>
            </div>
            <div class="field sm:col-span-2">
              <label class="label" for="p-reference">Referencia del comprobante</label>
              <input class="input" id="p-reference" name="reference" maxlength="80" />
            </div>
          </div>
          <button type="submit" class="btn btn-ink justify-self-start">${icon("check")} Registrar pago y extender</button>
        </form>

        <section class="grid gap-3 rounded-[12px] border border-line p-4">
          <h3 class="font-[740]">Otras acciones</h3>
          <div class="flex flex-wrap items-end gap-2">
            <div class="field w-28">
              <label class="label" for="trial-days">Días de prueba</label>
              <input class="input num" id="trial-days" type="number" min="1" max="90" value="7" />
            </div>
            <button type="button" class="btn btn-ghost" data-extend-trial>Ampliar prueba</button>
          </div>
          <div class="flex flex-wrap gap-2 border-t border-line pt-3">
            ${business.status === "SUSPENDED"
              ? html`<button type="button" class="btn btn-ink" data-set-status="ACTIVE">Reactivar negocio</button>`
              : html`<button type="button" class="btn btn-danger" data-set-status="SUSPENDED" data-confirm="Suspender: el negocio pierde el panel y su tienda deja de verse.">Suspender negocio</button>`}
          </div>
        </section>

        <section>
          <h3 class="mb-2 font-[740]">Pagos</h3>
          ${business.payments.length === 0
            ? html`<p class="text-sm text-muted">Sin pagos registrados.</p>`
            : html`<ul class="divide-y divide-line text-[0.9375rem]">
                ${business.payments.map(
                  (payment) => html`<li class="flex flex-wrap justify-between gap-2 py-2.5">
                    <span>${date(payment.createdAt)} · ${payment.months} ${payment.months === 1 ? "mes" : "meses"} · ${methodLabel(payment)}${payment.reference ? ` · ${payment.reference}` : ""}</span>
                    <span class="num font-[700]">${formatCOP(payment.amount)}</span>
                    <span class="w-full text-sm text-muted">Periodo ${date(payment.periodStart)} – ${date(payment.periodEnd)}${payment.recordedBy ? ` · registró ${payment.recordedBy.name}` : payment.method === "WOMPI" ? " · pagado en línea" : ""}</span>
                  </li>`,
                )}
              </ul>`}
        </section>
      </div>
    </div>
  </div>`;
}

// ─── Pagos por revisar (Nequi o llave Bre-B a las cuentas de Pedify) ───

/** Revisión automática del comprobante (la hace Pedify al leerlo): texto, color e ícono. */
const PROOF_CHECK = {
  PENDING: { headline: "Revisando el comprobante…", tone: "text-muted", icon: "loader-circle" },
  VERIFIED: { headline: "Todo coincide con el plan", tone: "text-leaf", icon: "circle-check" },
  REVIEW: { headline: "Revísalo: no pudimos leerlo todo", tone: "text-mustard-deep", icon: "circle-alert" },
  MISMATCH: { headline: "Algo no coincide: revísalo con cuidado", tone: "text-tomato", icon: "circle-x" },
};

function proofChecks(transfer) {
  const result = PROOF_CHECK[transfer.checkStatus] ?? PROOF_CHECK.REVIEW;
  const mark = (ok) =>
    ok === true
      ? icon("circle-check", "mt-0.5 h-4 w-4 flex-none text-leaf")
      : ok === false
        ? icon("circle-x", "mt-0.5 h-4 w-4 flex-none text-tomato")
        : icon("circle-alert", "mt-0.5 h-4 w-4 flex-none text-muted");
  return html`<div class="grid content-start gap-2 rounded-[10px] bg-ground p-3">
    <p class="flex items-center gap-2 font-[720] ${result.tone}">
      ${icon(result.icon, `h-[18px] w-[18px] ${transfer.checkStatus === "PENDING" ? "animate-spin" : ""}`)} ${result.headline}
    </p>
    ${transfer.checks.length > 0
      ? html`<ul class="grid gap-1.5 text-sm">
          ${transfer.checks.map((check) => html`<li class="flex items-start gap-2">${mark(check.ok)}<span><span class="font-[650]">${check.title}:</span> ${check.detail}</span></li>`)}
        </ul>`
      : ""}
  </div>`;
}

function transferCard(transfer) {
  const owner = transfer.paidBy;
  return html`<article class="panel grid content-start gap-4 p-4 sm:p-5" data-transfer="${transfer.id}">
    <header class="flex flex-wrap items-start gap-x-4 gap-y-1">
      <div class="min-w-0 flex-1">
        <h3 class="text-lg leading-snug font-[760]">
          <button type="button" class="text-left underline-offset-2 hover:underline" data-business="${transfer.business.id}">${transfer.business.name}</button>
        </h3>
        <p class="text-sm text-muted">${owner?.name ?? "—"}${owner?.email ? ` · ${owner.email}` : ""} · ${formatPhone(transfer.business.phone)}</p>
      </div>
      <p class="num text-[1.625rem] leading-none font-[820] [font-stretch:80%]">${formatCOP(transfer.amount)}</p>
    </header>
    <p class="text-[0.9375rem]">
      Plan <strong class="font-[720]">${transfer.planName}</strong> · ${period(transfer.months)} · por <strong class="font-[720]">${transfer.methodLabel}</strong>
      <span class="block text-sm text-muted">Enviado el ${dateTime(transfer.createdAt)}${transfer.reference ? ` · referencia ${transfer.reference}` : ""}</span>
    </p>
    <div class="grid gap-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
      <a href="/api/v1/admin/transfers/${transfer.id}/image" target="_blank" rel="noopener" class="justify-self-start" title="Ver el comprobante completo">
        <img src="/api/v1/admin/transfers/${transfer.id}/image" alt="Comprobante de ${transfer.business.name}" class="h-36 w-28 rounded-[8px] border border-line bg-paper object-cover object-top" loading="lazy" />
      </a>
      ${proofChecks(transfer)}
    </div>
    ${transfer.status === "PENDING"
      ? html`<div class="grid gap-3 border-t border-line pt-4">
          <p class="flex items-start gap-2 text-sm text-muted">${icon("shield", "mt-0.5 h-4 w-4 flex-none")} Antes de aprobar, mira en tu app de Nequi o de tu banco que el dinero llegó.</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-ink" data-approve="${transfer.id}">${icon("check")} Aprobar y activar el plan</button>
            <button type="button" class="btn btn-ghost" data-reject-open="${transfer.id}">Rechazar</button>
          </div>
          <form class="hidden gap-3 rounded-[12px] border border-line p-3" data-reject-form="${transfer.id}" novalidate>
            ${formAlert()}
            <div class="flex flex-wrap gap-1.5">
              ${REJECT_REASONS.map((reason) => html`<button type="button" class="cat-chip" data-reason="${reason}">${reason}</button>`)}
            </div>
            <div class="field">
              <label class="label" for="reason-${transfer.id}">Motivo (lo ve el negocio)</label>
              <input class="input" id="reason-${transfer.id}" name="reason" maxlength="200" required />
            </div>
            <button type="submit" class="btn btn-danger btn-sm justify-self-start">Rechazar el pago</button>
          </form>
        </div>`
      : transfer.status === "APPROVED"
        ? html`<p class="flex items-center gap-2 border-t border-line pt-3 text-sm text-leaf">
            ${icon("circle-check", "h-4 w-4")} Aprobado${transfer.reviewedBy ? ` por ${transfer.reviewedBy.name}` : ""} el ${dateTime(transfer.reviewedAt)}
          </p>`
        : html`<p class="flex items-start gap-2 border-t border-line pt-3 text-sm text-tomato">
            ${icon("circle-x", "mt-0.5 h-4 w-4 flex-none")} Rechazado el ${dateTime(transfer.reviewedAt)}: ${transfer.rejectReason}
          </p>`}
  </article>`;
}

function pager(data, attribute) {
  if (data.totalPages <= 1) return "";
  return html`<div class="flex items-center justify-center gap-3 text-sm">
    <button type="button" class="btn btn-ghost btn-sm" ${attribute}="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>Anterior</button>
    <span>Página ${data.page} de ${data.totalPages}</span>
    <button type="button" class="btn btn-ghost btn-sm" ${attribute}="${data.page + 1}" ${data.page >= data.totalPages ? "disabled" : ""}>Siguiente</button>
  </div>`;
}

function transfersView() {
  const { data, status } = state.transfers;
  const ready = state.accounts.some((account) => account.accountKey || account.qrSvg);
  return html`<div class="grid gap-4">
    ${ready
      ? ""
      : html`<div class="flex flex-wrap items-center gap-3 rounded-[12px] border border-mustard-press bg-mustard-soft px-4 py-3 text-mustard-deep" role="status">
          ${icon("circle-alert", "h-5 w-5 flex-none")}
          <p class="min-w-0 flex-1">Aún no configuras tus cuentas de cobro: los negocios no ven la opción de pagar por Nequi o Bre-B.</p>
          <button type="button" class="btn btn-ink btn-sm" data-tab="cuentas">Configurar</button>
        </div>`}
    <div class="flex flex-wrap gap-2">
      ${TRANSFER_FILTERS.map(([value, label]) => html`<button type="button" class="cat-chip" aria-pressed="${status === value}" data-transfer-filter="${value}">${label}</button>`)}
    </div>
    ${data.items.length === 0
      ? html`<p class="panel px-5 py-8 text-center text-muted">
          ${status === "PENDING" ? "No hay pagos por revisar. Cuando un negocio suba un comprobante, aparece aquí y te llega un correo." : "Todavía no hay pagos aquí."}
        </p>`
      : html`<div class="grid items-start gap-4 xl:grid-cols-2">${data.items.map(transferCard)}</div>`}
    ${pager(data, "data-transfer-page")}
  </div>`;
}

// ─── Ingresos ───

function revenueView() {
  const { revenue, mrr } = state.metrics;
  const data = state.payments.data;
  return html`<dl class="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))] lg:gap-4">
      ${tile("Este mes", formatCOP(revenue.month))}
      ${tile("Últimos 30 días", formatCOP(revenue.days30))}
      ${tile("Total recibido", formatCOP(revenue.total), plural(revenue.payments, "pago", "pagos"))}
      ${tile("Al mes con los planes activos", formatCOP(mrr), "Precio de lista")}
    </dl>
    ${revenueChart()}
    <div class="panel overflow-x-auto">
      <table class="w-full min-w-[52rem] text-left text-[0.9375rem]">
        <thead class="bg-ground text-sm text-muted">
          <tr>
            <th class="px-4 py-2.5 font-[650]">Fecha</th><th class="px-3 py-2.5 font-[650]">Negocio</th><th class="px-3 py-2.5 font-[650]">Plan</th>
            <th class="px-3 py-2.5 font-[650]">Medio</th><th class="px-3 py-2.5 font-[650]">Periodo</th><th class="px-4 py-2.5 text-right font-[650]">Valor</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          ${data.items.length === 0
            ? html`<tr><td colspan="6" class="px-4 py-8 text-center text-muted">Aún no hay pagos de planes.</td></tr>`
            : data.items.map(
                (payment) => html`<tr class="cursor-pointer hover:bg-ground" data-business="${payment.business.id}" tabindex="0">
                  <td class="px-4 py-3 whitespace-nowrap">${date(payment.createdAt)}</td>
                  <td class="px-3 py-3"><span class="font-[650]">${payment.business.name}</span></td>
                  <td class="px-3 py-3">${PLAN_NAME[payment.plan] ?? payment.plan} · ${period(payment.months)}</td>
                  <td class="px-3 py-3">${methodLabel(payment)}${payment.recordedBy ? html`<span class="block text-xs text-muted">Registró ${payment.recordedBy.name}</span>` : ""}</td>
                  <td class="px-3 py-3 text-sm text-muted">${date(payment.periodStart)} – ${date(payment.periodEnd)}</td>
                  <td class="num px-4 py-3 text-right font-[700]">${formatCOP(payment.amount)}</td>
                </tr>`,
              )}
        </tbody>
      </table>
    </div>
    ${pager(data, "data-payments-page")}`;
}

// ─── Mi cuenta ───

function accountView() {
  const { user } = state.me;
  return html`<section class="panel grid max-w-2xl gap-6 p-5 sm:p-6">
    <div class="grid gap-1">
      <p class="text-lg font-[740]">${user.name}</p>
      <p class="text-muted">${user.email} · administrador de Pedify</p>
    </div>
    <form class="grid gap-4 border-t border-line pt-5 sm:grid-cols-2" data-password-form novalidate>
      <h3 class="font-[720] sm:col-span-2">Cambiar contraseña</h3>
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
      <button type="submit" class="btn btn-ink justify-self-start sm:col-span-2">Cambiar contraseña</button>
    </form>
    <div class="contents" data-push-settings>${pushSettings()}</div>
    <div class="border-t border-line pt-5">
      <button type="button" class="btn btn-ghost" data-logout>${icon("log-out")} Cerrar sesión</button>
    </div>
  </section>`;
}

const ACCOUNTS_INTRO = html`<div class="grid gap-1">
  <h3 class="flex items-center gap-2 text-[1.0625rem] font-[740]">${icon("wallet")} Dónde te pagan los negocios</h3>
  <p class="max-w-[70ch] text-sm text-muted">
    Los negocios ven estas cuentas en «Mi plan» con el valor exacto de su plan, pagan desde su app y suben el comprobante. Pedify revisa que el
    pago sea a estas cuentas (por el número, la llave o el nombre del titular), así que escribe el titular tal como sale en los comprobantes.
  </p>
</div>`;

// ─── Avisos de pagos en este dispositivo y la app instalada ───

const pushCopy = () => PUSH_COPY[state.push] ?? PUSH_COPY.unsupported;
const cardDismissed = () => {
  try {
    return localStorage.getItem(PUSH_CARD_KEY) === "no";
  } catch {
    return false;
  }
};

/** Fila del menú lateral: «Avisos de pagos · Activar/Activo» y, si no está instalada, «Instalar la app». */
function pushBlock() {
  if (!state.push) return "";
  const on = state.push === "on";
  const muted = !["on", "off", "ios-install"].includes(state.push);
  return html`<div class="grid gap-0.5 rounded-[12px] bg-ink-2 py-1.5">
    <button type="button" class="live-row" data-admin-push aria-pressed="${on}" ${muted ? raw("data-muted") : ""} title="${pushCopy().hint}">
      <span class="live-row-icon">${icon(on ? "bell-ring" : "bell")}</span><span class="min-w-0 flex-1 truncate text-left">Avisos de pagos</span>
      <span class="live-state">${pushCopy().label}</span>
    </button>
    ${isInstalled()
      ? ""
      : html`<button type="button" class="live-row" data-install>
          <span class="live-row-icon">${icon("download")}</span><span class="min-w-0 flex-1 truncate text-left">Instalar la app</span>
        </button>`}
  </div>`;
}

/** Campana del encabezado en el celular. */
function pushBell() {
  const on = state.push === "on";
  return html`<button type="button" class="btn btn-quiet btn-icon relative ml-auto text-paper hover:bg-ink-3" data-admin-push
    aria-label="${on ? "Avisos de pagos activos: enviar uno de prueba" : `Avisos de pagos: ${pushCopy().label}`}" title="${pushCopy().hint}">
    ${icon(on ? "bell-ring" : "bell")}
    <span class="absolute top-2 right-2 h-2 w-2 rounded-full ${on ? "bg-leaf-glow" : state.push === "off" || state.push === "ios-install" ? "bg-mustard" : "bg-ink-soft"}" aria-hidden="true"></span>
  </button>`;
}

/** Tarjeta del Resumen que invita a activar los avisos (hasta que se activen o se diga «Ahora no»). */
function pushCard() {
  if (!["off", "ios-install"].includes(state.push) || cardDismissed()) return "";
  const ios = state.push === "ios-install";
  return html`<section class="on-ink flex flex-wrap items-center gap-4 rounded-[14px] bg-ink p-4 text-paper sm:p-5" aria-labelledby="push-card-title">
    <span class="grid h-11 w-11 flex-none place-items-center rounded-full bg-mustard text-ink" aria-hidden="true">${icon("bell-ring")}</span>
    <div class="grid min-w-0 flex-[1_1_18rem] gap-0.5">
      <h2 id="push-card-title" class="font-[740]">Que ningún pago se te pase</h2>
      <p class="text-sm text-ink-soft">
        ${ios
          ? "En iPhone, agrega Pedify Admin a tu pantalla de inicio y activa los avisos desde ahí: te llega uno cada vez que un negocio pague su plan."
          : "Activa los avisos y te llega uno a este dispositivo cada vez que un negocio pague su plan, aunque tengas el panel cerrado."}
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn btn-primary btn-sm" data-admin-push>${ios ? "Ver cómo" : "Activar avisos"}</button>
      <button type="button" class="btn btn-quiet btn-sm text-ink-soft hover:bg-ink-3 hover:text-paper" data-push-dismiss>Ahora no</button>
    </div>
  </section>`;
}

/** «Avisos y app en este dispositivo», en Mi cuenta. */
function pushSettings() {
  if (!state.push) return "";
  const on = state.push === "on";
  const installed = isInstalled();
  return html`<section class="grid gap-4 border-t border-line pt-5" aria-labelledby="device-title">
    <h3 id="device-title" class="font-[720]">En este dispositivo</h3>
    <div class="grid gap-3 rounded-[12px] bg-ground p-4">
      <p class="flex items-center gap-2 font-[680]">
        ${icon(on ? "bell-ring" : "bell", "h-[18px] w-[18px]")} Avisos de pagos
        <span class="badge ${on ? "bg-leaf-soft text-leaf" : "bg-paper text-muted"}">${on ? "Activos" : pushCopy().label}</span>
      </p>
      <p class="text-sm text-muted">${pushCopy().hint}</p>
      <div class="flex flex-wrap gap-2">
        ${on
          ? html`<button type="button" class="btn btn-ghost btn-sm" data-push-test>${icon("bell")} Enviar un aviso de prueba</button>
              <button type="button" class="btn btn-quiet btn-sm" data-push-off>Desactivar</button>`
          : ["off", "ios-install"].includes(state.push)
            ? html`<button type="button" class="btn btn-ink btn-sm" data-admin-push>${state.push === "off" ? "Activar avisos" : "Ver cómo"}</button>`
            : ""}
      </div>
    </div>
    <div class="grid gap-3 rounded-[12px] bg-ground p-4">
      <p class="flex items-center gap-2 font-[680]">${icon("smartphone", "h-[18px] w-[18px]")} Pedify Admin como app</p>
      <p class="text-sm text-muted">
        ${installed
          ? "Ya la abriste como app: queda en tu pantalla de inicio con su propio ícono."
          : "Instálala y queda en tu pantalla de inicio con su propio ícono, como cualquier app. Abre directo en este panel."}
      </p>
      ${installed ? "" : html`<button type="button" class="btn btn-ghost btn-sm justify-self-start" data-install>${icon("download")} ${installLabel()}</button>`}
    </div>
  </section>`;
}

function drawPush() {
  const slots = { "[data-push-block]": pushBlock, "[data-push-bell]": pushBell, "[data-push-card]": pushCard, "[data-push-settings]": pushSettings };
  for (const [selector, view] of Object.entries(slots)) {
    const slot = root.querySelector(selector);
    if (slot) render(slot, view());
  }
}

async function refreshPush() {
  try {
    state.push = await adminPush.state();
  } catch {
    state.push = "unsupported";
  }
  drawPush();
}

/** Toque en «Avisos de pagos»: activa, envía una prueba si ya están activos, o explica qué hacer. */
async function pushAction(button) {
  if (state.push === "ios-install") return openInstallHelp("ios");
  if (state.push === "on") return sendPushTest(button);
  if (state.push !== "off") return toast(pushCopy().hint, "info");
  setBusy(button, true);
  try {
    await adminPush.enable();
    toast("Listo: te avisaremos aquí cada vez que llegue un pago por revisar.");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    await refreshPush();
  }
}

async function sendPushTest(button) {
  setBusy(button, true);
  try {
    const result = await adminPush.test();
    toast(result.sent > 0 ? "Te enviamos un aviso de prueba." : "No pudimos entregar el aviso. Desactívalos y vuelve a activarlos.", result.sent > 0 ? "success" : "error");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

// ───────────────────────────── Estructura ─────────────────────────────

const pendingCount = (extra = "") => (state.metrics.pendingTransfers > 0 ? html`<span class="badge num bg-tomato text-paper ${extra}">${state.metrics.pendingTransfers}</span>` : "");

function navItems() {
  return SECTIONS.map(
    (section) => html`<button type="button" class="nav-item w-full text-left" data-tab="${section.id}" ${state.tab === section.id ? raw('aria-current="page"') : ""}>
      ${icon(section.icon)}<span class="flex-1">${section.label}</span>${section.id === "pagos" ? pendingCount() : ""}
    </button>`,
  );
}

/** Barra inferior del celular: cuatro secciones y «Más» (abre el menú con todas). */
function tabBar() {
  const tabs = TABBAR.map((id) => SECTIONS.find((section) => section.id === id)).map(
    (section) => html`<button type="button" class="tab-item" data-tab="${section.id}" ${state.tab === section.id ? raw('aria-current="page"') : ""}>
      <span class="tab-pill relative">${icon(section.icon)}${section.id === "pagos" ? pendingCount("absolute -top-1.5 -right-1 min-w-5 justify-center px-1.5 py-0") : ""}</span>${section.short ?? section.label}
    </button>`,
  );
  return html`${tabs}
    <button type="button" class="tab-item" data-open-drawer ${TABBAR.includes(state.tab) ? "" : raw('aria-current="page"')}>
      <span class="tab-pill">${icon("menu")}</span>Más
    </button>`;
}

/** «Sistema en línea» con la versión y la base de datos (abajo del menú lateral). */
function systemBlock() {
  const { system } = state.metrics;
  const uptime = system.uptimeSeconds >= 3600 ? `${Math.floor(system.uptimeSeconds / 3600)} h` : `${Math.floor(system.uptimeSeconds / 60)} min`;
  return html`<div class="grid gap-1 rounded-[12px] bg-ink-2 px-3 py-2.5 text-xs text-ink-soft">
    <p class="flex items-center gap-2 font-[620] text-paper"><span class="h-2 w-2 rounded-full bg-leaf-glow" aria-hidden="true"></span> Sistema en línea hace ${uptime}</p>
    <p>Versión ${system.version} · base de datos ${system.dbLatencyMs} ms · ${system.memoryMb} MB</p>
  </div>`;
}

function userBlock() {
  const { user } = state.me;
  return html`<div class="flex items-center gap-3 rounded-[12px] bg-ink-2 p-2.5 pl-3">
    <span class="grid h-9 w-9 flex-none place-items-center rounded-full bg-ink-3 text-sm font-bold" aria-hidden="true">${initials(user.name)}</span>
    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm font-semibold">${user.name}</span>
      <span class="block truncate text-xs text-ink-soft">${user.email}</span>
    </span>
    <button type="button" class="btn btn-quiet btn-icon text-ink-soft hover:bg-ink-3 hover:text-paper" data-logout aria-label="Cerrar sesión" title="Cerrar sesión">
      ${icon("log-out")}
    </button>
  </div>`;
}

function sectionHead() {
  const firstName = state.me.user.name.trim().split(/\s+/)[0];
  const today = new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bogota" }).format(new Date());
  const heads = {
    resumen: [`Hola, ${firstName}`, `Así va Pedify este ${today}.`],
    analiticas: ["Analíticas", "Cómo crecen Pedify y las tiendas. Arrastra las gráficas para girarlas y toca una columna para ver su valor."],
    negocios: ["Negocios", "Todos los negocios registrados, con su plan, su estado y sus pedidos."],
    pagos: [
      "Pagos por revisar",
      "Los negocios pagan su plan a tu Nequi o a tu llave Bre-B y suben el comprobante. Pedify lo lee, te avisa por correo y, cuando apruebas, su plan se activa al instante.",
    ],
    ingresos: ["Ingresos", "Lo que has recibido por los planes, mes a mes y pago por pago."],
    cuentas: ["Cuentas de cobro", "Las cuentas donde los negocios te pagan su plan."],
    cuenta: ["Mi cuenta", "Tu contraseña y tu sesión."],
  };
  const [title, subtitle] = heads[state.tab];
  return html`<div class="grid gap-1">
    <h1 class="text-[1.875rem] leading-tight font-[780] [font-stretch:88%] sm:text-[2.25rem]">${title}</h1>
    <p class="max-w-[70ch] text-muted">${subtitle}</p>
  </div>`;
}

function sectionView() {
  switch (state.tab) {
    case "analiticas":
      return analyticsView();
    case "negocios":
      return html`<div class="grid gap-4" data-list>${listView()}</div>`;
    case "pagos":
      return transfersView();
    case "ingresos":
      return revenueView();
    case "cuentas":
      return html`<section class="panel p-4 sm:p-5" data-platform-accounts></section>`;
    case "cuenta":
      return accountView();
    default:
      return resumenView();
  }
}

function page() {
  return html`<div class="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside class="on-ink scroll-thin sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto bg-ink p-4 text-paper lg:flex">
        <div class="flex items-center gap-2.5 px-2 pt-2">${brand({ onInk: true })} <span class="badge bg-mustard text-ink">Administración</span></div>
        <nav aria-label="Secciones del panel" class="grid gap-1" data-nav>${navItems()}</nav>
        <div class="mt-auto grid grid-cols-[minmax(0,1fr)] gap-3">
          ${state.me.businesses.length > 0 ? html`<a class="nav-item" href="/panel">${icon("store")}<span class="flex-1">Ir a mi negocio</span>${icon("arrow-right", "h-4 w-4")}</a>` : ""}
          <div class="contents" data-push-block>${pushBlock()}</div>
          ${systemBlock()} ${userBlock()}
        </div>
      </aside>

      <div class="flex min-w-0 flex-col">
        <header class="on-ink sticky top-0 z-30 bg-ink text-paper lg:hidden">
          <div class="flex items-center gap-2.5 px-4 pt-3 pb-2">
            ${brand({ onInk: true })} <span class="badge bg-mustard text-ink">Administración</span>
            <span class="contents" data-push-bell>${pushBell()}</span>
            <button type="button" class="btn btn-quiet btn-icon text-ink-soft hover:bg-ink-3 hover:text-paper" data-logout aria-label="Cerrar sesión" title="Cerrar sesión">
              ${icon("log-out")}
            </button>
          </div>
        </header>
        <main
          id="main"
          tabindex="-1"
          class="mx-auto grid w-full max-w-[84rem] grid-cols-[minmax(0,1fr)] content-start gap-6 px-4 pt-6 pb-[calc(6.5rem+env(safe-area-inset-bottom))] outline-none sm:px-6 lg:px-10 lg:pt-10 lg:pb-14"
        >
          <div data-section-head>${sectionHead()}</div>
          <div class="grid grid-cols-[minmax(0,1fr)] gap-6" data-tab-panel>${sectionView()}</div>
        </main>
      </div>

      <nav aria-label="Secciones principales" class="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] lg:hidden" data-tabbar>
        ${tabBar()}
      </nav>

      <dialog id="drawer" class="on-ink drawer m-0 ml-auto h-dvh max-h-none w-[min(20rem,88vw)] bg-ink p-4 text-paper" aria-label="Menú del panel">
        <div class="flex h-full flex-col gap-6">
          <div class="flex items-center justify-between">
            ${brand({ onInk: true })}
            <button type="button" class="btn btn-quiet btn-icon text-paper hover:bg-ink-3" data-close-drawer aria-label="Cerrar menú">${icon("x")}</button>
          </div>
          <nav aria-label="Secciones del panel" class="grid gap-1" data-nav>${navItems()}</nav>
          <div class="mt-auto grid grid-cols-[minmax(0,1fr)] gap-3">
            ${state.me.businesses.length > 0 ? html`<a class="nav-item" href="/panel">${icon("store")}<span class="flex-1">Ir a mi negocio</span>${icon("arrow-right", "h-4 w-4")}</a>` : ""}
            ${userBlock()}
          </div>
        </div>
      </dialog>
    </div>
    <dialog id="business-detail" class="sheet" aria-labelledby="detail-title"></dialog>`;
}

// ───────────────────────────── Datos y acciones ─────────────────────────────

async function loadList() {
  const params = new URLSearchParams({ page: String(state.page), pageSize: "25" });
  if (state.filter) params.set("status", state.filter);
  if (state.search) params.set("search", state.search);
  state.list = await api(`/admin/businesses?${params}`);
}

async function loadTransfers() {
  const params = new URLSearchParams({ status: state.transfers.status, page: String(state.transfers.page), pageSize: "20" });
  [state.transfers.data, state.accounts] = await Promise.all([api(`/admin/transfers?${params}`), api("/admin/payment-accounts")]);
}

async function loadPayments() {
  state.payments.data = await api(`/admin/payments?page=${state.payments.page}&pageSize=25`);
}

async function loadAnalytics() {
  state.analytics = await api("/admin/analytics");
}

/** Datos de la sección abierta (las métricas se cargan siempre). */
async function loadTab() {
  const tab = state.tab;
  if (tab === "resumen") {
    await Promise.all([loadAnalytics(), api("/admin/businesses?status=EXPIRING&page=1&pageSize=5").then((list) => (state.expiring = list))]);
  }
  if (tab === "analiticas") await loadAnalytics();
  if (tab === "negocios") await loadList();
  if (tab === "pagos") await loadTransfers();
  if (tab === "ingresos") await Promise.all([loadPayments(), loadAnalytics()]);
}

/** Redibuja el menú (con el contador de pagos) y la sección abierta. */
function drawTab() {
  drawNav();
  render(root.querySelector("[data-section-head]"), sectionHead());
  const panel = root.querySelector("[data-tab-panel]");
  render(panel, sectionView());
  mountCharts(panel);
  if (state.tab === "cuentas") {
    void mountPaymentAccounts(panel.querySelector("[data-platform-accounts]"), {
      base: "/admin/payment-accounts",
      kinds: ["NEQUI", "BRE_B"],
      intro: ACCOUNTS_INTRO,
      qrSaved: "Listo: leímos tu QR. Los negocios lo verán al pagar su plan.",
    });
  }
  followChecks();
}

function drawNav() {
  for (const nav of root.querySelectorAll("[data-nav]")) render(nav, html`${navItems()}`);
  render(root.querySelector("[data-tabbar]"), tabBar());
}

/** ¿Estás escribiendo en la sección abierta? (Entonces no se redibuja sola.) */
const isTyping = () => Boolean(root.querySelector("[data-tab-panel]")?.contains(document.activeElement) && document.activeElement.matches("input, textarea, select"));

let checksTimer;
/** Mientras Pedify lee un comprobante, la lista se actualiza sola hasta mostrar el resultado. */
function followChecks() {
  clearTimeout(checksTimer);
  if (state.tab !== "pagos" || !state.transfers.data?.items.some((transfer) => transfer.checkStatus === "PENDING")) return;
  checksTimer = setTimeout(async () => {
    if (isTyping()) return followChecks();
    try {
      await loadTransfers();
      drawTab();
    } catch {
      followChecks();
    }
  }, 3000);
}

async function openTab(tab) {
  state.tab = tab;
  history.replaceState(null, "", `#${tab}`);
  const drawer = document.getElementById("drawer");
  if (drawer?.open) drawer.close();
  try {
    await loadTab();
    drawTab();
    if (window.scrollY > 0) window.scrollTo({ top: 0 });
  } catch (error) {
    toast(error.message, "error");
  }
}

async function refresh() {
  [state.metrics] = await Promise.all([api("/admin/metrics"), loadTab()]);
  render(root, page());
  drawTab();
}

async function openDetail(id) {
  const dialog = document.getElementById("business-detail");
  try {
    state.detail = await api(`/admin/businesses/${id}`);
    render(dialog, detailView(state.detail));
    if (!dialog.open) dialog.showModal();
    dialog.querySelector("#detail-title")?.focus();
  } catch (error) {
    toast(error.message, "error");
  }
}

/** Después de un cambio: métricas y la sección abierta al día. */
async function reloadAll() {
  [state.metrics] = await Promise.all([api("/admin/metrics"), loadTab()]);
  drawTab();
}

async function afterChange(updated, message) {
  state.detail = updated;
  const dialog = document.getElementById("business-detail");
  render(dialog, detailView(updated));
  toast(message);
  await reloadAll();
}

async function approve(button) {
  if (button.dataset.armed !== "true") {
    button.dataset.armed = "true";
    button.lastChild.textContent = " Sí, me llegó el dinero: aprobar";
    return;
  }
  setBusy(button, true);
  try {
    const transfer = await api(`/admin/transfers/${button.dataset.approve}/approve`, { method: "POST" });
    toast(`Pago aprobado: el plan ${transfer.planName} quedó activo.`);
    await reloadAll();
  } catch (error) {
    setBusy(button, false);
    toast(error.message, "error");
    await reloadAll().catch(() => {});
  }
}

async function reject(form) {
  const button = form.querySelector('[type="submit"]');
  clearFieldErrors(form);
  setBusy(button, true);
  try {
    await api(`/admin/transfers/${form.dataset.rejectForm}/reject`, { method: "POST", body: { reason: readForm(form).reason ?? "" } });
    toast("Pago rechazado. El negocio ve el motivo en «Mi plan».");
    await reloadAll();
  } catch (error) {
    setBusy(button, false);
    showErrors(form, error);
  }
}

/** Mientras el panel está abierto, revisa si llegaron pagos nuevos (sin borrar lo que estés escribiendo). */
function watchTransfers() {
  const check = async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const metrics = await api("/admin/metrics");
      const changed = metrics.pendingTransfers !== state.metrics.pendingTransfers;
      state.metrics = metrics;
      if (!changed) return;
      if (isTyping() || document.getElementById("business-detail").open || !["resumen", "pagos"].includes(state.tab)) {
        drawNav();
        return;
      }
      await loadTab();
      drawTab();
    } catch {
      // Sin conexión: se intenta de nuevo en la próxima vuelta.
    }
  };
  setInterval(check, POLL_MS);
  document.addEventListener("visibilitychange", check);
}

function bind() {
  root.addEventListener("click", async (event) => {
    // Tocar fuera del menú del celular lo cierra.
    if (event.target.id === "drawer") return event.target.close();
    const row = event.target.closest("[data-business]");
    if (row) return openDetail(row.dataset.business);
    const target = event.target.closest("button");
    if (!target) return;
    if (target.matches("[data-tab]")) return openTab(target.dataset.tab);
    if (target.matches("[data-open-drawer]")) return document.getElementById("drawer").showModal();
    if (target.matches("[data-close-drawer]")) return document.getElementById("drawer").close();
    if (target.matches("[data-goto-filter]")) {
      state.filter = target.dataset.gotoFilter;
      state.page = 1;
      return openTab("negocios");
    }
    if (target.matches("[data-filter]")) {
      state.filter = target.dataset.filter;
      state.page = 1;
      await loadList();
      render(root.querySelector("[data-list]"), listView());
    }
    if (target.matches("[data-page]")) {
      state.page = Number(target.dataset.page);
      await loadList();
      render(root.querySelector("[data-list]"), listView());
    }
    if (target.matches("[data-transfer-filter]")) {
      state.transfers = { ...state.transfers, status: target.dataset.transferFilter, page: 1 };
      await loadTransfers();
      drawTab();
    }
    if (target.matches("[data-transfer-page]")) {
      state.transfers.page = Number(target.dataset.transferPage);
      await loadTransfers();
      drawTab();
    }
    if (target.matches("[data-payments-page]")) {
      state.payments.page = Number(target.dataset.paymentsPage);
      await loadPayments();
      drawTab();
    }
    if (target.matches("[data-approve]")) return approve(target);
    if (target.matches("[data-reject-open]")) {
      const form = root.querySelector(`[data-reject-form="${target.dataset.rejectOpen}"]`);
      form.classList.replace("hidden", "grid");
      form.querySelector('[name="reason"]').focus();
    }
    if (target.matches("[data-reason]")) {
      const input = target.closest("form").elements.reason;
      input.value = target.dataset.reason;
      input.focus();
    }
    if (target.matches("[data-admin-push]")) return pushAction(target);
    if (target.matches("[data-push-test]")) return sendPushTest(target);
    if (target.matches("[data-push-off]")) {
      setBusy(target, true);
      await adminPush.disable().catch(() => {});
      toast("Listo: este dispositivo ya no recibe los avisos de pagos.");
      return refreshPush();
    }
    if (target.matches("[data-push-dismiss]")) {
      try {
        localStorage.setItem(PUSH_CARD_KEY, "no");
      } catch {
        // Sin almacenamiento: vuelve a aparecer la próxima vez.
      }
      return drawPush();
    }
    if (target.matches("[data-install]")) {
      if (installState() === "ios") return openInstallHelp("ios");
      await installApp();
      return drawPush();
    }
    if (target.matches("[data-logout]")) {
      setBusy(target, true);
      // Este dispositivo deja de recibir los avisos de pagos de la cuenta (sin esperar más de 2 s).
      await Promise.race([adminPush.disable().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 2000))]);
      await api("/auth/logout", { method: "POST" }).catch(() => {});
      location.assign("/login");
    }
  });
  root.addEventListener("keydown", (event) => {
    const row = event.target.closest?.("[data-business]");
    if (row && row.tagName !== "BUTTON" && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openDetail(row.dataset.business);
    }
  });
  let timer;
  root.addEventListener("input", (event) => {
    if (!event.target.matches("[data-search]")) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      state.search = event.target.value.trim();
      state.page = 1;
      await loadList();
      const position = event.target.selectionStart;
      render(root.querySelector("[data-list]"), listView());
      const input = root.querySelector("[data-search]");
      input.focus();
      input.setSelectionRange(position, position);
    }, 300);
  });

  root.addEventListener("submit", async (event) => {
    const rejectForm = event.target.closest("[data-reject-form]");
    if (rejectForm) {
      event.preventDefault();
      return reject(rejectForm);
    }
    const passwordForm = event.target.closest("[data-password-form]");
    if (passwordForm) {
      event.preventDefault();
      const button = passwordForm.querySelector('[type="submit"]');
      clearFieldErrors(passwordForm);
      setBusy(button, true);
      try {
        await api("/auth/password", { method: "PATCH", body: readForm(passwordForm) });
        passwordForm.reset();
        toast("Contraseña cambiada. Cerramos tus otras sesiones.");
      } catch (error) {
        showErrors(passwordForm, error);
      } finally {
        setBusy(button, false);
      }
      return;
    }
    const form = event.target.closest("[data-payment-form]");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    setBusy(button, true);
    const amount = form.elements.amount.value.replace(/\D/g, "");
    try {
      const updated = await api(`/admin/businesses/${state.detail.id}/payments`, {
        method: "POST",
        body: {
          plan: form.elements.plan.value,
          months: Number(form.elements.months.value),
          method: form.elements.method.value,
          ...(amount ? { amount: Number(amount) } : {}),
          ...(form.elements.reference.value.trim() ? { reference: form.elements.reference.value.trim() } : {}),
        },
      });
      await afterChange(updated, `Pago registrado. Pagado hasta el ${date(updated.subscription.paidUntil)}.`);
    } catch (error) {
      setBusy(button, false);
      showErrors(form, error);
    }
  });

  root.addEventListener("click", async (event) => {
    const dialog = document.getElementById("business-detail");
    if (event.target === dialog || event.target.closest("[data-close]")) return dialog.close();
    const target = event.target.closest("button");
    if (!target || !dialog.contains(target)) return;
    if (target.matches("[data-set-status]")) {
      if (target.dataset.confirm && target.dataset.armed !== "true") {
        target.dataset.armed = "true";
        target.textContent = "Confirmar suspensión";
        toast(target.dataset.confirm, "info");
        return;
      }
      setBusy(target, true);
      try {
        const updated = await api(`/admin/businesses/${state.detail.id}`, { method: "PATCH", body: { status: target.dataset.setStatus } });
        await afterChange(updated, target.dataset.setStatus === "SUSPENDED" ? "Negocio suspendido." : "Negocio reactivado.");
      } catch (error) {
        setBusy(target, false);
        toast(error.message, "error");
      }
    }
    if (target.matches("[data-extend-trial]")) {
      setBusy(target, true);
      try {
        const days = Number(dialog.querySelector("#trial-days").value);
        const updated = await api(`/admin/businesses/${state.detail.id}`, { method: "PATCH", body: { extendTrialDays: days } });
        await afterChange(updated, `Prueba ampliada hasta el ${date(updated.subscription.trialEndsAt)}.`);
      } catch (error) {
        setBusy(target, false);
        toast(error.message, "error");
      }
    }
  });
}

try {
  state.me = await api("/auth/me");
  if (!state.me.user.isPlatformAdmin) {
    render(
      root,
      html`<div class="grid min-h-dvh place-items-center p-6 text-center">
        <div class="grid max-w-sm justify-items-center gap-4">
          <span class="grid h-12 w-12 place-items-center rounded-full bg-ground">${icon("lock")}</span>
          <h1 class="text-xl font-[750]">Esta sección es del equipo de Pedify</h1>
          <a class="btn btn-ink" href="/panel">Ir a mi panel</a>
        </div>
      </div>`,
    );
  } else {
    await refresh();
    bind();
    watchTransfers();
    void refreshPush();
    window.addEventListener("pedify:install", drawPush);
    // Al tocar un aviso con el panel abierto, el navegador cambia la dirección a #pagos.
    window.addEventListener("hashchange", () => {
      const tab = sectionFromHash();
      if (tab !== state.tab) void openTab(tab);
    });
  }
} catch (error) {
  if (error.status === 401) redirectToLogin();
  else render(root, html`<p class="p-6 text-tomato">${error.message}</p>`);
}
