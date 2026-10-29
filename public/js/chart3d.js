// Gráficas de columnas en 3D (panel central de Pedify). Sin librerías: cada columna es un prisma de
// CSS 3D sobre un piso, con las líneas de valores en la pared del fondo. Se gira arrastrando (o con
// las vistas «3D», «De frente» y «Desde arriba»); el mouse, el dedo o las flechas del teclado muestran
// el valor de cada columna. Las caras se sombrean según hacia dónde miran (luz fija arriba a la
// izquierda). Cada gráfica tiene además su tabla con los mismos datos («Ver como tabla», en admin.js).
import { escapeHtml } from "./ui.js";

const VIEWS = {
  iso: { label: "3D", pitch: 58, yaw: -28 },
  front: { label: "De frente", pitch: 80, yaw: 0 },
  top: { label: "Desde arriba", pitch: 0, yaw: 0 },
};
/** Normal de cada cara antes de girar (x a la derecha, y hacia el frente del piso, z hacia arriba). */
const FACES = { top: [0, 0, 1], front: [0, 1, 0], back: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0] };
const LIGHT = (() => {
  const vector = [-0.45, -0.7, 0.55]; // pantalla: y hacia abajo, z hacia quien mira
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
})();
const YAW_LIMIT = 75;
const PITCH_MAX = 86;
/** Por debajo de esta inclinación se ve desde arriba: sin pared ni marcas de valores. */
const FLAT_BELOW = 14;

/** Gráficas que ya hicieron su entrada (al redibujarse no se animan otra vez). */
const entered = new Set();

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Escala "bonita": máximo redondeado y 4 divisiones. */
function niceScale(max) {
  if (max <= 0) return { max: 4, step: 1 };
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? 10 * power;
  return { max: step * 4, step };
}

/** Cuánto se oscurece cada cara (en %) con la cámara en (inclinación, giro), con las mismas rotaciones de CSS. */
function shading(pitch, yaw) {
  const p = (pitch * Math.PI) / 180;
  const y = (yaw * Math.PI) / 180;
  return Object.fromEntries(
    Object.entries(FACES).map(([face, [x0, y0, z0]]) => {
      const x1 = x0 * Math.cos(y) - y0 * Math.sin(y);
      const y1 = x0 * Math.sin(y) + y0 * Math.cos(y);
      const y2 = y1 * Math.cos(p) - z0 * Math.sin(p);
      const z2 = y1 * Math.sin(p) + z0 * Math.cos(p);
      const light = Math.max(0, x1 * LIGHT[0] + y2 * LIGHT[1] + z2 * LIGHT[2]);
      return [face, `${Math.round((1 - (0.4 + 0.6 * light)) * 82)}%`];
    }),
  );
}

/** Prisma de una columna (o de un tramo de una columna apilada). */
function prism({ x, y, w, d, h, z0, color, index, wave, zero }) {
  return `<div class="b3${zero ? " is-zero" : ""}" data-cell="${index}" style="left:${x}px;top:${y}px;width:${w}px;height:${d}px;--h:${h}px;--z0:${z0}px;--c:${color};--i:${wave}">
    <i class="f-back"></i><i class="f-left"></i><i class="f-right"></i><i class="f-front"></i><i class="f-top"></i>
  </div>`;
}

/** Texto que siempre mira a la cámara, anclado a un punto del piso (y a una altura). */
const billboard = (className, { x, y, z = 0, tx = "-50%", ty = "0" }, text) =>
  `<span class="c3d-bb ${className}" style="left:${x}px;top:${y}px;--z:${z}px;--tx:${tx};--ty:${ty}">${escapeHtml(text)}</span>`;

/**
 * Monta una gráfica de columnas 3D en `container`.
 *
 * @param {HTMLElement} container
 * @param {{
 *   key: string,                 // identifica la gráfica (para animar su entrada una sola vez)
 *   label: string,               // qué muestra, para el lector de pantalla
 *   cols: string[],              // etiquetas del eje horizontal
 *   rows?: string[],             // filas de fondo (matriz); si falta, una sola fila
 *   cells: { col: number, row?: number, segments: { value: number, color: string, name?: string }[], title: string, detail?: string }[],
 *   format: (value: number) => string,
 *   tick?: (value: number) => string,
 *   colLabel?: (index: number) => string | null,
 *   rowLabel?: (index: number) => string | null,
 *   views?: (keyof typeof VIEWS)[],
 *   maxSlot?: number,            // ancho máximo de cada columna (px)
 *   height?: number,
 *   empty?: string,              // mensaje si todos los valores son 0
 * }} spec
 */
export function chart3d(container, spec) {
  const views = spec.views ?? ["iso", "front"];
  let { pitch, yaw } = VIEWS[views[0]];
  let width = 0;
  let active = -1;
  let drag = null;
  /** Escala y desplazamiento para que todo quepa centrado en el recuadro. */
  let fitScale = 1;
  let shift = { x: 0, y: 0 };

  const cols = spec.cols.length;
  const rows = spec.rows?.length ?? 1;
  const matrix = rows > 1;
  const totals = spec.cells.map((cell) => cell.segments.reduce((sum, segment) => sum + segment.value, 0));
  const peak = totals.reduce((best, total, index) => (total > (totals[best] ?? 0) ? index : best), -1);
  const scale = niceScale(Math.max(0, ...totals));
  const ticks = Array.from({ length: 5 }, (_, index) => index * scale.step);
  const tick = spec.tick ?? spec.format;

  container.classList.add("c3d");
  container.classList.toggle("is-empty", totals.every((total) => total === 0));
  container.innerHTML = `
    <div class="c3d-bar">
      <p class="c3d-hint" aria-hidden="true">Arrastra para girar</p>
      ${
        views.length > 1
          ? `<div class="c3d-views" role="group" aria-label="Vista de la gráfica">
              ${views.map((view) => `<button type="button" data-view="${view}" aria-pressed="false">${VIEWS[view].label}</button>`).join("")}
            </div>`
          : ""
      }
    </div>
    <div class="c3d-stage" tabindex="0" role="group" aria-roledescription="gráfica 3D"
      aria-label="${escapeHtml(spec.label)}. Usa las flechas para recorrer los valores; también están en la tabla.">
      <div class="c3d-world"></div>
    </div>
    ${totals.every((total) => total === 0) && spec.empty ? `<p class="c3d-empty">${escapeHtml(spec.empty)}</p>` : ""}
    <div class="chart-tooltip" hidden role="status"></div>`;
  const stage = container.querySelector(".c3d-stage");
  const world = container.querySelector(".c3d-world");
  const tooltip = container.querySelector(".chart-tooltip");

  function build() {
    width = container.clientWidth;
    const phone = width < 520;
    const stageHeight = spec.height ?? (phone ? 270 : 330);
    const usable = Math.max(220, width - (matrix ? (phone ? 96 : 150) : phone ? 70 : 120));
    const slot = Math.min(usable / cols, spec.maxSlot ?? 64);
    const floorWidth = slot * cols;
    const barWidth = Math.max(4, Math.min(slot * (matrix ? 0.64 : 0.5), 46));
    const slotDepth = matrix ? Math.max(Math.min(slot, 40), phone ? 18 : 0) : Math.max(barWidth * 1.9, 44);
    const floorDepth = slotDepth * rows;
    const barDepth = matrix ? Math.max(4, slotDepth * 0.64) : barWidth;
    const maxHeight = stageHeight * (matrix ? 0.4 : 0.5);
    const px = maxHeight / scale.max;
    const every = Math.max(1, Math.ceil((phone ? 40 : 46) / slot));

    stage.style.setProperty("--c3d-h", `${stageHeight}px`);
    world.style.width = `${floorWidth}px`;
    world.style.height = `${floorDepth}px`;

    const bars = spec.cells
      .map((cell, index) => {
        const row = cell.row ?? 0;
        const x = cell.col * slot + (slot - barWidth) / 2;
        const y = row * slotDepth + (slotDepth - barDepth) / 2;
        const wave = cell.col + row * 2;
        if (totals[index] === 0) return prism({ x, y, w: barWidth, d: barDepth, h: 0, z0: 0, color: "transparent", index, wave, zero: true });
        let z0 = 0;
        const parts = cell.segments.filter((segment) => segment.value > 0);
        return parts
          .map((segment, part) => {
            const full = segment.value * px;
            // 2 px de separación entre tramos apilados (sin trazos alrededor de las marcas).
            const h = part < parts.length - 1 && full > 4 ? full - 2 : Math.max(full, 1.5);
            const html = prism({ x, y, w: barWidth, d: barDepth, h, z0, color: segment.color, index, wave });
            z0 += full;
            return html;
          })
          .join("");
      })
      .join("");

    const colLabels = spec.cols
      .map((label, index) => {
        // Contadas desde la última columna, para que siempre tenga nombre (el mes o el día actual).
        const text = spec.colLabel ? spec.colLabel(index) : (cols - 1 - index) % every === 0 ? label : null;
        if (!text) return "";
        return billboard("c3d-col", { x: index * slot + slot / 2, y: floorDepth + 14 }, text);
      })
      .join("");
    const rowLabels = matrix
      ? spec.rows
          .map((label, row) => {
            const text = spec.rowLabel ? spec.rowLabel(row) : label;
            return text ? billboard("c3d-row", { x: -14, y: row * slotDepth + slotDepth / 2, tx: "-100%", ty: "-50%" }, text) : "";
          })
          .join("")
      : "";
    // En una matriz, los valores van en la esquina de atrás a la derecha (a la izquierda están los días).
    const tickAnchor = matrix ? { x: floorWidth + 14, tx: "0" } : { x: -14, tx: "-100%" };
    const tickLabels = ticks.map((value) => billboard("c3d-tick", { ...tickAnchor, y: -10, z: value * px, ty: "-50%" }, tick(value))).join("");
    const lines = ticks.map((value) => `<i style="top:${value * px}px"></i>`).join("");
    const peakCell = spec.cells[peak];
    const peakLabel =
      peak >= 0 && !matrix
        ? billboard(
            "c3d-peak",
            // Sobre el borde de atrás de la columna, para no tapar su cara de arriba.
            { x: peakCell.col * slot + slot / 2, y: (peakCell.row ?? 0) * slotDepth + (slotDepth - barDepth) / 2, z: totals[peak] * px + 8, ty: "-100%" },
            spec.format(totals[peak]),
          )
        : "";

    world.innerHTML = `<div class="c3d-floor"></div>
      <div class="c3d-wall" style="height:${maxHeight}px">${lines}</div>
      ${bars}${colLabels}${rowLabels}${tickLabels}${peakLabel}`;
    if (active >= 0) mark(active);
  }

  function apply() {
    world.style.setProperty("--pitch", `${pitch}deg`);
    world.style.setProperty("--yaw", `${yaw}deg`);
    for (const [face, amount] of Object.entries(shading(pitch, yaw))) world.style.setProperty(`--s-${face}`, amount);
    container.classList.toggle("is-flat", pitch < FLAT_BELOW);
    for (const button of container.querySelectorAll("[data-view]")) {
      const view = VIEWS[button.dataset.view];
      button.setAttribute("aria-pressed", String(view.pitch === pitch && view.yaw === yaw));
    }
  }

  function place() {
    world.style.setProperty("--fit", String(fitScale));
    world.style.setProperty("--dx", `${shift.x}px`);
    world.style.setProperty("--dy", `${shift.y}px`);
  }

  /** Lo que ocupa la gráfica en pantalla: piso, pared, columnas y textos. */
  function contentBox() {
    const rects = [...world.querySelectorAll(".c3d-floor, .c3d-wall, .c3d-bb, .f-top")].map((element) => element.getBoundingClientRect()).filter((rect) => rect.width || rect.height);
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    return { left, top, width: Math.max(...rects.map((rect) => rect.right)) - left, height: Math.max(...rects.map((rect) => rect.bottom)) - top };
  }

  /** Achica (nunca agranda) y centra la gráfica para la vista actual; los textos conservan su tamaño. */
  function fit() {
    fitScale = 1;
    shift = { x: 0, y: 0 };
    place();
    for (let pass = 0; pass < 2; pass += 1) {
      const area = stage.getBoundingClientRect();
      const box = contentBox();
      if (!box.width || !box.height) return;
      fitScale = Math.min(1, fitScale * Math.min((area.width - 24) / box.width, (area.height - 20) / box.height));
      shift = { x: shift.x + area.left + area.width / 2 - (box.left + box.width / 2), y: shift.y + area.top + area.height / 2 - (box.top + box.height / 2) };
      place();
    }
  }

  /** Cambia de vista con una transición: mide cómo queda al final y anima desde donde está. */
  function turnTo(view) {
    const from = { pitch, yaw, fitScale, shift };
    ({ pitch, yaw } = VIEWS[view]);
    apply();
    fit();
    if (reducedMotion()) return;
    const to = { pitch, yaw, fitScale, shift };
    ({ pitch, yaw, fitScale, shift } = from);
    apply();
    place();
    void world.offsetWidth;
    container.classList.add("is-turning");
    ({ pitch, yaw, fitScale, shift } = to);
    apply();
    place();
    clearTimeout(turnTo.timer);
    turnTo.timer = setTimeout(() => container.classList.remove("is-turning"), 720);
  }

  // ─── Valores: mouse, dedo y teclado ───

  function mark(index) {
    world.querySelectorAll(".b3.is-active").forEach((bar) => bar.classList.remove("is-active"));
    world.querySelectorAll(`[data-cell="${index}"]`).forEach((bar) => bar.classList.add("is-active"));
  }

  function show(index, point) {
    const cell = spec.cells[index];
    if (!cell) return;
    active = index;
    mark(index);
    tooltip.replaceChildren();
    const value = document.createElement("strong");
    value.textContent = spec.format(totals[index]);
    const label = document.createElement("span");
    label.textContent = cell.detail ? `${cell.title} · ${cell.detail}` : cell.title;
    tooltip.append(value, label);
    if (cell.segments.length > 1) {
      for (const segment of cell.segments.filter((part) => part.value > 0)) {
        const row = document.createElement("span");
        row.className = "c3d-key";
        const key = document.createElement("i");
        key.style.background = segment.color;
        row.append(key, document.createTextNode(`${segment.name}: ${spec.format(segment.value)}`));
        tooltip.append(row);
      }
    }
    tooltip.hidden = false;
    const bounds = container.getBoundingClientRect();
    let anchor = point;
    if (!anchor) {
      const tops = [...world.querySelectorAll(`[data-cell="${index}"] .f-top`)].map((face) => face.getBoundingClientRect());
      const top = tops.reduce((best, rect) => (rect.top < best.top ? rect : best), tops[0]);
      anchor = { x: top.left + top.width / 2, y: top.top };
    }
    const half = tooltip.offsetWidth / 2 + 4;
    tooltip.style.left = `${clamp(anchor.x - bounds.left, half, Math.max(half, bounds.width - half))}px`;
    tooltip.style.top = `${Math.max(tooltip.offsetHeight + 4, anchor.y - bounds.top - 12)}px`;
  }

  function hide() {
    active = -1;
    tooltip.hidden = true;
    world.querySelectorAll(".b3.is-active").forEach((bar) => bar.classList.remove("is-active"));
  }

  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, pitch, yaw, moved: false, touch: event.pointerType !== "mouse" };
  });
  stage.addEventListener("pointermove", (event) => {
    if (drag && drag.id === event.pointerId) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        stage.setPointerCapture(event.pointerId);
        container.classList.add("is-dragging");
        hide();
      }
      yaw = clamp(drag.yaw + dx * 0.35, -YAW_LIMIT, YAW_LIMIT);
      if (!drag.touch) pitch = clamp(drag.pitch - dy * 0.3, 0, PITCH_MAX);
      apply();
      return;
    }
    const bar = event.target.closest?.("[data-cell]");
    if (bar) show(Number(bar.dataset.cell), { x: event.clientX, y: event.clientY });
    else if (active >= 0) hide();
  });
  const release = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const tapped = !drag.moved;
    drag = null;
    container.classList.remove("is-dragging");
    // En el celular, tocar una columna muestra su valor.
    if (tapped && event.type === "pointerup") {
      const bar = event.target.closest?.("[data-cell]");
      if (bar) show(Number(bar.dataset.cell), { x: event.clientX, y: event.clientY });
    }
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
  stage.addEventListener("pointerleave", (event) => {
    if (!drag && event.pointerType === "mouse") hide();
  });

  // Flechas: recorren las columnas (y las filas en una matriz); Inicio/Fin van a los extremos.
  const at = (col, row) => spec.cells.findIndex((cell) => cell.col === col && (cell.row ?? 0) === row);
  stage.addEventListener("keydown", (event) => {
    const current = spec.cells[active] ?? null;
    const col = current?.col ?? -1;
    const row = current?.row ?? 0;
    const moves = {
      ArrowRight: [Math.min(cols - 1, col + 1), row],
      ArrowLeft: [Math.max(0, col - 1), row],
      ArrowUp: [Math.max(0, col), Math.max(0, row - 1)],
      ArrowDown: [Math.max(0, col), Math.min(rows - 1, row + 1)],
      Home: [0, row],
      End: [cols - 1, row],
    };
    if (event.key === "Escape") return hide();
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const index = at(move[0], move[1]);
    if (index >= 0) show(index);
  });
  stage.addEventListener("blur", hide);

  container.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => turnTo(button.dataset.view)));

  build();
  apply();
  fit();
  if (!entered.has(spec.key) && !reducedMotion()) {
    container.classList.add("is-entering");
    setTimeout(() => container.classList.remove("is-entering"), 1500);
  }
  entered.add(spec.key);

  // Se rehace al cambiar el ancho (girar el celular, abrir el menú…), sin perder la vista.
  let pending = 0;
  const observer = new ResizeObserver(() => {
    if (!container.isConnected) return observer.disconnect();
    if (Math.abs(container.clientWidth - width) < 4 || pending) return;
    // En el siguiente cuadro, no dentro del aviso (si no, el navegador avisa de un ciclo de ResizeObserver).
    pending = requestAnimationFrame(() => {
      pending = 0;
      build();
      fit();
    });
  });
  observer.observe(container);
}
