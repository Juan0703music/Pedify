// Mi plan (fase 5: comercialización): estado de la suscripción, uso frente a los límites,
// planes disponibles, cómo pagar y pagos registrados. Con Wompi configurado, el plan se paga en
// línea: Pedify crea el cobro, el negocio paga en Wompi y al volver aquí se confirma el pago.
// Con las cuentas de Pedify configuradas, también se paga directo a Nequi o a la llave Bre-B: el
// negocio sube el comprobante y el plan se activa cuando Pedify confirma que el dinero llegó.
// El pago se ve en vivo en todos los dispositivos: si pagas en el celular, el computador lo muestra.
import { api, formatCOP, upload } from "./api.js";
import { initPanel, renderNoBusiness } from "./dashboard.js";
import { onLive } from "./notifications.js";
import { checkImageFile, copyText, html, icon, raw, render, setBusy, toast } from "./ui.js";

const longDate = (value) =>
  new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Bogota" }).format(new Date(value));
const dayTime = (value) =>
  new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" }).format(new Date(value));
const period = (months) => (months === 12 ? "1 año" : "1 mes");
const METHOD_LABEL = { NEQUI: "Nequi", BRE_B: "Llave Bre-B", DAVIPLATA: "Daviplata", TRANSFERENCIA: "Transferencia", EFECTIVO: "Efectivo", OTRO: "Otro" };

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
  return METHOD_LABEL[payment.method] ?? payment.method.charAt(0) + payment.method.slice(1).toLowerCase();
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

/**
 * Botones para pagar un plan: un mes o el año completo con descuento. En Wompi (`data-pay`) o directo a
 * las cuentas de Pedify (`data-direct`, abre los datos para pagar y subir el comprobante).
 */
function payButtons(plan, option, { primary = false, direct = false } = {}) {
  const blocked = tooSmall(plan, option);
  if (blocked) return html`<p class="rounded-[10px] bg-ground px-3.5 py-2.5 text-sm text-muted">${blocked} Elimina algunos para pagarlo.</p>`;
  const action = direct ? "data-direct" : "data-pay";
  return html`<div class="grid gap-2 ${primary ? "sm:grid-cols-2" : ""}">
    <button type="button" class="btn ${primary ? "btn-ink" : "btn-ghost"}" ${action}="${option.code}" data-months="1">
      ${icon(direct ? "qr-code" : "credit-card")} Pagar 1 mes · ${formatCOP(option.priceMonthly)}
    </button>
    <button type="button" class="btn btn-ghost" ${action}="${option.code}" data-months="12">Pagar 1 año · ${formatCOP(option.priceYearly)}</button>
  </div>`;
}

/** Nombres de las cuentas de Pedify para pagar directo: «Nequi o llave Bre-B». */
const directNames = (plan) => plan.directPayment.accounts.map((account) => (account.kind === "BRE_B" ? "llave Bre-B" : account.label)).join(" o ");

/** ¿Se puede pagar directo ahora? (Hay cuentas y no hay otro pago esperando confirmación.) */
const canPayDirect = (plan) => Boolean(plan.directPayment) && plan.transfer?.status !== "PENDING";

/** Cómo pagar `option`: Wompi, directo a Nequi o Bre-B (o ambos), o nada si no hay forma configurada. */
function paymentChoices(plan, option, { primary = false } = {}) {
  const direct = canPayDirect(plan);
  if (plan.onlinePayment) {
    return html`${payButtons(plan, option, { primary })}
      ${direct && !tooSmall(plan, option)
        ? html`<p class="text-sm text-muted">
            ¿Prefieres pagar por ${directNames(plan)}?
            <button type="button" class="font-[650] text-ink underline underline-offset-2" data-direct="${option.code}" data-months="1">Paga directo y sube el comprobante</button>
          </p>`
        : ""}`;
  }
  return direct ? payButtons(plan, option, { primary, direct: true }) : "";
}

/** Pago directo a la cuenta de Pedify: QR o llave, valor exacto, pasos y el botón para subir el comprobante. */
function directPanel(plan, paying) {
  const option = plan.plans.find((item) => item.code === paying.plan);
  const accounts = plan.directPayment.accounts;
  const account = accounts.find((item) => item.kind === paying.kind) ?? accounts[0];
  const amount = paying.months === 12 ? option.priceYearly : option.priceMonthly;
  const keyName = account.kind === "BRE_B" ? "Llave Bre-B" : `Número de ${account.label}`;
  const segment = (attribute, value, selected, label) => html`<button
    type="button"
    class="min-h-9 flex-1 rounded-full px-3 text-sm font-[720] text-muted aria-pressed:bg-ink aria-pressed:text-paper"
    aria-pressed="${selected ? "true" : "false"}"
    ${attribute}="${value}"
  >
    ${label}
  </button>`;
  return html`<section class="panel grid gap-5 border-2 border-ink p-5 sm:p-6" aria-labelledby="direct-title" data-direct-panel>
    <header class="flex items-start gap-3">
      <span class="grid h-11 w-11 flex-none place-items-center rounded-full bg-mustard">${icon("qr-code", "h-5 w-5")}</span>
      <div class="min-w-0 flex-1">
        <h2 id="direct-title" class="text-[1.25rem] leading-snug font-[800]">Paga tu plan ${option.name}</h2>
        <p class="text-sm text-muted">Paga desde tu app y sube el comprobante. Tu plan se activa apenas confirmemos que el pago llegó.</p>
      </div>
      <button type="button" class="btn btn-quiet btn-icon" data-direct-close aria-label="Cerrar">${icon("x")}</button>
    </header>

    <div class="grid gap-2 sm:grid-cols-2">
      <div class="flex gap-1 rounded-full bg-ground p-1" role="group" aria-label="Periodo">
        ${segment("data-direct-months", "1", paying.months === 1, `1 mes · ${formatCOP(option.priceMonthly)}`)}
        ${segment("data-direct-months", "12", paying.months === 12, `1 año · ${formatCOP(option.priceYearly)}`)}
      </div>
      ${accounts.length > 1
        ? html`<div class="flex gap-1 rounded-full bg-ground p-1" role="group" aria-label="Cuenta para pagar">
            ${accounts.map((item) => segment("data-direct-kind", item.kind, item.kind === account.kind, item.kind === "BRE_B" ? "Llave Bre-B" : item.label))}
          </div>`
        : ""}
    </div>

    <div class="grid items-center gap-4 ${account.qrSvg ? "sm:grid-cols-[11rem_minmax(0,1fr)]" : ""}">
      ${account.qrSvg
        ? html`<div
            class="mx-auto w-44 rounded-[14px] border-2 border-ink bg-[#fff] p-1.5 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
            role="img"
            aria-label="Código QR de ${account.label} para pagar"
          >
            ${raw(account.qrSvg)}
          </div>`
        : ""}
      <div class="grid justify-items-center gap-2 text-center ${account.qrSvg ? "sm:justify-items-start sm:text-left" : ""}">
        <div>
          <p class="text-sm font-[620] text-muted">Valor a pagar</p>
          <p class="num text-[2rem] leading-none font-[860] [font-stretch:80%]">${formatCOP(amount)}</p>
        </div>
        ${account.accountKey
          ? html`<button type="button" class="inline-flex min-h-10 max-w-full items-center gap-2 rounded-full bg-ground px-3.5 text-[0.9375rem] font-[700]" data-copy-account="${account.accountKey.replace(/\s+/g, "")}">
              <span class="font-[620] text-muted">${keyName}</span>
              <span class="num [overflow-wrap:anywhere]">${account.accountKey}</span>
              <span class="text-muted" data-copy-label>${icon("copy", "h-4 w-4")}</span>
            </button>`
          : ""}
        ${account.holderName ? html`<p class="text-sm">A nombre de <strong class="font-[720]">${account.holderName}</strong></p>` : ""}
        ${account.qrSvg
          ? html`<a class="inline-flex items-center gap-1.5 text-sm font-[650] text-ink underline" href="/api/v1/subscription/payment-qr/${account.kind}.png" download>
              ${icon("download", "h-4 w-4")} Guardar imagen del QR
            </a>`
          : ""}
      </div>
    </div>

    <ol class="grid gap-1.5 rounded-[12px] bg-ground px-4 py-3 text-sm">
      <li><strong class="font-[720]">1.</strong> ${account.qrSvg
        ? "Escanea el QR desde la app de Nequi o de tu banco. Si estás en el celular, guarda la imagen y súbela en tu app, o copia el número."
        : account.kind === "BRE_B"
          ? "Copia la llave y envía el pago desde la app de tu banco o billetera (Bre-B funciona entre todos los bancos)."
          : `Copia el número y envía el pago desde tu app de ${account.label}.`}</li>
      <li><strong class="font-[720]">2.</strong> Paga exactamente <span class="num font-[720]">${formatCOP(amount)}</span>.</li>
      <li><strong class="font-[720]">3.</strong> Toma un pantallazo del comprobante y súbelo aquí.</li>
    </ol>

    <label class="btn btn-ink relative min-h-12 w-full cursor-pointer" data-transfer-pick>
      <input type="file" accept="image/*" class="sr-only" data-transfer-file aria-label="Subir el comprobante de pago" />
      ${icon("upload")} <span data-transfer-label>Subir comprobante de pago</span>
    </label>
  </section>`;
}

/** Estado del último pago directo: en revisión, confirmado o no confirmado (con el motivo). */
function transferNotice(plan) {
  const transfer = plan.transfer;
  if (!transfer) return "";
  const what = `Plan ${transfer.planName} · ${period(transfer.months)} (${formatCOP(transfer.amount)}) por ${transfer.methodLabel}`;
  if (transfer.status === "PENDING") {
    return html`<div class="flex flex-wrap items-start gap-3 rounded-[14px] bg-mustard-soft px-4 py-3.5 text-[0.9375rem] text-mustard-deep" role="status">
      ${icon("clock", "mt-0.5 flex-none")}
      <p class="min-w-0 flex-[1_1_16rem]">
        <strong class="font-[720]">Tu pago está en revisión.</strong> ${what}. Lo enviaste el ${dayTime(transfer.createdAt)} y apenas confirmemos que
        llegó, tu plan se activa (te avisamos aquí y por correo).
      </p>
      <button type="button" class="btn btn-ghost btn-sm bg-paper" data-transfer-cancel="${transfer.id}">Cancelar y subir otro</button>
    </div>`;
  }
  if (transfer.status === "APPROVED") {
    return html`<div class="flex items-start gap-3 rounded-[14px] bg-leaf-soft px-4 py-3.5 text-[0.9375rem] text-leaf" role="status">
      ${icon("circle-check", "mt-0.5 flex-none")}
      <p><strong class="font-[720]">¡Confirmamos tu pago!</strong> ${what}. Tu plan está pagado hasta el ${longDate(plan.endsAt)}.</p>
    </div>`;
  }
  return html`<div class="flex items-start gap-3 rounded-[14px] bg-tomato-soft px-4 py-3.5 text-[0.9375rem] text-tomato" role="status">
    ${icon("circle-x", "mt-0.5 flex-none")}
    <p><strong class="font-[720]">No pudimos confirmar tu pago.</strong> ${what}. Motivo: ${transfer.rejectReason} Si ya pagaste, sube el comprobante de nuevo.</p>
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
    ${transferNotice(plan)}
    ${view.paying && plan.directPayment ? directPanel(plan, view.paying) : ""}

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
            ? html`${paymentChoices(plan, currentOption, { primary: true })}
                <p class="flex items-start gap-2 text-sm text-muted">
                  ${icon("shield", "mt-0.5 h-4 w-4 flex-none")} Pagas en Wompi, la pasarela de Bancolombia, con tarjeta, PSE, Nequi o botón
                  Bancolombia. Tu plan se activa apenas se aprueba el pago.
                </p>
                ${online.sandbox
                  ? html`<p class="rounded-[10px] bg-mustard-soft px-3.5 py-2.5 text-sm text-mustard-deep">Modo de pruebas: Wompi no cobra dinero real.</p>`
                  : ""}
                ${payUrl ? html`<a class="text-sm font-[650] underline underline-offset-2" href="${payUrl}" target="_blank" rel="noopener">¿Dudas? Escríbenos por WhatsApp</a>` : ""}`
            : plan.directPayment
            ? html`${paymentChoices(plan, currentOption, { primary: true })}
                <p class="flex items-start gap-2 text-sm text-muted">
                  ${icon("shield", "mt-0.5 h-4 w-4 flex-none")} Pagas por ${directNames(plan)} y subes el comprobante. Tu plan se activa apenas
                  confirmemos el pago.
                </p>
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
            : plan.directPayment
            ? [
                ["Elige tu plan", `Un mes o el año completo con descuento. Pagas por ${directNames(plan)} desde la app de tu banco o billetera.`],
                ["Sube el comprobante", "Toma un pantallazo del pago y súbelo aquí mismo."],
                ["Activamos tu plan", "Confirmamos que el pago llegó y tu plan se activa (te avisamos aquí y por correo). Los días que te queden no se pierden."],
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
              <li class="flex gap-2">${icon("check", "mt-0.5 h-4 w-4 text-leaf")} ${option.maxBusinesses === null ? "Negocios ilimitados" : option.maxBusinesses === 1 ? "1 negocio" : `Hasta ${option.maxBusinesses} negocios`} en tu cuenta</li>
              <li class="flex gap-2">${icon("check", "mt-0.5 h-4 w-4 text-leaf")} Tienda con enlace y código QR, pedidos directos a tu panel</li>
              <li class="flex gap-2">${icon("check", "mt-0.5 h-4 w-4 text-leaf")} Pedidos en vivo, clientes y analíticas</li>
            </ul>
            ${current
              ? ""
              : online || canPayDirect(plan)
                ? html`<div class="mt-1 grid gap-2">${paymentChoices(plan, option)}</div>`
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

// ─── Pago en curso ───
// En la app instalada, Wompi puede abrirse en una ventana aparte (iPhone) y el regreso no llega a esta
// pantalla: el cobro se recuerda en el dispositivo y se revisa al volver o cuando Wompi avisa.
const PENDING_KEY = "pedify:plan-payment";
const PENDING_MAX_MS = 6 * 60 * 60 * 1000;

function rememberPayment(id) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ id, at: Date.now() }));
  } catch {
    // Sin almacenamiento: el aviso de Wompi igual activa el plan.
  }
}

function pendingPayment() {
  try {
    const saved = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null");
    if (saved?.id && Date.now() - saved.at < PENDING_MAX_MS) return saved.id;
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Sin almacenamiento o dato dañado.
  }
  return null;
}

function forgetPayment() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Sin almacenamiento.
  }
}

/** Aviso del resultado de un cobro ya resuelto (aprobado o no). */
function settledNotice(checkout, plan) {
  const period = `${checkout.planName} · ${checkout.months === 12 ? "1 año" : "1 mes"} (${formatCOP(checkout.amount)})`;
  if (checkout.status === "APPROVED") {
    return { kind: "APPROVED", title: "¡Pago aprobado!", text: `${period}. Tu plan está pagado hasta el ${longDate(plan.endsAt)}.` };
  }
  return { kind: "FAILED", title: "Wompi no aprobó el pago.", text: "No se hizo ningún cobro. Puedes intentarlo de nuevo, si quieres con otro medio de pago." };
}

/** Crea el cobro y lleva al negocio a pagar en Wompi. */
async function startPayment(button) {
  setBusy(button, true);
  try {
    const { id, url } = await api("/subscription/checkouts", { method: "POST", body: { plan: button.dataset.pay, months: Number(button.dataset.months) } });
    rememberPayment(id);
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
/** Lo que muestra la pantalla además del plan: el aviso del último pago y si se está siguiendo uno. */
const view = { notice: null, following: false, paying: null, plan: null };

async function followPayment(main, business, checkoutId, transactionId) {
  let plan = await api("/subscription");
  const draw = (notice) => {
    view.notice = notice;
    view.plan = plan;
    render(main, page(plan, business, notice));
  };
  draw({ kind: "PENDING", busy: true, title: "Confirmando tu pago…", text: "Un momento, estamos consultando a Wompi." });

  for (let attempt = 1; ; attempt += 1) {
    let checkout;
    try {
      checkout = await api(`/subscription/checkouts/${checkoutId}/confirm`, { method: "POST", body: transactionId ? { transactionId } : {} });
    } catch (error) {
      history.replaceState(null, "", "/panel/plan");
      forgetPayment();
      return draw({ kind: "FAILED", title: "No pudimos revisar el pago.", text: error.message });
    }
    const period = `${checkout.planName} · ${checkout.months === 12 ? "1 año" : "1 mes"} (${formatCOP(checkout.amount)})`;
    if (checkout.status !== "PENDING") {
      history.replaceState(null, "", "/panel/plan");
      forgetPayment();
      if (checkout.status === "APPROVED") plan = await api("/subscription");
      return draw(settledNotice(checkout, plan));
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

/**
 * Mantiene la pantalla al día con lo que pasa en otros dispositivos y en Wompi: un pago aprobado desde
 * el celular aparece aquí al instante, y al volver a la app se revisa el cobro que quedó en curso.
 */
function followPlan(main, business) {
  let checking = false;
  const refresh = async ({ quiet = true } = {}) => {
    // Mientras se confirma el regreso de Wompi, esa misma consulta actualiza la pantalla.
    if (checking || view.following) return;
    checking = true;
    try {
      const pending = pendingPayment();
      const checkout = pending ? await api(`/subscription/checkouts/${pending}/confirm`, { method: "POST", body: {} }).catch(() => null) : null;
      if (pending && (!checkout || checkout.status !== "PENDING")) forgetPayment();
      const plan = await api("/subscription");
      if (checkout && checkout.status !== "PENDING") view.notice = settledNotice(checkout, plan);
      // Si ya no se puede pagar directo (otro dispositivo subió un comprobante), se cierra el pago abierto.
      if (!canPayDirect(plan)) view.paying = null;
      view.plan = plan;
      render(main, page(plan, business, view.notice));
    } catch (error) {
      // Sin conexión: se intenta de nuevo al reconectarse (la primera carga sí muestra el error).
      if (!quiet) throw error;
    } finally {
      checking = false;
    }
  };
  onLive("changed", ({ scope }) => scope === "subscription" && refresh());
  onLive("resync", () => refresh());
  return refresh;
}

// ─── Pago directo a Nequi o a la llave Bre-B de Pedify ───

function bindDirectPayment(main, business, refresh) {
  const redraw = () => render(main, page(view.plan, business, view.notice));
  const showPanel = () => main.querySelector("[data-direct-panel]")?.scrollIntoView({ block: "start", behavior: "smooth" });

  main.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.matches("[data-direct]")) {
      const kind = view.plan.directPayment.accounts.find((account) => account.qrSvg)?.kind ?? view.plan.directPayment.accounts[0].kind;
      view.paying = { plan: button.dataset.direct, months: Number(button.dataset.months), kind };
      redraw();
      showPanel();
    }
    if (button.matches("[data-direct-close]")) {
      view.paying = null;
      redraw();
    }
    if (button.matches("[data-direct-months]")) {
      view.paying = { ...view.paying, months: Number(button.dataset.directMonths) };
      redraw();
    }
    if (button.matches("[data-direct-kind]")) {
      view.paying = { ...view.paying, kind: button.dataset.directKind };
      redraw();
    }
    if (button.matches("[data-copy-account]")) {
      const ok = await copyText(button.dataset.copyAccount);
      const label = button.querySelector("[data-copy-label]");
      if (label) label.textContent = ok ? "Copiado" : "";
    }
    if (button.matches("[data-transfer-cancel]")) {
      if (button.dataset.armed !== "true") {
        button.dataset.armed = "true";
        button.textContent = "¿Cancelar el pago en revisión?";
        return;
      }
      setBusy(button, true);
      try {
        await api(`/subscription/transfers/${button.dataset.transferCancel}`, { method: "DELETE" });
        view.notice = null;
        toast("Cancelaste el pago en revisión. Puedes subir el comprobante correcto.");
        await refresh();
      } catch (error) {
        setBusy(button, false);
        toast(error.message, "error");
      }
    }
  });

  main.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-transfer-file]");
    const file = input?.files?.[0];
    if (!file) return;
    input.value = "";
    const problem = checkImageFile(file);
    if (problem) return toast(problem, "error");
    const zone = input.closest("label");
    const label = zone.querySelector("[data-transfer-label]");
    zone.setAttribute("aria-busy", "true");
    zone.classList.add("opacity-60", "pointer-events-none");
    // Pedify lee el comprobante al subirlo (uno o dos segundos) para revisar el valor.
    label.textContent = "Revisando tu comprobante…";
    const { plan, months, kind } = view.paying;
    try {
      const transfer = await upload(`/subscription/transfers?${new URLSearchParams({ plan, months: String(months), method: kind })}`, file);
      view.paying = null;
      view.notice =
        transfer.reading?.matchesTotal === false
          ? {
              kind: "PENDING",
              title: "Revisa tu comprobante.",
              text: `Parece ser de ${formatCOP(transfer.reading.amount)} y el plan es de ${formatCOP(transfer.amount)}. Si te equivocaste, cancela el pago en revisión y sube el correcto.`,
            }
          : null;
      toast("Recibimos tu comprobante. Te avisamos apenas confirmemos el pago.");
      await refresh();
      main.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (error) {
      zone.removeAttribute("aria-busy");
      zone.classList.remove("opacity-60", "pointer-events-none");
      label.textContent = "Subir comprobante de pago";
      toast(error instanceof TypeError ? "Sin conexión. Revisa tu internet y vuelve a subir el comprobante." : error.message, "error");
    }
  });
}

const context = await initPanel("plan");
if (context) {
  const { main, business } = context;
  if (!business) {
    renderNoBusiness(main);
  } else if (business.role !== "OWNER") {
    render(main, html`<p class="panel mx-auto mt-6 flex max-w-lg items-start gap-3 p-6">${icon("lock", "mt-0.5")} Solo el propietario del negocio ve el plan y los pagos.</p>`);
  } else {
    const params = new URLSearchParams(location.search);
    const refresh = followPlan(main, business);
    bindDirectPayment(main, business, refresh);
    main.addEventListener("click", (event) => {
      const button = event.target.closest("[data-pay]");
      if (button) startPayment(button);
    });
    try {
      if (params.get("pago")) {
        view.following = true;
        await followPayment(main, business, params.get("pago"), params.get("id"));
      } else {
        await refresh({ quiet: false });
      }
    } catch (error) {
      render(main, html`<p class="text-tomato">${error.message}</p>`);
    } finally {
      view.following = false;
    }
  }
}
