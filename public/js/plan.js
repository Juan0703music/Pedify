// Mi plan (fase 5: comercialización): estado de la suscripción, uso frente a los límites,
// planes disponibles, cómo pagar y pagos registrados.
import { api, formatCOP } from "./api.js";
import { initPanel, renderNoBusiness } from "./dashboard.js";
import { html, icon, render } from "./ui.js";

const longDate = (value) =>
  new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Bogota" }).format(new Date(value));

const STATUS = {
  TRIAL: { label: "Prueba gratis", badge: "bg-mustard text-ink" },
  ACTIVE: { label: "Activo", badge: "bg-leaf-soft text-leaf" },
  PAST_DUE: { label: "Vencido · en gracia", badge: "bg-mustard text-ink" },
  EXPIRED: { label: "Vencido", badge: "bg-tomato text-paper" },
};

function statusText(plan) {
  switch (plan.status) {
    case "TRIAL":
      return `Tu prueba gratis va hasta el ${longDate(plan.endsAt)} (${plan.daysLeft} ${plan.daysLeft === 1 ? "día" : "días"}). Después eliges el plan que más te sirva.`;
    case "ACTIVE":
      return `Pagado hasta el ${longDate(plan.endsAt)} (${plan.daysLeft} ${plan.daysLeft === 1 ? "día" : "días"}).`;
    case "PAST_DUE":
      return `Tu plan venció el ${longDate(plan.endsAt)}. Tu tienda sigue recibiendo pedidos hasta el ${longDate(plan.graceEndsAt)}: renueva antes para no interrumpir tus ventas.`;
    default:
      return `Tu plan venció el ${longDate(plan.endsAt)} y tu tienda no está recibiendo pedidos en línea. Tus datos siguen guardados: al renovar, todo vuelve a funcionar.`;
  }
}

function supportLink(plan, text) {
  if (!plan.support) return null;
  return `https://wa.me/${plan.support.whatsapp}?text=${encodeURIComponent(text)}`;
}

function meter(label, used, limit) {
  const ratio = Math.min(1, used / limit);
  const near = ratio >= 0.9;
  return html`<div class="grid gap-1.5">
    <div class="flex items-baseline justify-between gap-3 text-[0.9375rem]">
      <span class="font-[650]">${label}</span>
      <span class="num"><span class="font-[760]">${used}</span> <span class="text-muted">de ${limit}</span></span>
    </div>
    <div class="h-2.5 overflow-hidden rounded-full bg-mustard-soft" role="meter" aria-valuemin="0" aria-valuemax="${limit}" aria-valuenow="${used}" aria-label="${label}: ${used} de ${limit}">
      <div class="h-full rounded-full ${near ? "bg-tomato" : "bg-[var(--color-chart)]"}" style="width: ${Math.max(ratio * 100, used > 0 ? 3 : 0)}%"></div>
    </div>
    ${near ? html`<p class="text-sm text-tomato">${icon("circle-alert", "inline h-4 w-4 align-[-3px]")} Estás cerca del límite de tu plan.</p>` : ""}
  </div>`;
}

function page(plan, business) {
  const status = STATUS[plan.status];
  const payUrl = supportLink(plan, `Hola, quiero pagar el plan ${plan.planName} de Pedify para mi negocio ${business.name} (${business.storeUrl}).`);
  return html`<div class="grid grid-cols-[minmax(0,1fr)] gap-6 lg:gap-8">
    <header>
      <h1 class="text-[1.875rem] leading-tight font-[780] sm:text-[2.375rem]">Mi plan</h1>
      <p class="mt-1 text-[0.9375rem] text-muted">${business.name}</p>
    </header>

    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <section class="panel overflow-hidden" aria-labelledby="current-title">
        <div class="grid gap-3 bg-ink p-5 text-paper sm:p-6">
          <div class="flex flex-wrap items-center gap-3">
            <h2 id="current-title" class="display text-[2rem] text-paper">Plan ${plan.planName}</h2>
            <span class="badge ${status.badge}">${status.label}</span>
          </div>
          <p class="max-w-[54ch] text-[0.9375rem] text-ink-soft">${statusText(plan)}</p>
          <p class="num text-[1.125rem] font-[760] text-mustard">${formatCOP(plan.priceMonthly)} <span class="text-sm font-[560] text-ink-soft">al mes</span></p>
        </div>
        <div class="grid gap-5 p-5 sm:p-6">
          ${meter("Productos en el menú", plan.usage.products, plan.limits.products)}
          ${meter("Personas en el equipo", plan.usage.members, plan.limits.members)}
          ${payUrl
            ? html`<a class="btn btn-whatsapp w-full" href="${payUrl}" target="_blank" rel="noopener">
                ${icon("message-circle")} ${plan.status === "TRIAL" ? "Elegir mi plan por WhatsApp" : "Pagar o renovar por WhatsApp"}
              </a>`
            : html`<p class="rounded-[10px] bg-ground px-3.5 py-3 text-sm text-muted">Para pagar o cambiar de plan, comunícate con el equipo de Pedify.</p>`}
        </div>
      </section>

      <section class="panel p-5 sm:p-6" aria-labelledby="how-title">
        <h2 id="how-title" class="text-lg font-[740]">Cómo pagar</h2>
        <ol class="mt-4 grid gap-4">
          ${[
            ["Escríbenos por WhatsApp", "Te contamos el valor y los datos de pago del plan que elijas."],
            ["Paga por Nequi, Daviplata o transferencia", "Envíanos el comprobante por el mismo chat."],
            ["Activamos tu plan", "Lo verás aquí con la fecha hasta la que está pagado. Los días de prueba que te queden no se pierden."],
          ].map(
            ([title, text], index) => html`<li class="flex gap-3">
              <span class="grid h-8 w-8 flex-none place-items-center rounded-full bg-mustard text-sm font-[800]">${index + 1}</span>
              <span><span class="block font-[680]">${title}</span><span class="block text-sm text-muted">${text}</span></span>
            </li>`,
          )}
        </ol>
      </section>
    </div>

    <section aria-labelledby="plans-title" class="grid gap-4">
      <h2 id="plans-title" class="text-lg font-[740]">Planes</h2>
      <div class="grid gap-4 md:grid-cols-2">
        ${plan.plans.map((option) => {
          const current = option.code === plan.plan;
          const changeUrl = supportLink(plan, `Hola, quiero cambiarme al plan ${option.name} de Pedify para mi negocio ${business.name} (${business.storeUrl}).`);
          return html`<article class="panel grid gap-3 p-5 sm:p-6 ${current ? "border-ink ring-2 ring-mustard" : ""}">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-xl font-[780]">${option.name}</h3>
              ${current ? html`<span class="badge bg-ink text-mustard">Tu plan</span>` : ""}
            </div>
            <p class="text-[1.75rem] leading-none font-[820] [font-stretch:80%]">${formatCOP(option.priceMonthly)} <span class="text-base font-[560] text-muted">/ mes</span></p>
            <p class="text-[0.9375rem] text-muted">${option.summary}</p>
            <ul class="grid gap-1.5 text-[0.9375rem]">
              <li class="flex gap-2">${icon("check", "mt-0.5 h-4 w-4 text-leaf")} Hasta ${option.maxProducts} productos con foto</li>
              <li class="flex gap-2">${icon("check", "mt-0.5 h-4 w-4 text-leaf")} ${option.maxMembers} personas con acceso al panel</li>
              <li class="flex gap-2">${icon("check", "mt-0.5 h-4 w-4 text-leaf")} Tienda con enlace y código QR, pedidos directos a tu panel</li>
              <li class="flex gap-2">${icon("check", "mt-0.5 h-4 w-4 text-leaf")} Pedidos en vivo, clientes y analíticas</li>
            </ul>
            ${!current && changeUrl ? html`<a class="btn btn-ghost mt-1" href="${changeUrl}" target="_blank" rel="noopener">Cambiar a ${option.name}</a>` : ""}
          </article>`;
        })}
      </div>
    </section>

    <section class="panel overflow-hidden" aria-labelledby="payments-title">
      <h2 id="payments-title" class="border-b border-line px-5 py-4 text-lg font-[740] sm:px-6">Pagos registrados</h2>
      ${plan.payments.length === 0
        ? html`<p class="px-5 py-5 text-[0.9375rem] text-muted sm:px-6">Aún no hay pagos. Cuando pagues, aparecerán aquí.</p>`
        : html`<div class="overflow-x-auto">
            <table class="w-full min-w-[34rem] text-left text-[0.9375rem]">
              <thead class="bg-ground text-sm text-muted">
                <tr><th class="px-5 py-2.5 font-[650]">Fecha</th><th class="px-3 py-2.5 font-[650]">Plan</th><th class="px-3 py-2.5 font-[650]">Periodo</th><th class="px-3 py-2.5 font-[650]">Medio</th><th class="px-5 py-2.5 text-right font-[650]">Valor</th></tr>
              </thead>
              <tbody class="divide-y divide-line">
                ${plan.payments.map(
                  (payment) => html`<tr>
                    <td class="px-5 py-3">${longDate(payment.createdAt)}</td>
                    <td class="px-3 py-3">${plan.plans.find((item) => item.code === payment.plan)?.name ?? payment.plan} · ${payment.months} ${payment.months === 1 ? "mes" : "meses"}</td>
                    <td class="px-3 py-3 text-sm text-muted">${longDate(payment.periodStart)} – ${longDate(payment.periodEnd)}</td>
                    <td class="px-3 py-3">${payment.method.charAt(0) + payment.method.slice(1).toLowerCase()}</td>
                    <td class="num px-5 py-3 text-right font-[700]">${formatCOP(payment.amount)}</td>
                  </tr>`,
                )}
              </tbody>
            </table>
          </div>`}
    </section>
  </div>`;
}

const context = await initPanel("plan");
if (context) {
  const { main, business } = context;
  if (!business) {
    renderNoBusiness(main);
  } else if (business.role !== "OWNER") {
    render(main, html`<p class="panel mx-auto mt-6 flex max-w-lg items-start gap-3 p-6">${icon("lock", "mt-0.5")} Solo el propietario del negocio ve el plan y los pagos.</p>`);
  } else {
    try {
      render(main, page(await api("/subscription"), business));
    } catch (error) {
      render(main, html`<p class="text-tomato">${error.message}</p>`);
    }
  }
}
