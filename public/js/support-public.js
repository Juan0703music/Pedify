// /soporte: cualquier persona le escribe al equipo de Pedify sin cuenta (con «No soy un robot») y sigue
// su caso con el enlace que le llega al correo (/soporte#<id>.<clave>). Los negocios escriben desde su panel.
import { CAPTCHA_MISSING, captchaBox, storeCaptcha } from "./captcha.js";
import { STATUS, conversation, kindOptions, longDate, messageFields, replyForm, ticketHeader } from "./support-ui.js";
import { clearFieldErrors, formAlert, html, icon, readForm, render, setBusy, showErrors, toast } from "./ui.js";

const root = document.getElementById("support-app");
const captcha = storeCaptcha();
const state = { ticket: null, key: null };

async function request(path, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`/api/v1/support/public${path}`, {
    method,
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(payload?.error?.message ?? "No pudimos enviar tu solicitud. Intenta de nuevo."), payload?.error ?? {});
  return payload.data;
}

function formView() {
  return html`<h1 class="text-[2.25rem] leading-tight font-[800]">Soporte y PQRS</h1>
    <p class="mt-2 max-w-[60ch] text-muted">
      Escríbele al equipo de Pedify: una duda, una petición, una queja, un reclamo o una sugerencia. Cada solicitud queda con su número y te
      respondemos a tu correo en máximo 15 días hábiles.
    </p>
    <div class="mt-6 grid gap-3 rounded-[14px] bg-ground p-4 text-[0.9375rem]">
      <p class="flex items-start gap-2">
        ${icon("store", "mt-0.5 h-4 w-4 flex-none")}
        <span>¿Tienes un negocio en Pedify? Escríbenos desde tu panel, en <a class="font-[650] underline" href="/login?next=%2Fpanel%2Fsoporte">Soporte y PQRS</a>.</span>
      </p>
      <p class="flex items-start gap-2">
        ${icon("receipt", "mt-0.5 h-4 w-4 flex-none")}
        <span>¿Es por un pedido que hiciste en una tienda? Escríbele primero al negocio: sus datos y su canal de quejas están al final de su tienda.</span>
      </p>
    </div>
    <form class="mt-8 grid gap-5" data-public-form novalidate>
      ${formAlert()}
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="field">
          <label class="label" for="p-name">Tu nombre</label>
          <input class="input" id="p-name" name="name" autocomplete="name" maxlength="80" required />
        </div>
        <div class="field">
          <label class="label" for="p-email">Correo</label>
          <input class="input" id="p-email" name="email" type="email" inputmode="email" autocomplete="email" required />
          <p class="hint">Ahí te llega la respuesta.</p>
        </div>
        <div class="field">
          <label class="label" for="p-phone">Celular <span class="font-normal text-muted">(opcional)</span></label>
          <input class="input" id="p-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="300 123 4567" />
        </div>
      </div>
      ${kindOptions()} ${messageFields()}
      <label class="flex cursor-pointer items-start gap-3 text-[0.9375rem] leading-snug" data-error-anchor="acceptPrivacy">
        <input type="checkbox" name="acceptPrivacy" class="mt-0.5 h-5 w-5 flex-none" required />
        <span>Autorizo el tratamiento de mis datos para atender esta solicitud, según la <a href="/privacidad" target="_blank" rel="noopener" class="font-semibold underline">política de tratamiento de datos</a> de Pedify.</span>
      </label>
      <div class="grid gap-2" data-error-anchor="captcha">
        <div data-captcha-slot>${captchaBox(captcha.state)}</div>
      </div>
      <button type="submit" class="btn btn-ink justify-self-start">${icon("message-circle")} Enviar solicitud</button>
    </form>`;
}

function ticketView(ticket) {
  return html`<p class="mb-6"><a class="inline-flex items-center gap-1.5 text-sm font-[650] text-muted hover:text-ink" href="/soporte">${icon("plus", "h-4 w-4")} Enviar otra solicitud</a></p>
    <section class="panel grid gap-5 p-4 sm:p-6" aria-label="Solicitud ${ticket.code}">
      ${ticketHeader(ticket, STATUS[ticket.status])}
      <p class="text-sm text-muted">Guarda el enlace del correo que te enviamos a ${ticket.email}: con él vuelves a esta conversación.</p>
      ${conversation(ticket)} ${replyForm(ticket)}
    </section>`;
}

function draw() {
  render(root, state.ticket ? ticketView(state.ticket) : formView());
}

function drawCaptcha() {
  const slot = root.querySelector("[data-captcha-slot]");
  if (!slot) return;
  render(slot, captchaBox(captcha.state));
  if (captcha.state === "done") root.querySelector('[data-error-for="captcha"]')?.remove();
}
captcha.onChange(drawCaptcha);

async function openFromHash() {
  const [id, key] = location.hash.slice(1).split(".");
  if (!id || !key) return false;
  try {
    state.ticket = await request(`/${id}`, { headers: { "X-Support-Key": key } });
    state.key = key;
    return true;
  } catch (error) {
    toast(error.message, "error");
    history.replaceState(null, "", location.pathname);
    return false;
  }
}

root.addEventListener("click", (event) => {
  if (event.target.closest("[data-captcha]")) void captcha.check();
});

root.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('[type="submit"]');
  clearFieldErrors(form);
  try {
    if (form.matches("[data-public-form]")) {
      const token = await captcha.take();
      if (!token) return showErrors(form, { message: CAPTCHA_MISSING, fields: { captcha: CAPTCHA_MISSING } });
      setBusy(button, true);
      const ticket = await request("", { method: "POST", body: readForm(form), headers: { "X-Captcha": token } });
      state.ticket = ticket;
      state.key = ticket.key;
      history.replaceState(null, "", `#${ticket.id}.${ticket.key}`);
      draw();
      window.scrollTo({ top: 0 });
      toast(`Recibimos tu solicitud ${ticket.code}. Te respondemos a más tardar el ${longDate(ticket.dueAt)}.`);
    } else if (form.matches("[data-reply-form]")) {
      setBusy(button, true);
      state.ticket = await request(`/${state.ticket.id}/messages`, { method: "POST", body: readForm(form), headers: { "X-Support-Key": state.key } });
      draw();
      toast("Mensaje enviado al equipo de Pedify.");
    }
  } catch (error) {
    setBusy(button, false);
    if (error.code?.startsWith?.("CAPTCHA_")) {
      captcha.reset();
      return showErrors(form, { message: error.message, fields: { captcha: error.message } });
    }
    showErrors(form, error);
  }
});

window.addEventListener("hashchange", async () => {
  if (await openFromHash()) draw();
});

await openFromHash();
draw();
