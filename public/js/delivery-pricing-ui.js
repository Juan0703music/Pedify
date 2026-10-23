// Domicilio según la distancia (Configuración → Entrega): la ubicación del negocio en el mapa, los
// rangos «hasta X km → $Y» y, más lejos, un valor por cada km adicional para llegar a toda la ciudad.
// El servidor recalcula el valor de cada pedido con la ubicación que comparte el cliente (en línea recta
// desde el negocio). Una vista previa muestra lo que pagaría un cliente a 1, 3, 5, 8, 12 y 20 km.
import { formatCOP, formatThousands, parseMoney } from "./api.js";
import { deliveryReachKm, feeForDistance, formatKm, MAX_DELIVERY_KM } from "./delivery-fee.js";
import { currentPosition, pickerMap } from "./map.js";
import { html, icon, render, setBusy, toast } from "./ui.js";

const MAX_TIERS = 8;
/**
 * Valores sugeridos (2026), pensados para cualquier ciudad: en las pequeñas casi todo queda en los
 * primeros rangos ($4.000–$8.500) y en las grandes cada km adicional suma $1.000, por debajo de lo que
 * cobran las empresas de mensajería ($800–$1.500 por km y $8.000–$12.000 hasta 5 km en Bogotá).
 */
const DEFAULT_TIERS = [
  { upToKm: 2, fee: 4000 },
  { upToKm: 4, fee: 5500 },
  { upToKm: 6, fee: 7000 },
  { upToKm: 8, fee: 8500 },
];
const DEFAULT_EXTRA_KM_FEE = 1000;
/** Distancias de ejemplo para la vista previa. */
const PREVIEW_KM = [1, 3, 5, 8, 12, 20];
/** Centro de Sincelejo: donde empieza el mapa si el negocio aún no marcó su ubicación. */
const DEFAULT_CENTER = { lat: 9.3047, lng: -75.3978 };

const parseKm = (text) => Number.parseFloat(String(text).trim().replace(",", "."));

/** Elección del cobro: tarifa fija o según la distancia (tarjetas como las del registro). */
export function pricingChoice(settings, disabled) {
  const option = (value, title, text) => html`<label class="role-option">
    <input type="radio" name="deliveryPricing" value="${value}" ${settings.deliveryPricing === value ? "checked" : ""} ${disabled ? "disabled" : ""} />
    <span class="role-check" aria-hidden="true"></span>
    <span class="font-[740]">${title}</span>
    <span class="text-sm leading-snug text-muted">${text}</span>
  </label>`;
  return html`<fieldset class="grid gap-2">
    <legend class="label mb-2">Cómo cobras el domicilio</legend>
    <div class="grid gap-2 sm:grid-cols-2" data-error-anchor="deliveryPricing">
      ${option("FIXED", "Tarifa fija", "El mismo valor para todos tus clientes.")}
      ${option("DISTANCE", "Según la distancia", "Más cerca, más barato: se calcula con la ubicación del cliente.")}
    </div>
  </fieldset>`;
}

function tierRow(tier, index, disabled) {
  return html`<li class="grid grid-cols-[auto_5.5rem_minmax(0,1fr)_auto] items-center gap-2" data-tier>
    <span class="text-sm text-muted">Hasta</span>
    <div class="input-group">
      <input class="input num px-2.5" inputmode="decimal" autocomplete="off" value="${formatKm(tier.upToKm)}" data-tier-km aria-label="Rango ${index + 1}: hasta cuántos kilómetros" ${disabled ? "disabled" : ""} />
      <span class="addon">km</span>
    </div>
    <div class="input-group">
      <span class="addon">$</span>
      <input class="input num" inputmode="numeric" autocomplete="off" data-money value="${formatThousands(tier.fee)}" data-tier-fee aria-label="Rango ${index + 1}: valor del domicilio" ${disabled ? "disabled" : ""} />
    </div>
    <button type="button" class="btn btn-quiet btn-icon text-muted hover:text-tomato" data-remove-tier aria-label="Quitar el rango ${index + 1}" ${disabled ? "disabled" : ""}>${icon("trash-2")}</button>
  </li>`;
}

/** Opción «Hasta dónde llevas» (tarjeta como las del registro). */
function reachOption(value, checked, title, text, disabled) {
  return html`<label class="role-option">
    <input type="radio" name="deliveryReach" value="${value}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
    <span class="role-check" aria-hidden="true"></span>
    <span class="font-[740]">${title}</span>
    <span class="text-sm leading-snug text-muted">${text}</span>
  </label>`;
}

/** Ubicación del negocio, rangos, km adicional y alcance (se muestra al elegir «Según la distancia»). */
export function distanceFields(settings, disabled) {
  // Sin configurar todavía: los valores sugeridos, llegando a toda la ciudad.
  const fresh = settings.deliveryTiers.length === 0;
  const tiers = fresh ? DEFAULT_TIERS : settings.deliveryTiers;
  const extraOn = fresh || settings.deliveryExtraKmFee !== null;
  const extraFee = settings.deliveryExtraKmFee ?? DEFAULT_EXTRA_KM_FEE;
  const limited = !fresh && settings.deliveryMaxKm !== null;
  return html`<div class="grid gap-6">
    <div class="grid gap-2">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <p class="label">Ubicación de tu negocio</p>
        <button type="button" class="text-sm font-[650] underline underline-offset-2" data-locate-business data-relocate ${settings.location ? "" : "hidden"} ${disabled ? "disabled" : ""}>${icon("locate-fixed", "mr-1 inline h-4 w-4 align-[-3px]")}Usar mi ubicación actual</button>
      </div>
      <div class="relative h-60 overflow-hidden rounded-[12px] border border-line bg-ground" data-business-map></div>
      <input type="hidden" name="location" />
      <p class="hint">Arrastra el marcador hasta la puerta de tu negocio o toca el mapa. Desde ahí se mide la distancia.</p>
    </div>
    <div class="grid gap-2">
      <p class="label" id="tiers-label">Valor según la distancia</p>
      <ol class="grid max-w-[32rem] gap-2" data-tiers aria-labelledby="tiers-label">${tiers.map((tier, index) => tierRow(tier, index, disabled))}</ol>
      <input type="hidden" name="deliveryTiers" />
      <button type="button" class="btn btn-ghost btn-sm w-fit" data-add-tier ${disabled ? "disabled" : ""}>${icon("plus", "h-4 w-4")} Agregar rango</button>
    </div>
    <div class="grid gap-3 rounded-[12px] border border-line p-4">
      <label class="flex cursor-pointer items-start justify-between gap-4" for="d-extra">
        <span class="grid gap-0.5">
          <span class="font-[650]">Más lejos, cobrar por kilómetro</span>
          <span class="text-sm text-muted">Así llegas a toda la ciudad: después del último rango se suma un valor por cada km.</span>
        </span>
        <input type="checkbox" role="switch" class="switch mt-0.5" id="d-extra" data-extra-enabled ${extraOn ? "checked" : ""} ${disabled ? "disabled" : ""} />
      </label>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2" data-extra-fields ${extraOn ? "" : "hidden"}>
        <label class="text-sm text-muted" for="d-extra-fee">Cada km adicional</label>
        <div class="input-group w-36">
          <span class="addon">$</span>
          <input class="input num" id="d-extra-fee" name="deliveryExtraKmFee" inputmode="numeric" autocomplete="off" data-money value="${formatThousands(extraFee)}" ${disabled ? "disabled" : ""} />
        </div>
      </div>
    </div>
    <fieldset class="grid gap-2">
      <legend class="label mb-2">Hasta dónde llevas</legend>
      <div class="grid gap-2 sm:grid-cols-2">
        ${reachOption("CITY", !limited, "Toda la ciudad", `Sin límite dentro de tu ciudad (hasta ${MAX_DELIVERY_KM} km en línea recta).`, disabled)}
        ${reachOption("LIMIT", limited, "Hasta una distancia", "Solo hasta los kilómetros que elijas.", disabled)}
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1" data-max-fields ${limited ? "" : "hidden"}>
        <label class="text-sm text-muted" for="d-max-km">Llevo hasta</label>
        <div class="input-group w-32">
          <input class="input num px-2.5" id="d-max-km" name="deliveryMaxKm" inputmode="decimal" autocomplete="off" value="${formatKm(settings.deliveryMaxKm ?? 10)}" ${disabled ? "disabled" : ""} />
          <span class="addon">km</span>
        </div>
      </div>
    </fieldset>
    <div class="grid gap-2 rounded-[12px] bg-ground p-4" aria-live="polite">
      <p class="text-sm font-[700]">Así le cobras a tus clientes</p>
      <ul class="flex flex-wrap gap-2" data-fee-preview></ul>
      <p class="hint" data-tiers-summary></p>
    </div>
  </div>`;
}

/**
 * Activa el editor dentro del formulario de Entrega: el mapa, los rangos y el cambio de modo.
 * Devuelve `read()` con lo que se envía al guardar.
 */
export function mountDistancePricing(form, settings) {
  let location = settings.location;
  let picker = null;
  const mapBox = form.querySelector("[data-business-map]");
  const list = form.querySelector("[data-tiers]");
  const mode = () => form.querySelector('[name="deliveryPricing"]:checked')?.value ?? "FIXED";
  // Mover el marcador también cuenta como un cambio sin guardar.
  const touched = () => form.querySelector('[name="location"]').dispatchEvent(new Event("change", { bubbles: true }));

  const readTiers = () =>
    [...list.querySelectorAll("[data-tier]")].map((row) => ({
      upToKm: parseKm(row.querySelector("[data-tier-km]").value),
      fee: parseMoney(row.querySelector("[data-tier-fee]").value),
    }));

  const extraEnabled = () => form.querySelector("[data-extra-enabled]").checked;
  const limited = () => form.querySelector('[name="deliveryReach"]:checked')?.value === "LIMIT";
  const pricing = () => ({
    tiers: readTiers()
      .filter((tier) => Number.isFinite(tier.upToKm))
      .sort((a, b) => a.upToKm - b.upToKm),
    extraKmFee: extraEnabled() ? parseMoney(form.elements.deliveryExtraKmFee.value) : null,
    maxKm: limited() ? parseKm(form.elements.deliveryMaxKm.value) || null : null,
  });

  /** Vista previa: lo que pagaría un cliente a varias distancias y hasta dónde llega el domicilio. */
  const summarize = () => {
    const current = pricing();
    const reach = current.tiers.length > 0 ? deliveryReachKm(current) : 0;
    render(
      form.querySelector("[data-fee-preview]"),
      html`${PREVIEW_KM.map((km) => {
        const fee = current.tiers.length > 0 ? feeForDistance(current, km * 1000) : null;
        return html`<li class="rounded-full px-3 py-1.5 text-sm ${fee === null ? "bg-paper text-muted line-through" : "bg-paper font-[650]"}">
          <span class="text-muted">${km} km</span> · <span class="num">${fee === null ? "no llega" : formatCOP(fee)}</span>
        </li>`;
      })}`,
    );
    form.querySelector("[data-tiers-summary]").textContent =
      `Se mide en línea recta desde tu negocio hasta la ubicación que comparte el cliente. ` +
      (current.extraKmFee !== null && current.maxKm === null
        ? "Llegas a toda la ciudad."
        : reach > 0
          ? `Más lejos de ${formatKm(reach)} km no se ofrece domicilio.`
          : "");
    form.querySelector("[data-add-tier]").hidden = list.children.length >= MAX_TIERS;
    form.querySelector("[data-extra-fields]").hidden = !extraEnabled();
    form.querySelector("[data-max-fields]").hidden = !limited();
  };

  const renumber = () => {
    const tiers = readTiers();
    render(list, html`${tiers.map((tier, index) => tierRow({ upToKm: Number.isFinite(tier.upToKm) ? tier.upToKm : "", fee: tier.fee }, index, false))}`);
    summarize();
  };

  const drawMap = async () => {
    if (picker || mode() !== "DISTANCE") return picker?.invalidate();
    if (!location) {
      render(
        mapBox,
        html`<div class="grid h-full place-content-center justify-items-center gap-3 p-4 text-center">
          <span class="grid h-11 w-11 place-items-center rounded-full bg-mustard-soft text-ink">${icon("store")}</span>
          <p class="max-w-[24rem] text-sm text-muted">Marca dónde queda tu negocio para medir la distancia hasta cada cliente.</p>
          <div class="flex flex-wrap justify-center gap-2">
            <button type="button" class="btn btn-ink btn-sm" data-locate-business>${icon("locate-fixed", "h-4 w-4")} Usar mi ubicación actual</button>
            <button type="button" class="btn btn-ghost btn-sm" data-pick-on-map>Marcarla en el mapa</button>
          </div>
        </div>`,
      );
      return;
    }
    render(mapBox, "");
    form.querySelector("[data-relocate]").hidden = false;
    try {
      picker = await pickerMap(
        mapBox,
        location,
        (point) => {
          location = point;
          touched();
        },
        { icon: "store", title: "Tu negocio" },
      );
    } catch {
      render(mapBox, html`<p class="grid h-full place-items-center p-4 text-sm text-muted">No se pudo cargar el mapa. Revisa tu conexión.</p>`);
    }
  };

  const place = async (point) => {
    location = point;
    touched();
    if (picker) picker.set(point);
    else await drawMap();
  };

  const showMode = () => {
    const distance = mode() === "DISTANCE";
    form.querySelector('[data-pricing="FIXED"]').hidden = distance;
    form.querySelector('[data-pricing="DISTANCE"]').hidden = !distance;
    if (distance) void drawMap();
  };

  form.addEventListener("change", (event) => {
    if (event.target.name === "deliveryPricing") showMode();
    if (event.target.matches('[data-extra-enabled], [name="deliveryReach"]')) summarize();
  });
  form.addEventListener("input", (event) => {
    if (event.target.closest('[data-pricing="DISTANCE"]')) summarize();
  });
  form.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.matches("[data-add-tier]")) {
      const tiers = readTiers();
      const last = tiers.at(-1) ?? { upToKm: 0, fee: 1000 };
      const nextKm = Number.isFinite(last.upToKm) ? last.upToKm + 2 : 2;
      list.insertAdjacentHTML("beforeend", String(tierRow({ upToKm: nextKm, fee: last.fee + 2000 }, tiers.length, false)));
      list.lastElementChild.querySelector("[data-tier-km]").focus();
      summarize();
      touched();
    }
    if (button.matches("[data-remove-tier]")) {
      button.closest("[data-tier]").remove();
      renumber();
      touched();
    }
    if (button.matches("[data-pick-on-map]")) await place(DEFAULT_CENTER);
    if (button.matches("[data-locate-business]")) {
      setBusy(button, true);
      try {
        const position = await currentPosition();
        await place({ lat: position.lat, lng: position.lng });
        toast(position.accuracy > 100 ? "Ubicación aproximada: arrastra el marcador hasta tu negocio." : "Listo: revisa que el marcador esté en tu negocio.", "info");
      } catch (error) {
        toast(error.message, "error");
      } finally {
        if (button.isConnected) setBusy(button, false);
      }
    }
  });

  summarize();
  showMode();

  return {
    /** Lo que se guarda: rangos, km adicional y alcance solo con «Según la distancia»; la ubicación, si está marcada. */
    read() {
      const distance = mode() === "DISTANCE";
      const current = pricing();
      return {
        deliveryPricing: mode(),
        ...(distance ? { deliveryTiers: readTiers(), deliveryExtraKmFee: current.extraKmFee, deliveryMaxKm: limited() ? parseKm(form.elements.deliveryMaxKm.value) : null } : {}),
        ...(location ? { location } : {}),
      };
    },
  };
}
