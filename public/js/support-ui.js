// Piezas del soporte y las PQRS que comparten el panel del negocio, la página /soporte y el panel
// central: los tipos de solicitud, los estados y la conversación.
import { html, icon } from "./ui.js";

/** Tipos de solicitud, con lo que significa cada uno para quien escribe. */
export const KINDS = [
  ["CONSULTA", "Duda o ayuda", "Cómo usar algo de Pedify"],
  ["PETICION", "Petición", "Pedir un cambio, un dato o un documento"],
  ["QUEJA", "Queja", "Algo del servicio no te gustó"],
  ["RECLAMO", "Reclamo", "Algo no funcionó o te cobraron mal"],
  ["SUGERENCIA", "Sugerencia", "Una idea para mejorar Pedify"],
];

/** Estado para quien escribe (el panel central usa sus propios textos). */
export const STATUS = {
  OPEN: { label: "Recibida", badge: "bg-mustard-soft text-mustard-deep" },
  ANSWERED: { label: "Respondida", badge: "bg-leaf-soft text-leaf" },
  CLOSED: { label: "Cerrada", badge: "bg-ground text-muted" },
};

export const longDate = (value) => new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", timeZone: "America/Bogota" }).format(new Date(value));
export const dateTime = (value) =>
  new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" })
    .format(new Date(value))
    .replace(".", "");

/** Tarjetas para elegir el tipo de solicitud. */
export function kindOptions(selected = "CONSULTA") {
  return html`<fieldset class="grid gap-2">
    <legend class="label mb-2">¿Qué necesitas?</legend>
    <div class="grid gap-2 sm:grid-cols-2" data-error-anchor="kind">
      ${KINDS.map(
        ([value, title, detail]) => html`<label class="role-option">
          <input type="radio" name="kind" value="${value}" ${value === selected ? "checked" : ""} required />
          <span class="role-check" aria-hidden="true"></span>
          <span class="font-[720]">${title}</span>
          <span class="text-sm leading-snug text-muted">${detail}</span>
        </label>`,
      )}
    </div>
  </fieldset>`;
}

/** Asunto y mensaje de una solicitud nueva. */
export function messageFields() {
  return html`<div class="field">
      <label class="label" for="s-subject">Asunto</label>
      <input class="input" id="s-subject" name="subject" maxlength="120" required placeholder="Ej.: No me llegan los avisos de pedidos" />
    </div>
    <div class="field">
      <label class="label" for="s-message">Cuéntanos con detalle</label>
      <textarea class="input min-h-[9rem]" id="s-message" name="message" rows="6" maxlength="4000" required
        placeholder="Qué pasó, cuándo y en qué parte de Pedify. No escribas contraseñas."></textarea>
    </div>`;
}

/**
 * La conversación de una solicitud. `perspective`: "requester" (quien la envió ve las respuestas de
 * Pedify a la izquierda) o "pedify" (el panel central ve las suyas a la derecha).
 */
export function conversation(ticket, perspective = "requester") {
  return html`<ol class="grid gap-3" aria-label="Conversación">
    ${ticket.messages.map((message) => {
      const fromPedify = message.author === "PEDIFY";
      const mine = perspective === "pedify" ? fromPedify : !fromPedify;
      return html`<li class="flex ${mine ? "justify-end" : "justify-start"}">
        <article class="grid max-w-[min(36rem,92%)] gap-1.5 rounded-[14px] px-4 py-3 ${fromPedify ? "bg-mustard-soft" : "bg-ground"}">
          <header class="flex flex-wrap items-center gap-x-2 text-sm">
            ${fromPedify ? html`<img src="/assets/icons/logo.svg" alt="" class="h-4 w-4" width="16" height="16" />` : ""}
            <span class="font-[700]">${message.authorName}</span>
            <time class="text-muted" datetime="${message.createdAt}">${dateTime(message.createdAt)}</time>
          </header>
          <p class="text-[0.9375rem] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">${message.body}</p>
        </article>
      </li>`;
    })}
  </ol>`;
}

/** Encabezado del caso: número, tipo, estado y plazo. */
export function ticketHeader(ticket, status = STATUS[ticket.status]) {
  return html`<div class="grid gap-1.5">
    <p class="flex flex-wrap items-center gap-2 text-sm">
      <span class="num font-[720]">${ticket.code}</span>
      <span class="badge bg-ink text-paper">${ticket.kindLabel}</span>
      <span class="badge ${status.badge}">${status.label}</span>
    </p>
    <h2 class="text-xl leading-snug font-[760] [overflow-wrap:anywhere]">${ticket.subject}</h2>
    ${ticket.status === "OPEN"
      ? html`<p class="flex items-center gap-1.5 text-sm text-muted">${icon("clock", "h-4 w-4")} Respuesta a más tardar el ${longDate(ticket.dueAt)}</p>`
      : ""}
  </div>`;
}

/** Caja para responder dentro de la conversación. */
export function replyForm(ticket, { label = "Escribe tu respuesta", button = "Enviar" } = {}) {
  return html`<form class="grid gap-3 border-t border-line pt-4" data-reply-form novalidate>
    <div class="field">
      <label class="label" for="s-reply">${label}</label>
      <textarea class="input min-h-[6rem]" id="s-reply" name="body" rows="4" maxlength="4000" required></textarea>
      ${ticket.status === "CLOSED" ? html`<p class="hint">Esta solicitud está cerrada. Si escribes, la volvemos a abrir.</p>` : ""}
    </div>
    <button type="submit" class="btn btn-ink justify-self-start">${icon("message-circle")} ${button}</button>
  </form>`;
}
