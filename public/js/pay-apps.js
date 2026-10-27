/**
 * Apps con las que el cliente paga un QR en Colombia (Nequi y bancos con Bre-B). Ni Nequi ni los bancos
 * publican un enlace para pagar un QR desde una página web: el botón lleva a la app (desde la tienda de
 * apps, que muestra «Abrir» si ya está instalada) y ahí el cliente escanea el QR del local o elige la
 * imagen guardada. Paquetes de Google Play e ids del App Store verificados en octubre de 2026.
 */
export const PAY_APPS = [
  { id: "nequi", name: "Nequi", android: "com.nequi.MobileApp", ios: "1075378688", howTo: "En Nequi toca «$», luego «Código QR» y «Escanea QR»." },
  { id: "bancolombia", name: "Mi Bancolombia", android: "co.com.bancolombia.personas.superapp", ios: "6526460670" },
  { id: "daviplata", name: "Daviplata", android: "com.davivienda.daviplataapp", ios: "1100731780" },
  { id: "davivienda", name: "Davivienda", android: "com.davivienda.daviviendaapp", ios: "1578380253" },
  { id: "bbva", name: "BBVA", android: "co.com.bbva.mb", ios: "823508982" },
  { id: "bogota", name: "Banco de Bogotá", android: "com.bancodebogota.bancamovil", ios: "741196012" },
  { id: "nu", name: "Nu", android: "com.nu.production", ios: "814456780" },
];

/** App sugerida según la cuenta del QR (en Bre-B, la que el cliente use: no hay una por defecto). */
const APP_FOR_ACCOUNT = { NEQUI: "nequi", DAVIPLATA: "daviplata" };
/** La app con la que pagó la última vez (en este celular, para cualquier tienda). */
const PREFERRED_KEY = "pedify:pay-app";

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** Enlace que abre la app: su página en el App Store o en Google Play (con «Abrir» si está instalada). */
export function appLink(app) {
  return isIOS() ? `https://apps.apple.com/co/app/id${app.ios}` : `https://play.google.com/store/apps/details?id=${app.android}`;
}

/** La app a mostrar primero: la que usó antes o la de la cuenta del QR. null si no hay ninguna. */
export function preferredApp(accountKind) {
  let saved = null;
  try {
    saved = localStorage.getItem(PREFERRED_KEY);
  } catch {
    // Sin almacenamiento: se sugiere la de la cuenta.
  }
  const id = saved ?? APP_FOR_ACCOUNT[accountKind];
  return PAY_APPS.find((app) => app.id === id) ?? null;
}

export function rememberApp(id) {
  try {
    localStorage.setItem(PREFERRED_KEY, id);
  } catch {
    // Sin almacenamiento: la próxima vez se vuelve a elegir.
  }
}
