// Panel central de Pedify (sección 16 del documento): negocios registrados, planes,
// suscripciones y métricas globales; los pagos de los planes por Nequi o Bre-B que esperan
// revisión, los ingresos y las cuentas de Pedify que los reciben. Solo para administradores.
import { api, formatCOP, formatPhone, redirectToLogin } from "./api.js";
import { mountPaymentAccounts } from "./payment-accounts-ui.js";
import { brand, clearFieldErrors, formAlert, html, icon, readForm, render, setBusy, showErrors, toast } from "./ui.js";

const STATUS = {
  TRIAL: { label: "Prueba", badge: "bg-mustard-soft text-mustard-deep" },
  ACTIVE: { label: "Activo", badge: "bg-leaf-soft text-leaf" },
  PAST_DUE: { label: "En gracia", badge: "bg-mustard text-ink" },
  EXPIRED: { label: "Vencido", badge: "bg-tomato-soft text-tomato" },
  SUSPENDED: { label: "Suspendido", badge: "bg-ink text-paper" },
};
const FILTERS = [["", "Todos"], ["EXPIRING", "Por vencer"], ["TRIAL", "Prueba"], ["ACTIVE", "Activos"], ["PAST_DUE", "En gracia"], ["EXPIRED", "Vencidos"], ["SUSPENDED", "Suspendidos"]];
const METHODS = [["NEQUI", "Nequi"], ["BRE_B", "Llave Bre-B"], ["DAVIPLATA", "Daviplata"], ["TRANSFERENCIA", "Transferencia"], ["EFECTIVO", "Efectivo"], ["OTRO", "Otro"]];
const METHOD_LABEL = Object.fromEntries(METHODS);
const PLAN_NAME = { EMPRENDEDOR: "Emprendedor", NEGOCIO: "Negocio", EMPRESA: "Empresa" };
/** Último recordatorio de vencimiento enviado al propietario (correo y aviso al celular). */
const REMINDER_LABEL = { DAYS_5: "5 días antes", DAY_1: "1 día antes", EXPIRED: "al vencer" };
const TABS = [
  ["resumen", "Resumen"],
  ["pagos", "Pagos por revisar"],
  ["ingresos", "Ingresos"],
  ["cuentas", "Cuentas de cobro"],
  ["cuenta", "Mi cuenta"],
];
const TRANSFER_FILTERS = [["PENDING", "Por revisar"], ["APPROVED", "Aprobados"], ["REJECTED", "Rechazados"]];
const REJECT_REASONS = ["No llegó el dinero a la cuenta.", "El valor no coincide con el plan.", "No se ve bien el comprobante."];
/** Cada cuánto se revisa si llegaron pagos nuevos mientras el panel está abierto. */
const POLL_MS = 30_000;

const date = (value) => (value ? new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Bogota" }).format(new Date(value)).replace(".", "") : "—");
const dateTime = (value) =>
  new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" }).format(new Date(value)).replace(".", "");
const period = (months) => (months === 12 ? "1 año" : months === 1 ? "1 mes" : `${months} meses`);
const methodLabel = (payment) => (payment.method === "WOMPI" ? `Wompi (${payment.note ?? "en línea"})` : (METHOD_LABEL[payment.method] ?? payment.method));
const tabFromHash = () => (TABS.some(([id]) => id === location.hash.slice(1)) ? location.hash.slice(1) : "resumen");

const state = {
  me: null,
  metrics: null,
  list: null,
  filter: "",
  search: "",
  page: 1,
  detail: null,
  tab: tabFromHash(),
  transfers: { status: "PENDING", page: 1, data: null },
  payments: { page: 1, data: null },
  /** Cuentas de Pedify para recibir los pagos (sin ellas, los negocios no ven el pago directo). */
  accounts: [],
};
const root = document.getElementById("app");

// ───────────────────────────── Plantillas ─────────────────────────────

function tile(label, value, hint) {
  return html`<div class="panel flex min-w-0 flex-col gap-1.5 p-4">
    <dt class="text-sm font-[620] text-muted">${label}</dt>
    <dd class="truncate text-[1.75rem] leading-none font-[800] [font-stretch:80%]">${value}</dd>
    ${hint ? html`<p class="text-sm text-muted">${hint}</p>` : ""}
  </div>`;
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

function metricsView(metrics) {
  const { businesses, orders, mrr, revenue, system } = metrics;
  const uptime = system.uptimeSeconds >= 3600 ? `${Math.floor(system.uptimeSeconds / 3600)} h` : `${Math.floor(system.uptimeSeconds / 60)} min`;
  return html`${pendingBanner(metrics)}
    <dl class="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))]">
      ${tile("Negocios", String(businesses.total), `+${businesses.new7} en 7 días · +${businesses.new30} en 30 días`)}
      ${tile("Pagando", String(businesses.active), `${businesses.trial} en prueba`)}
      ${tile("Por vencer (7 días)", String(businesses.expiring), `${businesses.pastDue} en gracia · ${businesses.expired} vencidos`)}
      ${tile("Recibido este mes", formatCOP(revenue.month), `${formatCOP(mrr)} al mes con los planes activos`)}
      ${tile("Pedidos (24 h)", String(orders.orders1), `${orders.orders30} en 30 días`)}
      ${tile("Ventas de las tiendas (30 días)", formatCOP(orders.gmv30), "Pedidos aceptados")}
      ${tile("Tiendas con pedidos", String(orders.storesWithOrders7), "En los últimos 7 días")}
      ${tile("Dueños registrados", String(revenue.owners), businesses.suspended ? `${businesses.suspended} negocios suspendidos` : "Personas con su propio negocio")}
    </dl>
    <p class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
      <span class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-leaf"></span> Sistema en línea hace ${uptime}</span>
      <span>Versión ${system.version} · Node ${system.nodeVersion}</span>
      <span>Memoria ${system.memoryMb} MB</span>
      <span>Base de datos ${system.dbLatencyMs} ms</span>
      ${system.environment === "staging" ? html`<span class="badge bg-ink text-mustard">Entorno de pruebas</span>` : ""}
    </p>
    ${system.warnings?.length
      ? html`<div class="rounded-[12px] border border-mustard-press bg-mustard-soft px-4 py-3 text-mustard-deep" role="status">
          <p class="flex items-center gap-2 font-[720]">${icon("circle-alert", "h-4 w-4")} Pendiente de configurar en el servidor</p>
          <ul class="mt-1.5 grid list-disc gap-1 pl-6 text-sm">${system.warnings.map((warning) => html`<li>${warning}</li>`)}</ul>
          <p class="mt-2 text-sm">Guía: docs/deployment.md</p>
        </div>`
      : ""}`;
}

function statusBadge(status) {
  const info = STATUS[status] ?? { label: status, badge: "bg-ground text-muted" };
  return html`<span class="badge ${info.badge}">${info.label}</span>`;
}

function businessRow(business) {
  return html`<tr class="cursor-pointer hover:bg-ground" data-business="${business.id}" tabindex="0">
    <td class="px-4 py-3">
      <span class="block font-[680]">${business.name}</span>
      <span class="block text-sm text-muted">/tienda/${business.slug}${business.city ? ` · ${business.city}` : ""}</span>
    </td>
    <td class="px-3 py-3">
      <span class="block">${business.ownerName ?? "—"}</span>
      <span class="block text-sm text-muted">${business.ownerEmail ?? ""}</span>
    </td>
    <td class="px-3 py-3">${PLAN_NAME[business.plan] ?? business.plan}</td>
    <td class="px-3 py-3">
      ${statusBadge(business.subscriptionStatus)}
      <span class="mt-1 block text-xs text-muted">${business.paidUntil && new Date(business.paidUntil) > new Date(business.trialEndsAt) ? `Pagado: ${date(business.paidUntil)}` : `Prueba: ${date(business.trialEndsAt)}`}</span>
      ${business.paymentInReview
        ? html`<span class="mt-0.5 block text-xs font-[680] text-mustard-deep">Pago en revisión</span>`
        : business.lastReminder
          ? html`<span class="mt-0.5 block text-xs text-muted">Avisado ${REMINDER_LABEL[business.lastReminder]}</span>`
          : ""}
    </td>
    <td class="num px-3 py-3 text-right">${business.products}</td>
    <td class="num px-3 py-3 text-right">${business.orders30}</td>
    <td class="px-4 py-3 text-sm text-muted">${date(business.createdAt)}</td>
  </tr>`;
}

function listView() {
  const list = state.list;
  return html`<div class="flex flex-wrap items-center gap-2">
      ${FILTERS.map(([value, label]) => html`<button type="button" class="cat-chip" aria-pressed="${state.filter === value}" aria-current="${state.filter === value}" data-filter="${value}">${label}</button>`)}
      <div class="input-group ml-auto w-full max-w-xs">
        <label class="addon border-0 bg-transparent pr-0" for="admin-search">${icon("search")}<span class="sr-only">Buscar negocio</span></label>
        <input class="input" id="admin-search" type="search" placeholder="Negocio, enlace o correo" value="${state.search}" data-search autocomplete="off" />
      </div>
    </div>
    <div class="panel overflow-x-auto">
      <table class="w-full min-w-[56rem] text-left text-[0.9375rem]">
        <thead class="bg-ground text-sm text-muted">
          <tr>
            <th class="px-4 py-2.5 font-[650]">Negocio</th><th class="px-3 py-2.5 font-[650]">Propietario</th><th class="px-3 py-2.5 font-[650]">Plan</th>
            <th class="px-3 py-2.5 font-[650]">Estado</th><th class="px-3 py-2.5 text-right font-[650]">Productos</th><th class="px-3 py-2.5 text-right font-[650]">Pedidos 30 d</th><th class="px-4 py-2.5 font-[650]">Registro</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          ${list.items.length === 0 ? html`<tr><td colspan="7" class="px-4 py-8 text-center text-muted">No hay negocios con ese filtro.</td></tr>` : list.items.map(businessRow)}
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
    <p class="max-w-[70ch] text-[0.9375rem] text-muted">
      Los negocios pagan su plan a tu Nequi o a tu llave Bre-B desde «Mi plan» y suben el comprobante. Pedify lo lee y lo revisa, te avisa por
      correo y el negocio queda esperando: cuando apruebas, su plan se activa al instante.
    </p>
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
  return html`<div class="grid gap-4">
    <dl class="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))]">
      ${tile("Este mes", formatCOP(revenue.month))}
      ${tile("Últimos 30 días", formatCOP(revenue.days30))}
      ${tile("Total recibido", formatCOP(revenue.total), `${revenue.payments} ${revenue.payments === 1 ? "pago" : "pagos"}`)}
      ${tile("Al mes con los planes activos", formatCOP(mrr), "Precio de lista")}
    </dl>
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
    ${pager(data, "data-payments-page")}
  </div>`;
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

function tabBar() {
  const pending = state.metrics.pendingTransfers;
  return html`<nav class="-mx-4 flex gap-1 overflow-x-auto px-4 shadow-[inset_0_-1px_0_var(--color-line)] sm:mx-0 sm:px-0" role="tablist" aria-label="Secciones del panel">
    ${TABS.map(
      ([id, label]) => html`<button
        type="button"
        role="tab"
        id="tab-${id}"
        aria-selected="${state.tab === id}"
        aria-controls="tab-panel"
        class="flex flex-none items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-[0.9375rem] font-[680] whitespace-nowrap text-muted hover:text-ink aria-selected:border-ink aria-selected:text-ink"
        data-tab="${id}"
      >
        ${label}${id === "pagos" && pending > 0 ? html`<span class="badge bg-tomato text-paper num">${pending}</span>` : ""}
      </button>`,
    )}
  </nav>`;
}

function tabView() {
  switch (state.tab) {
    case "pagos":
      return transfersView();
    case "ingresos":
      return revenueView();
    case "cuentas":
      return html`<section class="panel p-4 sm:p-5" data-platform-accounts></section>`;
    case "cuenta":
      return accountView();
    default:
      return html`<section class="grid gap-3" aria-label="Métricas" data-metrics>${metricsView(state.metrics)}</section>
        <section class="grid gap-4" aria-labelledby="businesses-title">
          <h2 id="businesses-title" class="text-xl font-[760]">Negocios <span class="num text-muted">(${state.list.total})</span></h2>
          <div class="grid gap-4" data-list>${listView()}</div>
        </section>`;
  }
}

function page() {
  return html`<header class="on-ink bg-ink text-paper">
      <div class="mx-auto flex max-w-[84rem] items-center gap-4 px-4 py-3 sm:px-6">
        ${brand({ onInk: true })}
        <span class="badge bg-mustard text-ink">Administración</span>
        ${state.me.businesses.length > 0 ? html`<a href="/panel" class="ml-auto text-sm font-[620] text-ink-soft hover:text-paper">Ir a mi panel</a>` : ""}
      </div>
    </header>
    <main class="mx-auto grid max-w-[84rem] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-8 sm:px-6">
      <div>
        <h1 class="text-[2rem] leading-tight font-[780]">Panel de Pedify</h1>
        <p class="mt-1 text-muted">Negocios, pagos de los planes, ingresos y métricas de toda la plataforma.</p>
      </div>
      <div data-tabs>${tabBar()}</div>
      <div class="grid grid-cols-[minmax(0,1fr)] gap-6" id="tab-panel" role="tabpanel" aria-labelledby="tab-${state.tab}" data-tab-panel>${tabView()}</div>
    </main>
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

/** Datos de la pestaña abierta (el resumen y las métricas se cargan siempre). */
async function loadTab() {
  if (state.tab === "pagos") await loadTransfers();
  if (state.tab === "ingresos") await loadPayments();
}

/** Redibuja las pestañas y la sección abierta. */
function drawTab() {
  render(root.querySelector("[data-tabs]"), tabBar());
  const panel = root.querySelector("[data-tab-panel]");
  panel.setAttribute("aria-labelledby", `tab-${state.tab}`);
  render(panel, tabView());
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
  try {
    await loadTab();
    drawTab();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function refresh() {
  [state.metrics] = await Promise.all([api("/admin/metrics"), loadList(), loadTab()]);
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

/** Después de un cambio: métricas, la lista y la pestaña abierta al día. */
async function reloadAll() {
  [state.metrics] = await Promise.all([api("/admin/metrics"), loadList(), loadTab()]);
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
      if (isTyping() || document.getElementById("business-detail").open) {
        render(root.querySelector("[data-tabs]"), tabBar());
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
    const row = event.target.closest("[data-business]");
    if (row) return openDetail(row.dataset.business);
    const target = event.target.closest("button");
    if (!target) return;
    if (target.matches("[data-tab]")) return openTab(target.dataset.tab);
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
    if (target.matches("[data-logout]")) {
      setBusy(target, true);
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
  }
} catch (error) {
  if (error.status === 401) redirectToLogin();
  else render(root, html`<p class="p-6 text-tomato">${error.message}</p>`);
}
