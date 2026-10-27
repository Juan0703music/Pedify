/**
 * Lectura de códigos QR con la cámara del celular (pagar la cuenta de la mesa con el QR del local).
 * Usa BarcodeDetector del navegador (Chrome, Android) y, donde no existe (iPhone, Firefox), jsQR, que se
 * descarga solo cuando hace falta.
 */

const JSQR_URL = "/assets/vendor/jsqr/jsQR.min.js";
/** Lado mayor con el que se analiza cada cuadro: suficiente para un QR de caja y rápido en el celular. */
const MAX_SIDE = 960;

let readerPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => {
      script.remove();
      reject(new Error("No se pudo cargar el lector de QR."));
    };
    document.head.append(script);
  });
}

const sizeOf = (source) => ({
  width: source.videoWidth || source.naturalWidth || source.width,
  height: source.videoHeight || source.naturalHeight || source.height,
});

/** Función que lee el QR de un video, imagen o ImageBitmap (devuelve el texto o null). */
function reader() {
  readerPromise ??= (async () => {
    if ("BarcodeDetector" in window) {
      try {
        if ((await window.BarcodeDetector.getSupportedFormats()).includes("qr_code")) {
          const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
          return async (source) => (await detector.detect(source))[0]?.rawValue ?? null;
        }
      } catch {
        // Sin soporte real: se usa jsQR.
      }
    }
    await loadScript(JSQR_URL);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    return async (source, { thorough = false } = {}) => {
      const { width, height } = sizeOf(source);
      if (!width || !height) return null;
      const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      // En video, cada cuadro se lee rápido; en una foto, se prueba también con los colores invertidos.
      return window.jsQR(data, canvas.width, canvas.height, { inversionAttempts: thorough ? "attemptBoth" : "dontInvert" })?.data ?? null;
    };
  })().catch((error) => {
    readerPromise = null;
    throw error;
  });
  return readerPromise;
}

/** La cámara en vivo se puede usar (https y un navegador con cámara). */
export const canUseCamera = () => window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * Abre la cámara trasera en `video` y llama a `onCode(texto)` con cada QR que lee (sin repetir el mismo
 * seguido). Devuelve la función para apagarla. Lanza el error de la cámara (permiso negado, sin cámara).
 */
export async function startQrCamera(video, onCode) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  const read = await reader().catch((error) => {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  });
  video.srcObject = stream;
  video.setAttribute("playsinline", "");
  video.muted = true;
  await video.play().catch(() => {});

  let stopped = false;
  let timer = 0;
  let busy = false;
  const tick = async () => {
    if (stopped) return;
    if (!busy && video.readyState >= 2) {
      busy = true;
      try {
        const code = await read(video);
        if (code && !stopped) await onCode(code);
      } catch {
        // Un cuadro que no se pudo leer: se sigue con el siguiente.
      }
      busy = false;
    }
    if (!stopped) timer = setTimeout(tick, 200);
  };
  tick();

  return () => {
    stopped = true;
    clearTimeout(timer);
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  };
}

/** Lee el QR de una foto (cuando la cámara en vivo no está disponible). null si no encuentra ninguno. */
export async function readQrFromFile(file) {
  const read = await reader();
  const bitmap = await createImageBitmap(file);
  try {
    return await read(bitmap, { thorough: true });
  } finally {
    bitmap.close?.();
  }
}
