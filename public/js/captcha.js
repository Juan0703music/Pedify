// «No soy un robot» de la tienda: la casilla que el cliente marca antes de pagar y pedir. Al marcarla, el
// navegador resuelve un reto de cálculo del servidor (src/services/captcha.service.ts) en menos de un
// segundo. Cada solución sirve para un envío (subir el comprobante o hacer el pedido): después de usar una,
// la siguiente se resuelve sola, sin que el cliente tenga que volver a marcar nada.
import { sha256Hex } from "./sha256.js";
import { html, icon } from "./ui.js";

/** Números que se prueban por tanda antes de dejar respirar a la página. */
const CHUNK = 4000;
/** Lo mínimo que se ve «Verificando…», para que se note la verificación. */
const VISIBLE_MS = 600;

const COPY = {
  idle: "No soy un robot",
  working: "Verificando…",
  done: "Verificado: no eres un robot",
  error: "No pudimos verificar. Toca para intentar otra vez.",
};

export const CAPTCHA_MISSING = "Marca «No soy un robot» antes de continuar.";

const base64url = (text) => btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function fetchChallenge() {
  const response = await fetch("/api/v1/captcha/challenge", { headers: { Accept: "application/json" }, cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? COPY.error);
  return payload.data;
}

/** Busca el número del reto por tandas, sin congelar la página. */
function solve({ salt, challenge, maxnumber, signature }) {
  return new Promise((resolve, reject) => {
    let number = 0;
    const step = () => {
      const end = Math.min(maxnumber, number + CHUNK);
      for (; number <= end; number += 1) {
        if (sha256Hex(`${salt}${number}`) === challenge) {
          resolve({ token: base64url(JSON.stringify({ salt, number, signature })), expires: Number(salt.split(".")[1]) });
          return;
        }
      }
      if (number > maxnumber) reject(new Error(COPY.error));
      else setTimeout(step, 0);
    };
    step();
  });
}

/** Estado de la casilla y las soluciones listas para usar. */
export function storeCaptcha() {
  let state = "idle";
  let ready = null;
  let pending = null;
  const listeners = new Set();
  const set = (value) => {
    state = value;
    listeners.forEach((listener) => listener(state));
  };
  const produce = () => (pending ??= fetchChallenge().then(solve).finally(() => (pending = null)));

  return {
    get state() {
      return state;
    },
    onChange(listener) {
      listeners.add(listener);
    },

    /** El cliente marca la casilla. */
    async check() {
      if (state === "working" || state === "done") return;
      set("working");
      const started = Date.now();
      try {
        ready = await produce();
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, VISIBLE_MS - (Date.now() - started))));
        set("done");
      } catch {
        set("error");
      }
    },

    /** Una solución para un envío, o null si aún no marcó la casilla. Deja la siguiente resolviéndose. */
    async take() {
      if (state !== "done") return null;
      // Vencida (o casi): se resuelve otra en silencio; la persona ya marcó la casilla.
      if (!ready || ready.expires - Date.now() < 30_000) ready = await produce().catch(() => null);
      if (!ready) {
        set("error");
        return null;
      }
      const { token } = ready;
      ready = null;
      produce()
        .then((solution) => (ready = solution))
        .catch(() => {});
      return token;
    },

    /** El servidor la rechazó (venció o se reinició): hay que marcarla otra vez. */
    reset() {
      ready = null;
      set("idle");
    },
  };
}

/** La casilla. `name="captcha"` para que los errores del formulario se muestren debajo. */
export function captchaBox(state) {
  const mark = state === "working" ? icon("loader-circle", "h-[18px] w-[18px] animate-spin") : state === "done" ? icon("check", "h-[18px] w-[18px]") : "";
  return html`<button type="button" role="checkbox" name="captcha" class="captcha" data-captcha data-state="${state}" aria-checked="${state === "done"}" aria-busy="${state === "working"}">
    <span class="captcha-box" aria-hidden="true">${mark}</span>
    <span class="min-w-0 flex-1 text-left">${COPY[state]}</span>
    <span class="captcha-brand" aria-hidden="true">${icon("shield", "h-4 w-4")} Pedify</span>
  </button>`;
}
