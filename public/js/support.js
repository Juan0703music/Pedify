// Soporte y PQRS desde el panel del negocio (/panel/soporte): la persona le escribe al equipo de Pedify
// (dudas, peticiones, quejas, reclamos o sugerencias) y ve las respuestas como una conversación. Cada
// solicitud llega al panel central; las respuestas llegan aquí, al correo y al celular.
import { api } from "./api.js";
import { initPanel } from "./dashboard.js";
import { STATUS, conversation, kindOptions, longDate, messageFields, replyForm, ticketHeader } from "./support-ui.js";
import { clearFieldErrors, formAlert, html, icon, readForm, render, setBusy, showErrors, toast } from "./ui.js";

const state = { tickets: [], current: null };
let main;

function listView() {
  return html`<section class="panel grid content-start gap-3 p-4 sm:p-5" aria-labelledby="tickets-title">
    <div class="flex items-center justify-between gap-3">
      <h2 id="tickets-title" class="text-lg font-[740]">Tus solicitudes</h2>
      <button type="button" class="btn btn-ink btn-sm" data-new>${icon("plus")} Nueva</button>
    </div>
    ${state.tickets.length === 0
      ? html`<p class="text-sm text-muted">Aún no has enviado solicitudes. Cuando escribas, aquí verás cada una con su respuesta.</p>`
      : html`<ul class="grid divide-y divide-line">
          ${state.tickets.map(
            (ticket) => html`<li>
              <button type="button" class="grid w-full gap-1 rounded-[10px] px-2 py-3 text-left hover:bg-ground ${state.current?.id === ticket.id ? "bg-ground" : ""}" data-ticket="${ticket.id}">
                <span class="flex flex-wrap items-center gap-2 text-sm">
                  <span class="num font-[700]">${ticket.code}</span>
                  <span class="text-muted">${ticket.kindLabel}</span>
                  <span class="badge ${STATUS[ticket.status].badge}">${STATUS[ticket.status].label}</span>
                  ${ticket.unread ? html`<span class="badge bg-tomato text-paper">Respuesta nueva</span>` : ""}
                </span>
                <span class="truncate font-[650]">${ticket.subject}</span>
              </button>
            </li>`,
          )}
        </ul>`}
  </section>`;
}

function newView() {
  return html`<section class="panel grid content-start gap-5 p-4 sm:p-6" aria-labelledby="new-title">
    <div class="grid gap-1">
      <h2 id="new-title" class="text-lg font-[740]">Nueva solicitud</h2>
      <p class="text-sm text-muted">Te respondemos aquí y a tu correo en máximo 15 días hábiles; casi siempre, mucho antes.</p>
    </div>
    <form class="grid gap-5" data-new-form novalidate>
      ${formAlert()} ${kindOptions()} ${messageFields()}
      <button type="submit" class="btn btn-ink justify-self-start">${icon("message-circle")} Enviar solicitud</button>
    </form>
  </section>`;
}

function ticketView(ticket) {
  return html`<section class="panel grid content-start gap-5 p-4 sm:p-6" aria-label="Solicitud ${ticket.code}">
    <button type="button" class="inline-flex w-fit items-center gap-1.5 text-sm font-[650] text-muted hover:text-ink lg:hidden" data-back>
      ${icon("arrow-right", "h-4 w-4 rotate-180")} Tus solicitudes
    </button>
    ${ticketHeader(ticket)} ${conversation(ticket)} ${replyForm(ticket)}
  </section>`;
}

function draw() {
  render(
    main,
    html`<div class="grid gap-6">
      <div class="grid gap-1">
        <h1 class="text-[1.875rem] leading-tight font-[780] sm:text-[2.25rem]">Soporte y PQRS</h1>
        <p class="max-w-[70ch] text-muted">
          Escríbele al equipo de Pedify: una duda, una petición, una queja, un reclamo o una sugerencia. Cada solicitud queda con su número y
          su respuesta.
        </p>
      </div>
      <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div class="${state.current ? "max-lg:hidden" : ""}">${listView()}</div>
        <div>${state.current ? ticketView(state.current) : newView()}</div>
      </div>
    </div>`,
  );
}

async function openTicket(id) {
  try {
    state.current = await api(`/support/tickets/${id}`);
    history.replaceState(null, "", `#${id}`);
    state.tickets = state.tickets.map((ticket) => (ticket.id === id ? { ...ticket, unread: false } : ticket));
    draw();
    window.dispatchEvent(new CustomEvent("pedify:support-read"));
    main.querySelector("[data-reply-form] textarea")?.scrollIntoView({ block: "nearest" });
  } catch (error) {
    toast(error.message, "error");
  }
}

function bind() {
  main.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.matches("[data-ticket]")) return void openTicket(button.dataset.ticket);
    if (button.matches("[data-new], [data-back]")) {
      state.current = null;
      history.replaceState(null, "", location.pathname);
      draw();
      if (button.matches("[data-new]")) main.querySelector('[name="subject"]')?.focus();
    }
  });
  main.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('[type="submit"]');
    clearFieldErrors(form);
    setBusy(button, true);
    try {
      if (form.matches("[data-new-form]")) {
        const ticket = await api("/support/tickets", { method: "POST", body: readForm(form) });
        state.tickets = [ticket, ...state.tickets];
        state.current = ticket;
        history.replaceState(null, "", `#${ticket.id}`);
        draw();
        toast(`Recibimos tu solicitud ${ticket.code}. Te respondemos a más tardar el ${longDate(ticket.dueAt)}.`);
      } else if (form.matches("[data-reply-form]")) {
        state.current = await api(`/support/tickets/${state.current.id}/messages`, { method: "POST", body: readForm(form) });
        state.tickets = state.tickets.map((ticket) => (ticket.id === state.current.id ? { ...state.current } : ticket));
        draw();
        toast("Mensaje enviado al equipo de Pedify.");
      }
    } catch (error) {
      setBusy(button, false);
      showErrors(form, error);
    }
  });
}

const context = await initPanel("soporte");
if (context) {
  main = context.main;
  try {
    state.tickets = await api("/support/tickets");
    draw();
    bind();
    const id = location.hash.slice(1);
    if (/^[0-9a-f-]{36}$/.test(id)) await openTicket(id);
  } catch (error) {
    render(main, html`<p class="panel p-6 text-tomato">${error.message}</p>`);
  }
}
