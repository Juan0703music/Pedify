// Panel central de Pedify (sección 16 del documento): negocios registrados, planes,
// suscripciones y métricas globales. Solo para administradores de la plataforma.
import { api, formatCOP, formatPhone, redirectToLogin } from "./api.js";
import { brand, formAlert, html, icon, render, setBusy, showErrors, toast } from "./ui.js";

const STATUS = {
  TRIAL: { label: "Prueba", badge: "bg-mustard-soft text-mustard-deep" },
  ACTIVE: { label: "Activo", badge: "bg-leaf-soft text-leaf" },
  PAST_DUE: { label: "En gracia", badge: "bg-mustard text-ink" },
  EXPIRED: { label: "Vencido", badge: "bg-tomato-soft text-tomato" },
  SUSPENDED: { label: "Suspendido", badge: "bg-ink text-paper" },
};
const FILTERS = [["", "Todos"], ["TRIAL", "Prueba"], ["ACTIVE", "Activos"], ["PAST_DUE", "En gracia"], ["EXPIRED", "Vencidos"], ["SUSPENDED", "Suspendidos"]];
const METHODS = [["NEQUI", "Nequi"], ["DAVIPLATA", "Daviplata"], ["TRANSFERENCIA", "Transferencia"], ["EFECTIVO", "Efectivo"], ["OTRO", "Otro"]];
const PLAN_NAME = { EMPRENDEDOR: "Emprendedor", NEGOCIO: "Negocio", EMPRESA: "Empresa" };

const date = (value) => (value ? new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Bogota" }).format(new Date(value)).replace(".", "") : "—");

const state = { me: null, metrics: null, list: null, filter: "", search: "", page: 1, detail: null };
const root = document.getElementById("app");

// ───────────────────────────── Plantillas ─────────────────────────────

function tile(label, value, hint) {
  return html`<div class="panel flex min-w-0 flex-col gap-1.5 p-4">
    <dt class="text-sm font-[620] text-muted">${label}</dt>
    <dd class="truncate text-[1.75rem] leading-none font-[800] [font-stretch:80%]">${value}</dd>
    ${hint ? html`<p class="text-sm text-muted">${hint}</p>` : ""}
  </div>`;
}

function metricsView(metrics) {
  const { businesses, orders, mrr, system } = metrics;
  const uptime = system.uptimeSeconds >= 3600 ? `${Math.floor(system.uptimeSeconds / 3600)} h` : `${Math.floor(system.uptimeSeconds / 60)} min`;
  return html`<dl class="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))]">
      ${tile("Negocios", String(businesses.total), `+${businesses.new7} en 7 días · +${businesses.new30} en 30 días`)}
      ${tile("Pagando", String(businesses.active), `${businesses.trial} en prueba`)}
      ${tile("Por renovar", String(businesses.pastDue + businesses.expired), `${businesses.pastDue} en gracia · ${businesses.expired} vencidos`)}
      ${tile("Ingreso mensual estimado", formatCOP(mrr), "Precio de lista de los planes activos")}
      ${tile("Pedidos (24 h)", String(orders.orders1), `${orders.orders30} en 30 días`)}
      ${tile("Ventas de las tiendas (30 días)", formatCOP(orders.gmv30), "Pedidos aceptados")}
      ${tile("Tiendas con pedidos", String(orders.storesWithOrders7), "En los últimos 7 días")}
      ${tile("Suspendidos", String(businesses.suspended))}
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
                    <span>${date(payment.createdAt)} · ${payment.months} ${payment.months === 1 ? "mes" : "meses"} · ${payment.method}${payment.reference ? ` · ${payment.reference}` : ""}</span>
                    <span class="num font-[700]">${formatCOP(payment.amount)}</span>
                    <span class="w-full text-sm text-muted">Periodo ${date(payment.periodStart)} – ${date(payment.periodEnd)}${payment.recordedBy ? ` · registró ${payment.recordedBy.name}` : ""}</span>
                  </li>`,
                )}
              </ul>`}
        </section>
      </div>
    </div>
  </div>`;
}

function page() {
  return html`<header class="on-ink bg-ink text-paper">
      <div class="mx-auto flex max-w-[84rem] items-center gap-4 px-4 py-3 sm:px-6">
        ${brand({ onInk: true })}
        <span class="badge bg-mustard text-ink">Administración</span>
        <a href="/panel" class="ml-auto text-sm font-[620] text-ink-soft hover:text-paper">Ir a mi panel</a>
      </div>
    </header>
    <main class="mx-auto grid max-w-[84rem] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-8 sm:px-6">
      <div>
        <h1 class="text-[2rem] leading-tight font-[780]">Panel de Pedify</h1>
        <p class="mt-1 text-muted">Negocios, suscripciones y métricas de toda la plataforma.</p>
      </div>
      <section class="grid gap-3" aria-label="Métricas" data-metrics>${metricsView(state.metrics)}</section>
      <section class="grid gap-4" aria-labelledby="businesses-title">
        <h2 id="businesses-title" class="text-xl font-[760]">Negocios <span class="num text-muted">(${state.list.total})</span></h2>
        <div class="grid gap-4" data-list>${listView()}</div>
      </section>
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

async function refresh() {
  [state.metrics] = await Promise.all([api("/admin/metrics"), loadList()]);
  render(root, page());
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

async function afterChange(updated, message) {
  state.detail = updated;
  const dialog = document.getElementById("business-detail");
  render(dialog, detailView(updated));
  toast(message);
  state.metrics = await api("/admin/metrics");
  await loadList();
  render(document.querySelector("[data-metrics]"), metricsView(state.metrics));
  render(document.querySelector("[data-list]"), listView());
}

function bind() {
  root.addEventListener("click", async (event) => {
    const row = event.target.closest("[data-business]");
    if (row) return openDetail(row.dataset.business);
    const target = event.target.closest("button");
    if (!target) return;
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
  });
  root.addEventListener("keydown", (event) => {
    const row = event.target.closest?.("[data-business]");
    if (row && (event.key === "Enter" || event.key === " ")) {
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
  }
} catch (error) {
  if (error.status === 401) redirectToLogin();
  else render(root, html`<p class="p-6 text-tomato">${error.message}</p>`);
}
