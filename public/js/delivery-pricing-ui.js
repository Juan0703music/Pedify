// Domicilio según la distancia (Configuración → Entrega): la ubicación del negocio en el mapa y los
// rangos «hasta X km → $Y». El servidor recalcula el valor de cada pedido con la ubicación que comparte
// el cliente (en línea recta desde el negocio); más allá del último rango no se ofrece domicilio.
import { formatThousands, parseMoney } from "./api.js";
import { currentPosition, pickerMap } from "./map.js";
import { html, icon, render, setBusy, toast } from "./ui.js";

const MAX_TIERS = 8;
const DEFAULT_TIERS = [
  { upToKm: 2, fee: 3000 },
  { upToKm: 4, fee: 5000 },
  { upToKm: 6, fee: 7000 },
];
/** Centro de Sincelejo: donde empieza el mapa si el negocio aún no marcó su ubicación. */
const DEFAULT_CENTER = { lat: 9.3047, lng: -75.3978 };

const formatKm = (km) => String(km).replace(".", ",");
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

/** Ubicación del negocio y rangos (se muestra al elegir «Según la distancia»). */
export function distanceFields(settings, disabled) {
  const tiers = settings.deliveryTiers.length > 0 ? settings.deliveryTiers : DEFAULT_TIERS;
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

  const summarize = () => {
    const tiers = readTiers().filter((tier) => Number.isFinite(tier.upToKm));
    const farthest = tiers.length > 0 ? Math.max(...tiers.map((tier) => tier.upToKm)) : null;
    form.querySelector("[data-tiers-summary]").textContent =
      `Se mide en línea recta desde tu negocio hasta la ubicación que comparte el cliente.${farthest ? ` Más lejos de ${formatKm(farthest)} km no se ofrece domicilio.` : ""}`;
    form.querySelector("[data-add-tier]").hidden = list.children.length >= MAX_TIERS;
  };

  const renumber = () => {
    const tiers = readTiers();
    render(list, tiers.map((tier, index) => tierRow({ upToKm: Number.isFinite(tier.upToKm) ? tier.upToKm : "", fee: tier.fee }, index, false)));
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
  });
  form.addEventListener("input", (event) => {
    if (event.target.matches("[data-tier-km]")) summarize();
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
    /** Lo que se guarda: los rangos solo con «Según la distancia»; la ubicación, si está marcada. */
    read() {
      const distance = mode() === "DISTANCE";
      return {
        deliveryPricing: mode(),
        ...(distance ? { deliveryTiers: readTiers() } : {}),
        ...(location ? { location } : {}),
      };
    },
  };
}
