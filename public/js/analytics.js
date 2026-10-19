// Analíticas (sección 11 del documento): ventas, pedidos procesados y productos más vendidos.
// Las cifras las calcula el servidor en PostgreSQL con la hora de Colombia; aquí solo se dibujan.
// Gráficas: una sola serie por gráfica (color de marca validado), columnas finas con borde
// redondeado arriba, cuadrícula tenue, valor solo en el punto alto, información al pasar el
// cursor o enfocar con el teclado, y una vista de tabla equivalente.
import { api, formatCOP } from "./api.js";
import { can, initPanel, renderNoBusiness } from "./dashboard.js";
import { onLive } from "./notifications.js";
import { html, icon, render } from "./ui.js";

const TZ = "America/Bogota";

const POLICY_TEXT = {
  ACCEPTED: "pedidos aceptados (confirmados en adelante)",
  DELIVERED: "pedidos entregados",
  PAID: "pedidos marcados como pagados",
};

// ───────────────────────────── Fechas ─────────────────────────────

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function addDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const PRESETS = [
  { id: "today", label: "Hoy", range: () => ({ from: today(), to: today() }) },
  { id: "yesterday", label: "Ayer", range: () => ({ from: addDays(today(), -1), to: addDays(today(), -1) }) },
  { id: "7d", label: "Últimos 7 días", range: () => ({ from: addDays(today(), -6), to: today() }) },
  { id: "30d", label: "Últimos 30 días", range: () => ({ from: addDays(today(), -29), to: today() }) },
  { id: "month", label: "Este mes", range: () => ({ from: `${today().slice(0, 8)}01`, to: today() }) },
];

/** "2026-10-16" → "vie 16 oct" (fecha de calendario, sin conversión de zona). */
function dayLabel(date, { weekday = true } = {}) {
  const value = new Date(`${date}T12:00:00Z`);
  const text = new Intl.DateTimeFormat("es-CO", {
    ...(weekday ? { weekday: "short" } : {}),
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(value);
  return text.replaceAll(".", "").replace(",", "");
}

/** Etiquetas cortas del eje: "vie 16" (semana) o "16 oct" (periodos largos). */
function axisDay(date, long) {
  const parts = new Intl.DateTimeFormat("es-CO", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).formatToParts(
    new Date(`${date}T12:00:00Z`),
  );
  const part = (type) => (parts.find((item) => item.type === type)?.value ?? "").replace(".", "");
  return long ? `${part("day")} ${part("month")}` : `${part("weekday")} ${part("day")}`;
}

const hourLabel = (hour) => `${hour % 12 || 12} ${hour < 12 ? "a. m." : "p. m."}`;

/** Ejes: "$0", "$50 mil", "$1,2 M". */
const compact = new Intl.NumberFormat("es-CO", { notation: "compact", maximumFractionDigits: 1 });
const compactCOP = (value) => `$${compact.format(value)}`;

// ───────────────────────────── Estado ─────────────────────────────

const state = { preset: "today", data: null, loading: false };
let main;

async function load() {
  const { from, to } = PRESETS.find((preset) => preset.id === state.preset).range();
  state.loading = true;
  main.querySelector("[data-report]")?.classList.add("opacity-50");
  try {
    state.data = await api(`/analytics/summary?from=${from}&to=${to}`);
  } finally {
    state.loading = false;
  }
}

// ───────────────────────────── Indicadores ─────────────────────────────

function delta(current, previous, label) {
  if (!previous && !current) return html`<p class="text-sm text-muted">Sin datos ${label}</p>`;
  if (!previous) return html`<p class="text-sm text-muted">Sin ventas ${label}</p>`;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return html`<p class="text-sm text-muted">Igual que ${label}</p>`;
  const up = change > 0;
  return html`<p class="flex flex-wrap items-center gap-x-1 text-sm font-[620] ${up ? "text-leaf" : "text-tomato"}">
    <span class="inline-flex items-center gap-1 whitespace-nowrap">${icon(up ? "trending-up" : "trending-down", "h-4 w-4")} ${up ? "+" : "−"}${Math.abs(change)} %</span>
    <span class="font-normal text-muted">vs. ${label}</span>
  </p>`;
}

function previousLabel(data) {
  return data.range.days === 1 ? (state.preset === "today" ? "ayer" : "el día anterior") : `los ${data.range.days} días anteriores`;
}

function tiles(data) {
  const label = previousLabel(data);
  const tile = (title, value, extra) => html`<div class="panel flex min-w-0 flex-col gap-2 p-4 sm:p-5">
    <dt class="text-sm font-[620] text-muted">${title}</dt>
    <dd class="grid gap-1.5">
      <span class="truncate text-[1.75rem] leading-none font-[800] [font-stretch:80%] sm:text-[2.125rem]">${value}</span>
      ${extra}
    </dd>
  </div>`;
  const top = data.topProduct;
  return html`<dl class="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))] lg:gap-4">
    ${tile("Ventas", formatCOP(data.sales), delta(data.sales, data.previous.sales, label))}
    ${tile("Pedidos", String(data.orders.created), delta(data.orders.created, data.previous.created, label))}
    ${tile("Ticket promedio", formatCOP(data.averageTicket), delta(data.averageTicket, data.previous.averageTicket, label))}
    ${tile(
      "Producto más vendido",
      top ? top.name : "—",
      html`<p class="text-sm text-muted">${top ? `${top.quantity} ${top.quantity === 1 ? "unidad" : "unidades"} · ${formatCOP(top.revenue)}` : "Sin ventas en el periodo"}</p>`,
    )}
  </dl>`;
}

// ───────────────────────────── Gráfica de columnas (SVG) ─────────────────────────────

/** Escala "bonita": máximo redondeado y 4 divisiones. */
function niceScale(max) {
  if (max <= 0) return { max: 4, step: 1 };
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? 10 * power;
  return { max: step * 4, step };
}

/** Rectángulo con las esquinas superiores redondeadas (4px) y la base recta. */
function columnPath(x, y, width, height, radius = 4) {
  const r = Math.min(radius, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

/**
 * @param {{ key: string, axis: string, label: string, value: number, display: string, detail?: string }[]} points
 * @param {{ title: string, format: (n: number) => string, unit: string }} options
 */
function columnChart(container, points, options) {
  const width = Math.max(280, container.clientWidth);
  const height = 220;
  const margin = { top: 24, right: 8, bottom: 30, left: 56 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const { max, step } = niceScale(Math.max(...points.map((point) => point.value)));
  const slot = plotWidth / points.length;
  const barWidth = Math.max(3, Math.min(24, slot - 2 - Math.max(0, slot * 0.3)));
  const y = (value) => margin.top + plotHeight - (value / max) * plotHeight;
  const peak = points.reduce((best, point, index) => (point.value > (points[best]?.value ?? -1) ? index : best), -1);
  // Etiquetas del eje X sin chocar: una cada `every` columnas (mínimo ~44px entre etiquetas).
  const every = Math.max(1, Math.ceil(44 / slot));

  const ticks = Array.from({ length: 5 }, (_, index) => index * step);
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${options.title}" class="block overflow-visible">
      ${ticks
        .map(
          (tick) => `<line x1="${margin.left}" x2="${width - margin.right}" y1="${y(tick)}" y2="${y(tick)}" stroke="var(--color-line)" stroke-width="1" />
          <text x="${margin.left - 8}" y="${y(tick)}" dy="0.32em" text-anchor="end" class="fill-muted text-[11px] num">${options.format === formatCOP ? compactCOP(tick) : tick}</text>`,
        )
        .join("")}
      ${points
        .map((point, index) => {
          const x = margin.left + index * slot + (slot - barWidth) / 2;
          const top = y(point.value);
          const bar = point.value > 0 ? `<path d="${columnPath(x, top, barWidth, margin.top + plotHeight - top)}" class="chart-bar" />` : "";
          const axis =
            index % every === 0
              ? `<text x="${x + barWidth / 2}" y="${height - 10}" text-anchor="middle" class="fill-muted text-[11px]">${point.axis}</text>`
              : "";
          const peakLabel =
            index === peak && point.value > 0
              ? `<text x="${x + barWidth / 2}" y="${top - 8}" text-anchor="middle" class="fill-ink text-[12px] font-[700]">${point.display}</text>`
              : "";
          return `<g class="chart-col" tabindex="0" role="img" aria-label="${point.label}: ${point.display}${point.detail ? `, ${point.detail}` : ""}" data-index="${index}">
            <rect x="${margin.left + index * slot}" y="${margin.top}" width="${slot}" height="${plotHeight}" fill="transparent" />
            ${bar}${peakLabel}${axis}
          </g>`;
        })
        .join("")}
      <line x1="${margin.left}" x2="${width - margin.right}" y1="${margin.top + plotHeight}" y2="${margin.top + plotHeight}" stroke="var(--color-line-strong)" stroke-width="1" />
    </svg>
    <div class="chart-tooltip" hidden role="status"></div>`;
  container.innerHTML = svg;

  const tooltip = container.querySelector(".chart-tooltip");
  const show = (group) => {
    const point = points[Number(group.dataset.index)];
    tooltip.replaceChildren();
    const value = document.createElement("strong");
    value.textContent = point.display;
    const label = document.createElement("span");
    label.textContent = point.detail ? `${point.label} · ${point.detail}` : point.label;
    tooltip.append(value, label);
    tooltip.hidden = false;
    const bounds = container.getBoundingClientRect();
    const rect = group.querySelector("rect").getBoundingClientRect();
    const left = Math.min(Math.max(rect.left - bounds.left + rect.width / 2, 70), bounds.width - 70);
    tooltip.style.left = `${left}px`;
    container.querySelectorAll(".chart-col").forEach((column) => column.classList.toggle("is-active", column === group));
  };
  const hide = () => {
    tooltip.hidden = true;
    container.querySelectorAll(".chart-col").forEach((column) => column.classList.remove("is-active"));
  };
  container.querySelectorAll(".chart-col").forEach((group) => {
    group.addEventListener("pointerenter", () => show(group));
    group.addEventListener("focus", () => show(group));
    group.addEventListener("blur", hide);
  });
  container.addEventListener("pointerleave", hide);
}

function chartCard(id, title, subtitle, rows, headers) {
  return html`<section class="panel grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 p-4 sm:p-6" aria-labelledby="${id}-title">
    <div>
      <h2 id="${id}-title" class="text-lg font-[740]">${title}</h2>
      <p class="text-sm text-muted">${subtitle}</p>
    </div>
    <div class="relative min-w-0" data-chart="${id}"></div>
    <details class="text-sm">
      <summary class="w-fit cursor-pointer font-[620] text-muted hover:text-ink">Ver como tabla</summary>
      <div class="mt-3 max-h-72 overflow-auto rounded-[10px] border border-line">
        <table class="w-full text-left">
          <thead class="sticky top-0 bg-ground"><tr>${headers.map((header, index) => html`<th class="px-3 py-2 font-[650] ${index ? "text-right" : ""}">${header}</th>`)}</tr></thead>
          <tbody class="divide-y divide-line">
            ${rows.map((row) => html`<tr>${row.map((cell, index) => html`<td class="px-3 py-1.5 ${index ? "num text-right" : ""}">${cell}</td>`)}</tr>`)}
          </tbody>
        </table>
      </div>
    </details>
  </section>`;
}

// ───────────────────────────── Bloques ─────────────────────────────

function topProducts(data) {
  const max = Math.max(1, ...data.topProducts.map((product) => product.quantity));
  return html`<section class="panel p-4 sm:p-6" aria-labelledby="top-title">
    <h2 id="top-title" class="text-lg font-[740]">Productos más vendidos</h2>
    <p class="text-sm text-muted">Por unidades vendidas en el periodo.</p>
    ${data.topProducts.length === 0
      ? html`<p class="mt-4 text-[0.9375rem] text-muted">Aún no hay ventas en este periodo.</p>`
      : html`<ol class="mt-4 grid gap-3">
          ${data.topProducts.map(
            (product, index) => html`<li class="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
              <span class="num text-sm font-[750] text-muted">${index + 1}</span>
              <span class="min-w-0 leading-snug font-[620]">${product.name}</span>
              <span class="num text-right text-sm"><span class="font-[750]">${product.quantity}</span> und. <span class="text-muted">· ${formatCOP(product.revenue)}</span></span>
              <span></span>
              <span class="col-span-2 h-2.5 rounded-r-[4px] bg-[var(--color-chart)]" style="width: ${Math.max(2, (product.quantity / max) * 100)}%"></span>
            </li>`,
          )}
        </ol>`}
  </section>`;
}

function ordersBreakdown(data) {
  const { orders, delivery } = data;
  const row = (label, value, hint) => html`<div class="flex items-baseline justify-between gap-4 py-2.5">
    <dt><span class="font-[620]">${label}</span>${hint ? html`<span class="block text-sm text-muted">${hint}</span>` : ""}</dt>
    <dd class="num text-lg font-[760]">${value}</dd>
  </div>`;
  return html`<section class="panel p-4 sm:p-6" aria-labelledby="breakdown-title">
    <h2 id="breakdown-title" class="text-lg font-[740]">Pedidos del periodo</h2>
    <dl class="mt-2 divide-y divide-line">
      ${row("Registrados", orders.created, "Todas las solicitudes recibidas")}
      ${row("Aceptados", orders.accepted, "Confirmados por ti, sin cancelados")}
      ${row("Entregados", orders.delivered)}
      ${row("Pagados", orders.paid, "Marcados como pagados en el pedido")}
      ${row("Cancelados", orders.cancelled, "No cuentan como venta")}
      ${orders.pending ? row("Por confirmar", orders.pending) : ""}
    </dl>
    <p class="mt-3 rounded-[10px] bg-ground px-3.5 py-2.5 text-sm">
      ${icon("bike", "inline h-4 w-4 align-[-3px]")} Domicilio: <span class="num font-[700]">${delivery.delivery}</span> ·
      ${icon("shopping-bag", "inline h-4 w-4 align-[-3px]")} Recoger: <span class="num font-[700]">${delivery.pickup}</span>
      <span class="text-muted">(ventas del periodo)</span>
    </p>
  </section>`;
}

function report(data) {
  const multiDay = data.range.days > 1;
  const peakHour = data.byHour.reduce((best, entry) => (entry.orders > best.orders ? entry : best), { hour: 0, orders: 0 });
  return html`<div class="grid grid-cols-[minmax(0,1fr)] gap-6 transition-opacity" data-report>
    ${tiles(data)}
    <p class="text-sm text-muted">
      Ventas = ${POLICY_TEXT[data.salesPolicy]}. Un pedido cancelado nunca cuenta.
      <a class="font-[650] text-ink" href="/panel/configuracion#ventas">Cambiar</a>
    </p>
    <div class="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
        ${multiDay
          ? chartCard(
              "by-day",
              "Ventas por día",
              `${dayLabel(data.range.from, { weekday: false })} – ${dayLabel(data.range.to, { weekday: false })} · hora de Colombia`,
              data.byDay.map((day) => [dayLabel(day.date), formatCOP(day.sales), String(day.orders)]),
              ["Día", "Ventas", "Pedidos"],
            )
          : ""}
        ${chartCard(
          "by-hour",
          "Horas pico",
          peakHour.orders > 0 ? `Más pedidos a las ${hourLabel(peakHour.hour)} · pedidos que cuentan como venta` : "Pedidos por hora del día",
          data.byHour.filter((entry) => entry.orders > 0).map((entry) => [hourLabel(entry.hour), String(entry.orders)]),
          ["Hora", "Pedidos"],
        )}
      </div>
      <div class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">${topProducts(data)} ${ordersBreakdown(data)}</div>
    </div>
  </div>`;
}

function drawCharts() {
  const data = state.data;
  const byDay = main.querySelector('[data-chart="by-day"]');
  if (byDay) {
    columnChart(
      byDay,
      data.byDay.map((day) => ({
        key: day.date,
        // Hasta 7 días: "vie 16"; periodos largos: "16 oct".
        axis: axisDay(day.date, data.range.days > 7),
        label: dayLabel(day.date),
        value: day.sales,
        display: formatCOP(day.sales),
        detail: `${day.orders} ${day.orders === 1 ? "pedido" : "pedidos"}`,
      })),
      { title: "Ventas por día", format: formatCOP },
    );
  }
  const byHour = main.querySelector('[data-chart="by-hour"]');
  if (byHour) {
    // Se muestran las horas con actividad del día típico de comida rápida (de 6 a. m. a 5 a. m.).
    const hours = [...data.byHour.slice(6), ...data.byHour.slice(0, 6)];
    columnChart(
      byHour,
      hours.map((entry) => ({
        key: String(entry.hour),
        axis: `${entry.hour % 12 || 12}${entry.hour < 12 ? "a" : "p"}`,
        label: hourLabel(entry.hour),
        value: entry.orders,
        display: `${entry.orders} ${entry.orders === 1 ? "pedido" : "pedidos"}`,
      })),
      { title: "Pedidos por hora", format: (value) => String(value) },
    );
  }
}

function page() {
  return html`<div class="grid grid-cols-[minmax(0,1fr)] gap-6">
    <header>
      <h1 class="text-[1.875rem] leading-tight font-[780] sm:text-[2.375rem]">Analíticas</h1>
      <p class="mt-1 text-[0.9375rem] text-muted">${state.business.name} · hora de Colombia</p>
    </header>
    <div class="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Periodo">
      ${PRESETS.map(
        (preset) => html`<button type="button" class="cat-chip flex-none" aria-pressed="${preset.id === state.preset}" aria-current="${preset.id === state.preset}" data-preset="${preset.id}">
          ${preset.label}
        </button>`,
      )}
    </div>
    <div data-report-slot>${report(state.data)}</div>
  </div>`;
}

function draw() {
  render(main, page());
  drawCharts();
}

async function select(preset) {
  state.preset = preset;
  main.querySelectorAll("[data-preset]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.preset === preset));
    button.setAttribute("aria-current", String(button.dataset.preset === preset));
  });
  try {
    await load();
    render(main.querySelector("[data-report-slot]"), report(state.data));
    drawCharts();
  } catch (error) {
    main.querySelector("[data-report]")?.classList.remove("opacity-50");
    render(main.querySelector("[data-report-slot]"), html`<p class="panel p-6 text-tomato">${error.message}</p>`);
  }
}

// ───────────────────────────── Arranque ─────────────────────────────

const context = await initPanel("analiticas");
if (context) {
  main = context.main;
  if (!context.business) {
    renderNoBusiness(main);
  } else if (!can(context.business, "viewAnalytics")) {
    render(
      main,
      html`<p class="panel mx-auto mt-6 flex max-w-lg items-start gap-3 p-6 text-[0.9375rem]">
        ${icon("lock", "mt-0.5")} El propietario no te dio permiso para ver las analíticas. Si lo necesitas, pídeselo: él lo activa en
        Configuración → Equipo.
      </p>`,
    );
  } else {
    state.business = context.business;
    render(main, html`<div class="grid gap-6" aria-busy="true" aria-label="Cargando analíticas"><div class="skeleton h-12 w-56"></div><div class="grid grid-cols-2 gap-3 lg:grid-cols-4"><div class="skeleton h-28"></div><div class="skeleton h-28"></div><div class="skeleton h-28"></div><div class="skeleton h-28"></div></div><div class="skeleton h-72"></div></div>`);
    try {
      await load();
      draw();
      main.addEventListener("click", (event) => {
        const button = event.target.closest("[data-preset]");
        if (button && !state.loading) select(button.dataset.preset);
      });
      // Las gráficas se ajustan al ancho disponible.
      let resizeTimer;
      new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(drawCharts, 120);
      }).observe(main);
      // Un pedido nuevo o un cambio de estado actualiza las cifras si el periodo incluye hoy.
      let liveTimer;
      const refresh = () => {
        if (state.data.range.to !== today()) return;
        clearTimeout(liveTimer);
        liveTimer = setTimeout(() => select(state.preset), 800);
      };
      onLive("created", refresh);
      onLive("updated", refresh);
    } catch (error) {
      render(main, html`<p class="text-tomato">${error.message}</p>`);
    }
  }
}
