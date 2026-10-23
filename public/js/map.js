// Mapas del seguimiento de domicilios (Leaflet, cargado solo cuando hace falta).
// Marcadores propios: la moto del domiciliario (mostaza) y la casa del cliente (tinta).

let leafletPromise = null;
let configPromise = null;

/** Carga Leaflet (CSS + JS servidos por Pedify) una sola vez. */
function loadLeaflet() {
  leafletPromise ??= new Promise((resolve, reject) => {
    if (window.L) return resolve(window.L);
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/assets/vendor/leaflet/leaflet.css";
    document.head.append(css);
    const script = document.createElement("script");
    script.src = "/assets/vendor/leaflet/leaflet.js";
    script.onload = () => resolve(window.L);
    script.onerror = () => {
      leafletPromise = null;
      reject(new Error("No se pudo cargar el mapa."));
    };
    document.head.append(script);
  });
  return leafletPromise;
}

/** Teselas y atribución configuradas en el servidor. */
export function mapConfig(given) {
  if (given) return Promise.resolve(given);
  configPromise ??= fetch("/api/v1/map-config")
    .then((response) => response.json())
    .then((payload) => payload.data)
    .catch(() => ({ tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "&copy; OpenStreetMap" }));
  return configPromise;
}

/**
 * Pedify no envía la cabecera Referer (privacidad), pero los servidores de mapas la exigen para
 * identificar el sitio: solo en las teselas se envía el dominio (nunca la ruta ni la clave).
 */
const tileOptions = (settings) => ({ maxZoom: 19, attribution: settings.attribution, referrerPolicy: "strict-origin-when-cross-origin" });

const SPRITE = "/assets/icons/sprite.svg";
const iconSvg = (name, size) =>
  `<svg width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="${SPRITE}#i-${name}"></use></svg>`;

function courierIcon(L) {
  return L.divIcon({
    className: "map-pin",
    html: `<span class="map-pin-courier">${iconSvg("bike", 22)}</span>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

function homeIcon(L, name = "house") {
  return L.divIcon({
    className: "map-pin",
    html: `<span class="map-pin-home">${iconSvg(name, 18)}</span>`,
    iconSize: [38, 46],
    iconAnchor: [19, 44],
  });
}

/** Distancia en metros entre dos puntos (fórmula del haversine). */
export function distanceMeters(a, b) {
  const rad = (value) => (value * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** "350 m" o "1,2 km". */
export function distanceLabel(meters) {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} km`;
}

/**
 * Mapa de un domicilio: casa del cliente (si marcó su ubicación) y domiciliario (si comparte).
 * Devuelve { update({ destination, courier }), invalidate(), destroy() }.
 */
export async function deliveryMap(container, { destination = null, courier = null, config, interactive = true } = {}) {
  const [L, settings] = await Promise.all([loadLeaflet(), mapConfig(config)]);
  const map = L.map(container, {
    zoomControl: interactive,
    attributionControl: true,
    dragging: interactive,
    scrollWheelZoom: false,
    tap: interactive,
  });
  L.tileLayer(settings.tileUrl, tileOptions(settings)).addTo(map);
  map.attributionControl.setPrefix(false);

  let home = null;
  let moto = null;
  let route = null;
  let fitted = false;

  function update(next = {}) {
    if (next.destination !== undefined) destination = next.destination;
    if (next.courier !== undefined) courier = next.courier;

    if (destination) {
      home ??= L.marker([destination.lat, destination.lng], { icon: homeIcon(L), keyboard: false, title: "Lugar de entrega" }).addTo(map);
      home.setLatLng([destination.lat, destination.lng]);
    }
    if (courier) {
      moto ??= L.marker([courier.lat, courier.lng], { icon: courierIcon(L), keyboard: false, title: "Domiciliario", zIndexOffset: 500 }).addTo(map);
      moto.setLatLng([courier.lat, courier.lng]);
    } else if (moto) {
      moto.remove();
      moto = null;
    }
    // Línea punteada entre el domiciliario y la casa (no es la ruta: solo la dirección).
    if (courier && destination) {
      const points = [
        [courier.lat, courier.lng],
        [destination.lat, destination.lng],
      ];
      route ??= L.polyline(points, { color: "#17161c", weight: 3, opacity: 0.55, dashArray: "2 8", lineCap: "round" }).addTo(map);
      route.setLatLngs(points);
    } else if (route) {
      route.remove();
      route = null;
    }

    const points = [destination, courier].filter(Boolean).map((point) => [point.lat, point.lng]);
    if (points.length === 0) {
      map.setView([4.6, -74.08], 5); // Colombia, mientras no hay puntos
    } else if (points.length === 1) {
      if (!fitted) map.setView(points[0], 16);
      else if (!map.getBounds().pad(-0.15).contains(points[0])) map.panTo(points[0]);
    } else {
      const bounds = L.latLngBounds(points);
      // Se encuadra al inicio y cuando alguno de los dos se sale de la vista.
      if (!fitted || !map.getBounds().pad(-0.1).contains(bounds)) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 });
    }
    fitted = points.length > 0;
  }

  update();
  return {
    update,
    invalidate: () => map.invalidateSize(),
    destroy: () => map.remove(),
    get leaflet() {
      return map;
    },
  };
}

/**
 * Mapa para elegir un punto (checkout o la ubicación del negocio): pin arrastrable que empieza en
 * `point`. `onChange({ lat, lng })` se llama al moverlo o al tocar el mapa.
 */
export async function pickerMap(container, point, onChange, { zoom = 17, icon = "house", title = "Tu ubicación" } = {}) {
  const [L, settings] = await Promise.all([loadLeaflet(), mapConfig()]);
  const map = L.map(container, { scrollWheelZoom: false, zoomControl: true }).setView([point.lat, point.lng], zoom);
  L.tileLayer(settings.tileUrl, tileOptions(settings)).addTo(map);
  map.attributionControl.setPrefix(false);
  const marker = L.marker([point.lat, point.lng], { icon: homeIcon(L, icon), draggable: true, title }).addTo(map);
  const emit = () => {
    const { lat, lng } = marker.getLatLng();
    onChange({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) });
  };
  marker.on("dragend", emit);
  map.on("click", (event) => {
    marker.setLatLng(event.latlng);
    emit();
  });
  return {
    set(next) {
      marker.setLatLng([next.lat, next.lng]);
      map.setView([next.lat, next.lng], Math.max(map.getZoom(), 17));
    },
    destroy: () => map.remove(),
    invalidate: () => map.invalidateSize(),
  };
}

/** Pide la ubicación del celular (una vez). Mensajes claros si falla. */
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext || !("geolocation" in navigator)) {
      reject(new Error("Tu navegador no permite compartir la ubicación desde aquí."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6)),
          accuracy: Math.round(position.coords.accuracy),
        }),
      (error) =>
        reject(
          new Error(
            error.code === error.PERMISSION_DENIED
              ? "No diste permiso para usar tu ubicación. Actívalo en el navegador o escribe bien la dirección."
              : "No pudimos obtener tu ubicación. Intenta de nuevo con el GPS encendido.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  });
}
