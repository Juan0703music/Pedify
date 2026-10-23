// Mi plan (fase 5: comercialización): estado de la suscripción, uso frente a los límites,
// planes disponibles, cómo pagar y pagos registrados. Con Wompi configurado, el plan se paga en
// línea: Pedify crea el cobro, el negocio paga en Wompi y al volver aquí se confirma el pago.
import { api, formatCOP } from "./api.js";
import { initPanel, renderNoBusiness } from "./dashboard.js";
import { html, icon, render, setBusy, toast } from "./ui.js";

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

/** Medio de pago de un pago registrado (los de Wompi traen el medio en la nota). */
function methodLabel(payment) {
  if (payment.method === "WOMPI") return `Wompi · ${payment.note ?? "en línea"}`;
  return payment.method.charAt(0) + payment.method.slice(1).toLowerCase();
}

/** Por qué no se puede pagar un plan más pequeño que el menú o el equipo actual (o null). */
function tooSmall(plan, option) {
  const { products, members } = plan.usage;
  if (option.maxProducts !== null && products > option.maxProducts) return `Tienes ${products} productos y este plan permite ${option.maxProducts}.`;
  if (option.maxMembers !== null && members > option.maxMembers) {
    return `Tienes ${members} personas en el equipo y este plan permite ${option.maxMembers}.`;
  }
  return null;
}

/** Botones para pagar un plan en Wompi: un mes o el año completo con descuento. */
function payButtons(plan, option, { primary = false } = {}) {
  const blocked = tooSmall(plan, option);
  if (blocked) return html`<p class="rounded-[10px] bg-ground px-3.5 py-2.5 text-sm text-muted">${blocked} Elimina algunos para pagarlo.</p>`;
  return html`<div class="grid gap-2 ${primary ? "sm:grid-cols-2" : ""}">
    <button type="button" class="btn ${primary ? "btn-ink" : "btn-ghost"}" data-pay="${option.code}" data-months="1">
      ${icon("credit-card")} Pagar 1 mes · ${formatCOP(option.priceMonthly)}
    </button>
    <button type="button" class="btn btn-ghost" data-pay="${option.code}" data-months="12">Pagar 1 año · ${formatCOP(option.priceYearly)}</button>
  </div>`;
}

const RESULT = {
  APPROVED: { tone: "bg-leaf-soft text-leaf", icon: "circle-check" },
  PENDING: { tone: "bg-mustard-soft text-mustard-deep", icon: "clock" },
  FAILED: { tone: "bg-tomato text-paper", icon: "circle-x" },
};

/** Aviso con el resultado del pago al volver de Wompi. */
function resultNotice(notice) {
  if (!notice) return "";
  const style = RESULT[notice.kind];
  return html`<div class="flex items-start gap-3 rounded-[14px] px-4 py-3.5 text-[0.9375rem] ${style.tone}" role="status">
    ${icon(notice.busy ? "loader-circle" : style.icon, `mt-0.5 flex-none ${notice.busy ? "animate-spin" : ""}`)}
    <p><strong class="font-[720]">${notice.title}</strong> ${notice.text}</p>
  </div>`;
}

function meter(label, used, limit) {
  // Plan sin límite: solo el uso, sin barra.
  if (limit === null) {
    return html`<div class="flex items-baseline justify-between gap-3 text-[0.9375rem]">
      <span class="font-[650]">${label}</span>
      <span class="num"><span class="font-[760]">${used}</span> <span class="text-muted">· sin límite</span></span>
    </div>`;
  }
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

function page(plan, business, notice) {
  const status = STATUS[plan.status];
  const online = plan.onlinePayment;
  const currentOption = plan.plans.find((option) => option.code === plan.plan);
  const payUrl = supportLink(plan, `Hola, quiero pagar el plan ${plan.planName} de Pedify para mi negocio ${business.name} (${business.storeUrl}).`);
  const yearUrl = supportLink(
    plan,
    `Hola, quiero pagar el año completo del plan ${plan.planName} de Pedify (${formatCOP(plan.priceYearly)}, con ${plan.annualDiscountPercent} % de descuento) para mi negocio ${business.name} (${business.storeUrl}).`,
  );
  return html`<div class="grid grid-cols-[minmax(0,1fr)] gap-6 lg:gap-8">
    <header>
      <h1 class="text-[1.875rem] leading-tight font-[780] sm:text-[2.375rem]">Mi plan</h1>
      <p class="mt-1 text-[0.9375rem] text-muted">${business.name}</p>
    </header>
    ${resultNotice(notice)}

    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <section class="panel overflow-hidden" aria-labelledby="current-title">
        <div class="grid gap-3 bg-ink p-5 text-paper sm:p-6">
          <div class="flex flex-wrap items-center gap-3">
            <h2 id="current-title" class="display text-[2rem] text-paper">Plan ${plan.planName}</h2>
            <span class="badge ${status.badge}">${status.label}</span>
          </div>
          <p class="max-w-[54ch] text-[0.9375rem] text-ink-soft">${statusText(plan)}</p>
          <p class="num text-[1.125rem] font-[760] text-mustard">
            ${formatCOP(plan.priceMonthly)} <span class="text-sm font-[560] text-ink-soft">al mes</span>
            <span class="text-sm font-[560] text-ink-soft">· o ${formatCOP(plan.priceYearly)} al año (${plan.annualDiscountPercent} % de descuento)</span>
          </p>
        </div>
        <div class="grid gap-5 p-5 sm:p-6">
          ${meter("Productos en el menú", plan.usage.products, plan.limits.products)}
          ${meter("Personas en el equipo", plan.usage.members, plan.limits.members)}
          ${online
            ? html`${payButtons(plan, currentOption, { primary: true })}
                <p class="flex items-start gap-2 text-sm text-muted">
                  ${icon("shield", "mt-0.5 h-4 w-4 flex-none")} Pagas en Wompi, la pasarela de Bancolombia, con tarjeta, PSE, Nequi o botón
                  Bancolombia. Tu plan se activa apenas se aprueba el pago.
                </p>
                ${online.sandbox
                  ? html`<p class="rounded-[10px] bg-mustard-soft px-3.5 py-2.5 text-sm text-mustard-deep">Modo de pruebas: Wompi no cobra dinero real.</p>`
                  : ""}
                ${payUrl ? html`<a class="text-sm font-[650] underline underline-offset-2" href="${payUrl}" target="_blank" rel="noopener">¿Dudas? Escríbenos por WhatsApp</a>` : ""}`
            : payUrl
            ? html`<a class="btn btn-whatsapp w-full" href="${payUrl}" target="_blank" rel="noopener">
                ${icon("message-circle")} ${plan.status === "TRIAL" ? "Elegir mi plan por WhatsApp" : "Pagar o renovar por WhatsApp"}
              </a>
              <a class="btn btn-ghost w-full" href="${yearUrl}" target="_blank" rel="noopener">
                Pagar el año completo · ahorra ${plan.annualDiscountPercent} %
              </a>`
            : html`<p class="rounded-[10px] bg-ground px-3.5 py-3 text-sm text-muted">Para pagar o cambiar de plan, comunícate con el equipo de Pedify.</p>`}
        </div>
      </section>

      <section class="panel p-5 sm:p-6" aria-labelledby="how-title">
        <h2 id="how-title" class="text-lg font-[740]">Cómo pagar</h2>
        <ol class="mt-4 grid gap-4">
          ${(online
            ? [
                ["Elige tu plan", "Paga un mes o el año completo con descuento. Si eliges otro plan, el cambio es inmediato."],
                ["Paga en Wompi", "Con tarjeta débito o crédito, PSE, Nequi o botón Bancolombia, en la página segura de Wompi."],
                ["Tu plan se activa solo", "Apenas Wompi aprueba el pago lo ves aquí. Los días que te queden no se pierden: el nuevo periodo empieza cuando termina el actual."],
              ]
            : [
                ["Escríbenos por WhatsApp", "Te contamos los datos de pago del plan que elijas: mes a mes o el año completo con descuento."],
                ["Paga por Nequi, Daviplata o transferencia", "Envíanos el comprobante por el mismo chat."],
                ["Activamos tu plan", "Lo verás aquí con la fecha hasta la que está pagado. Los días de prueba que te queden no se pierden."],
              ]
          ).map(
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
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        ${plan.plans.map((option) => {
          const current = option.code === plan.plan;
          const changeUrl = supportLink(plan, `Hola, quiero cambiarme al plan ${option.name} de Pedify para mi negocio ${business.name} (${business.storeUrl}).`);
          return html`<article class="panel grid content-start gap-3 p-5 sm:p-6 ${current ? "border-ink ring-2 ring-mustard" : ""}">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-xl font-[780]">${option.name}</h3>
              ${current ? html`<span class="badge bg-ink text-mustard">Tu plan</span>` : ""}
            </div>
            <p class="text-[1.75rem] leading-none font-[820] [font-stretch:80%]">${formatCOP(option.priceMonthly)} <span class="text-base font-[560] text-muted">/ mes</span></p>
            <p class="flex flex-wrap items-center gap-2 text-[0.9375rem]">
              <span><span class="num font-[720]">${formatCOP(option.priceYearly)}</span> al año</span>
              <span class="badge bg-leaf-soft text-leaf">Ahorra ${option.annualDiscountPercent} %</span>
            </p>
            <p class="text-[0.9375rem] text-muted">${option.summary}</p>
            <ul class="grid gap-1.5 text-[0.9375rem]">
              <li class="flex gap-2">${icon("check", "mt-0.5 h-4 w-4 text-leaf")} ${option.maxProducts === null ? "Productos ilimitados con foto" : `Hasta ${option.maxProducts} productos con foto`}</li>
              <li class="flex gap-2">${icon("check", "mt-0.5 h-4 w-4 text-leaf")} ${option.maxMembers === null ? "Personas ilimitadas" : `${option.maxMembers} ${option.maxMembers === 1 ? "persona" : "personas"}`} con acceso al panel</li>
              <li class="flex gap-2">${icon("check", "mt-0.5 h-4 w-4 text-leaf")} Tienda con enlace y código QR, pedidos directos a tu panel</li>
              <li class="flex gap-2">${icon("check", "mt-0.5 h-4 w-4 text-leaf")} Pedidos en vivo, clientes y analíticas</li>
            </ul>
            ${current
              ? ""
              : online
                ? html`<div class="mt-1">${payButtons(plan, option)}</div>`
                : changeUrl
                  ? html`<a class="btn btn-ghost mt-1" href="${changeUrl}" target="_blank" rel="noopener">Cambiar a ${option.name}</a>`
                  : ""}
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
                    <td class="px-3 py-3">${methodLabel(payment)}</td>
                    <td class="num px-5 py-3 text-right font-[700]">${formatCOP(payment.amount)}</td>
                  </tr>`,
                )}
              </tbody>
            </table>
          </div>`}
    </section>
  </div>`;
}

/** Crea el cobro y lleva al negocio a pagar en Wompi. */
async function startPayment(button) {
  setBusy(button, true);
  try {
    const { url } = await api("/subscription/checkouts", { method: "POST", body: { plan: button.dataset.pay, months: Number(button.dataset.months) } });
    location.assign(url);
  } catch (error) {
    setBusy(button, false);
    toast(error.message, "error");
  }
}

const POLL_MS = 4000;
const POLL_TRIES = 30;

/**
 * De vuelta de Wompi (/panel/plan?pago=<cobro>&id=<transacción>): confirma el pago y, mientras
 * siga pendiente (PSE o Nequi pueden tardar), vuelve a consultar cada pocos segundos.
 */
async function followPayment(main, business, checkoutId, transactionId) {
  let plan = await api("/subscription");
  const draw = (notice) => render(main, page(plan, business, notice));
  draw({ kind: "PENDING", busy: true, title: "Confirmando tu pago…", text: "Un momento, estamos consultando a Wompi." });

  for (let attempt = 1; ; attempt += 1) {
    let checkout;
    try {
      checkout = await api(`/subscription/checkouts/${checkoutId}/confirm`, { method: "POST", body: transactionId ? { transactionId } : {} });
    } catch (error) {
      history.replaceState(null, "", "/panel/plan");
      return draw({ kind: "FAILED", title: "No pudimos revisar el pago.", text: error.message });
    }
    const period = `${checkout.planName} · ${checkout.months === 12 ? "1 año" : "1 mes"} (${formatCOP(checkout.amount)})`;
    if (checkout.status === "APPROVED") {
      history.replaceState(null, "", "/panel/plan");
      plan = await api("/subscription");
      return draw({ kind: "APPROVED", title: "¡Pago aprobado!", text: `${period}. Tu plan está pagado hasta el ${longDate(plan.endsAt)}.` });
    }
    if (checkout.status !== "PENDING") {
      history.replaceState(null, "", "/panel/plan");
      return draw({ kind: "FAILED", title: "Wompi no aprobó el pago.", text: "No se hizo ningún cobro. Puedes intentarlo de nuevo, si quieres con otro medio de pago." });
    }
    if (!transactionId) {
      // Volvió sin pagar (cerró Wompi o regresó con el botón atrás).
      history.replaceState(null, "", "/panel/plan");
      return draw(null);
    }
    if (attempt >= POLL_TRIES) {
      return draw({
        kind: "PENDING",
        title: "Tu pago sigue en proceso.",
        text: "Si ya pagaste, tu plan se activa solo apenas Wompi lo confirme. Puedes cerrar esta página y revisarla más tarde.",
      });
    }
    draw({ kind: "PENDING", busy: true, title: "Tu pago está en proceso.", text: `${period}. Con PSE o Nequi puede tardar unos minutos; esta página se actualiza sola.` });
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

const context = await initPanel("plan");
if (context) {
  const { main, business } = context;
  if (!business) {
    renderNoBusiness(main);
  } else if (business.role !== "OWNER") {
    render(main, html`<p class="panel mx-auto mt-6 flex max-w-lg items-start gap-3 p-6">${icon("lock", "mt-0.5")} Solo el propietario del negocio ve el plan y los pagos.</p>`);
  } else {
    main.addEventListener("click", (event) => {
      const button = event.target.closest("[data-pay]");
      if (button) startPayment(button);
    });
    const params = new URLSearchParams(location.search);
    try {
      if (params.get("pago")) await followPayment(main, business, params.get("pago"), params.get("id"));
      else render(main, page(await api("/subscription"), business));
    } catch (error) {
      render(main, html`<p class="text-tomato">${error.message}</p>`);
    }
  }
}
