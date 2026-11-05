import { randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { SupportKind } from "../../generated/prisma/enums.js";
import { mailer } from "../../services/mail.service.js";
import { clock } from "../../utils/clock.js";
import { notFound } from "../../utils/errors.js";
import { businessDaysAfter } from "../../utils/holidays.js";
import { escapeHtml } from "../../utils/html.js";
import { logger } from "../../utils/logger.js";
import { buildPage } from "../../utils/pagination.js";
import { pushService } from "../push/push.service.js";
import type { AdminTicketsQuery, CreateTicketInput, PublicTicketInput } from "./support.schemas.js";

/**
 * Soporte y PQRS (peticiones, quejas, reclamos y sugerencias) para Pedify. Los negocios escriben desde su
 * panel y cualquier persona desde /soporte (con «No soy un robot» y un enlace propio para seguir el caso);
 * el equipo de Pedify responde desde el panel central. Cada caso tiene número (PQRS-00012) y plazo de
 * 15 días hábiles. A quien escribe le llega el acuse y cada respuesta por correo (y al celular si es un
 * negocio con avisos); al equipo, cada caso nuevo y cada respuesta por correo y al celular.
 */
export const KIND_LABEL: Record<SupportKind, string> = {
  CONSULTA: "Duda o ayuda",
  PETICION: "Petición",
  QUEJA: "Queja",
  RECLAMO: "Reclamo",
  SUGERENCIA: "Sugerencia",
};
export const RESPONSE_BUSINESS_DAYS = 15;
export const ticketCode = (number: number) => `PQRS-${String(number).padStart(5, "0")}`;

const ticketSelect = {
  id: true,
  number: true,
  kind: true,
  status: true,
  subject: true,
  name: true,
  email: true,
  phone: true,
  userId: true,
  businessId: true,
  accessKey: true,
  dueAt: true,
  lastMessageAt: true,
  requesterSeenAt: true,
  closedAt: true,
  createdAt: true,
  business: { select: { id: true, name: true, slug: true } },
} as const;
const messageSelect = { id: true, author: true, body: true, createdAt: true, user: { select: { name: true } } } as const;

type Ticket = Prisma.SupportTicketGetPayload<{ select: typeof ticketSelect }>;

const longDate = (date: Date) => new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", timeZone: "America/Bogota" }).format(date);
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** El caso tal como lo ve quien lo envió (sin la clave del enlace). */
function view({ accessKey: _key, ...ticket }: Ticket) {
  return {
    ...ticket,
    code: ticketCode(ticket.number),
    kindLabel: KIND_LABEL[ticket.kind],
    /** Pedify respondió después de la última vez que lo abrió. */
    unread: ticket.status !== "OPEN" && (!ticket.requesterSeenAt || ticket.requesterSeenAt < ticket.lastMessageAt),
  };
}

/** Dónde ve el caso quien lo envió: su panel, o el enlace con la clave si escribió desde /soporte. */
const requesterLink = (ticket: Ticket) =>
  new URL(ticket.userId && !ticket.accessKey ? `/panel/soporte#${ticket.id}` : `/soporte#${ticket.id}.${ticket.accessKey}`, env.APP_URL).toString();

const button = (link: string, label: string) =>
  `<p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#17161c;color:#ffffff;border-radius:10px;text-decoration:none;font-weight:600">${label}</a></p>`;

/** Al equipo de Pedify: un caso nuevo o una respuesta de quien lo envió (correo y aviso al celular). */
async function notifyTeam(ticket: Ticket, event: "new" | "reply", body: string) {
  const code = ticketCode(ticket.number);
  const who = ticket.business ? `${ticket.business.name} (${ticket.name})` : ticket.name;
  const subject = event === "new" ? `Nueva solicitud ${code} · ${KIND_LABEL[ticket.kind]}: ${ticket.subject}` : `Nueva respuesta en ${code}: ${ticket.subject}`;
  const link = new URL("/admin#soporte", env.APP_URL).toString();
  const admins = await prisma.user.findMany({ where: { isPlatformAdmin: true }, select: { email: true } });
  await Promise.all([
    pushService
      .notifyAdmins({ title: event === "new" ? `Nueva solicitud · ${KIND_LABEL[ticket.kind]}` : `Respuesta en ${code}`, body: `${who} · ${ticket.subject}`, url: "/admin#soporte", tag: `soporte-${ticket.id}` })
      .catch((err: unknown) => logger.error({ err }, "No se pudo enviar el aviso de soporte al celular")),
    ...admins.map((admin) =>
      mailer
        .send({
          to: admin.email,
          subject,
          text: [`${who} <${ticket.email}> escribió:`, "", body, "", `Plazo para responder: ${longDate(ticket.dueAt)}.`, `Respóndele en ${link}`].join("\n"),
          html: `<p><strong>${escapeHtml(who)}</strong> &lt;${escapeHtml(ticket.email)}&gt; escribió:</p>
<blockquote style="margin:0;padding:8px 14px;border-left:3px solid #ffc72c;white-space:pre-wrap">${escapeHtml(body)}</blockquote>
<p>Plazo para responder: <strong>${longDate(ticket.dueAt)}</strong>.</p>${button(link, "Responder")}`,
        })
        .catch((err: unknown) => logger.error({ err }, "No se pudo enviar el correo de soporte al equipo")),
    ),
  ]);
}

/** A quien envió el caso: el acuse de recibo o la respuesta de Pedify. */
async function notifyRequester(ticket: Ticket, event: "received" | "answered", body?: string) {
  const code = ticketCode(ticket.number);
  const link = requesterLink(ticket);
  const received = event === "received";
  const subject = received ? `Recibimos tu solicitud ${code}` : `Respondimos tu solicitud ${code}`;
  const intro = received
    ? `Recibimos tu solicitud ${code} (${KIND_LABEL[ticket.kind]}): «${ticket.subject}». Te responderemos a más tardar el ${longDate(ticket.dueAt)}.`
    : `El equipo de Pedify respondió tu solicitud ${code} (${KIND_LABEL[ticket.kind]}): «${ticket.subject}».`;
  await Promise.all([
    mailer
      .send({
        to: ticket.email,
        subject,
        text: [`Hola, ${firstName(ticket.name)}:`, "", intro, ...(body ? ["", body] : []), "", `Mira la conversación y responde aquí: ${link}`].join("\n"),
        html: `<p>Hola, ${escapeHtml(firstName(ticket.name))}:</p><p>${escapeHtml(intro)}</p>
${body ? `<blockquote style="margin:0;padding:8px 14px;border-left:3px solid #ffc72c;white-space:pre-wrap">${escapeHtml(body)}</blockquote>` : ""}
${button(link, "Ver la conversación")}`,
      })
      .catch((err: unknown) => logger.error({ err }, "No se pudo enviar el correo de soporte")),
    !received && ticket.userId && ticket.businessId
      ? pushService
          .notifyUserInBusiness(ticket.userId, ticket.businessId, { title: `Respondimos tu solicitud ${code}`, body: ticket.subject, url: `/panel/soporte#${ticket.id}`, tag: `soporte-${ticket.id}` })
          .catch((err: unknown) => logger.error({ err }, "No se pudo enviar el aviso de soporte al celular"))
      : null,
  ]);
}

const keysMatch = (given: string, stored: string | null) => {
  if (!stored || given.length !== stored.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(stored));
};

async function open(data: {
  userId?: string;
  businessId?: string | null;
  name: string;
  email: string;
  phone?: string | null;
  accessKey?: string;
  input: CreateTicketInput;
}) {
  const now = clock.now();
  const ticket = await prisma.supportTicket.create({
    data: {
      kind: data.input.kind,
      subject: data.input.subject,
      userId: data.userId ?? null,
      businessId: data.businessId ?? null,
      name: data.name,
      email: data.email,
      phone: data.phone ?? null,
      accessKey: data.accessKey ?? null,
      dueAt: businessDaysAfter(now, RESPONSE_BUSINESS_DAYS),
      lastMessageAt: now,
      requesterSeenAt: now,
      messages: { create: { author: "REQUESTER", userId: data.userId ?? null, body: data.input.message } },
    },
    select: ticketSelect,
  });
  await Promise.all([notifyRequester(ticket, "received"), notifyTeam(ticket, "new", data.input.message)]);
  return ticket;
}

/** Quien lo envió escribe otra vez: el caso vuelve a quedar por responder (aunque estuviera cerrado). */
async function addRequesterMessage(ticket: Ticket, body: string, userId: string | null) {
  const now = clock.now();
  await prisma.supportMessage.create({ data: { ticketId: ticket.id, author: "REQUESTER", userId, body } });
  const updated = await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: { status: "OPEN", closedAt: null, lastMessageAt: now, requesterSeenAt: now },
    select: ticketSelect,
  });
  await notifyTeam(updated, "reply", body);
  return updated;
}

async function withMessages(ticket: Ticket) {
  const messages = await prisma.supportMessage.findMany({ where: { ticketId: ticket.id }, orderBy: { createdAt: "asc" }, select: messageSelect });
  return {
    ...view(ticket),
    messages: messages.map(({ user, ...message }) => ({ ...message, authorName: message.author === "PEDIFY" ? "Equipo de Pedify" : (user?.name ?? ticket.name) })),
  };
}

export const supportService = {
  // ─── Desde el panel del negocio ───

  async createForUser(auth: { userId: string; activeBusinessId: string | null }, input: CreateTicketInput) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { name: true, email: true } });
    const ticket = await open({ userId: auth.userId, businessId: auth.activeBusinessId, name: user.name, email: user.email, input });
    return withMessages(ticket);
  },

  async listForUser(userId: string) {
    const tickets = await prisma.supportTicket.findMany({ where: { userId }, orderBy: { lastMessageAt: "desc" }, take: 100, select: ticketSelect });
    return tickets.map(view);
  },

  async unreadForUser(userId: string) {
    const [row] = await prisma.$queryRaw<{ unread: number }[]>`
      SELECT COUNT(*)::int AS unread FROM support_tickets
      WHERE user_id = ${userId}::uuid AND status <> 'OPEN' AND (requester_seen_at IS NULL OR requester_seen_at < last_message_at)`;
    return row?.unread ?? 0;
  },

  /** El caso con su conversación; al abrirlo, las respuestas quedan vistas. */
  async getForUser(userId: string, id: string) {
    const ticket = await prisma.supportTicket.findFirst({ where: { id, userId }, select: { id: true } });
    if (!ticket) throw notFound("No encontramos esa solicitud.", "TICKET_NOT_FOUND");
    return withMessages(await prisma.supportTicket.update({ where: { id }, data: { requesterSeenAt: clock.now() }, select: ticketSelect }));
  },

  async replyAsUser(userId: string, id: string, body: string) {
    const ticket = await prisma.supportTicket.findFirst({ where: { id, userId }, select: ticketSelect });
    if (!ticket) throw notFound("No encontramos esa solicitud.", "TICKET_NOT_FOUND");
    return withMessages(await addRequesterMessage(ticket, body, userId));
  },

  // ─── Desde /soporte, sin cuenta ───

  async createPublic(input: PublicTicketInput) {
    const accessKey = randomBytes(24).toString("base64url");
    const ticket = await open({ name: input.name, email: input.email, phone: input.phone ?? null, accessKey, input });
    return { ...(await withMessages(ticket)), key: accessKey };
  },

  async getWithKey(id: string, key: string) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id }, select: ticketSelect });
    if (!ticket || !keysMatch(key, ticket.accessKey)) throw notFound("No encontramos esa solicitud. Revisa el enlace del correo.", "TICKET_NOT_FOUND");
    return withMessages(await prisma.supportTicket.update({ where: { id }, data: { requesterSeenAt: clock.now() }, select: ticketSelect }));
  },

  async replyWithKey(id: string, key: string, body: string) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id }, select: ticketSelect });
    if (!ticket || !keysMatch(key, ticket.accessKey)) throw notFound("No encontramos esa solicitud. Revisa el enlace del correo.", "TICKET_NOT_FOUND");
    return withMessages(await addRequesterMessage(ticket, body, null));
  },

  // ─── Panel central de Pedify ───

  async adminList(query: AdminTicketsQuery) {
    const where = query.status === "ALL" ? {} : { status: query.status };
    const [items, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        // Por responder: primero el que vence antes.
        orderBy: query.status === "OPEN" ? [{ dueAt: "asc" }] : [{ lastMessageAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: { ...ticketSelect, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { author: true, body: true } } },
      }),
      prisma.supportTicket.count({ where }),
    ]);
    const now = clock.now();
    return buildPage(
      items.map(({ messages, ...ticket }) => ({ ...view(ticket), lastMessage: messages[0] ?? null, overdue: ticket.status === "OPEN" && ticket.dueAt < now })),
      total,
      query,
    );
  },

  async adminGet(id: string) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id }, select: ticketSelect });
    if (!ticket) throw notFound("No encontramos esa solicitud.", "TICKET_NOT_FOUND");
    return { ...(await withMessages(ticket)), overdue: ticket.status === "OPEN" && ticket.dueAt < clock.now() };
  },

  /** Pedify responde (y, si quiere, cierra el caso): le llega a quien lo envió por correo y al celular. */
  async adminReply(adminId: string, id: string, body: string, close = false) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id }, select: { id: true } });
    if (!ticket) throw notFound("No encontramos esa solicitud.", "TICKET_NOT_FOUND");
    const now = clock.now();
    await prisma.supportMessage.create({ data: { ticketId: id, author: "PEDIFY", userId: adminId, body } });
    const updated = await prisma.supportTicket.update({
      where: { id },
      data: { status: close ? "CLOSED" : "ANSWERED", closedAt: close ? now : null, lastMessageAt: now },
      select: ticketSelect,
    });
    await notifyRequester(updated, "answered", body);
    logger.info({ adminId, ticketId: id, close }, "Solicitud de soporte respondida");
    return supportService.adminGet(id);
  },

  async adminSetStatus(id: string, status: "OPEN" | "CLOSED") {
    const ticket = await prisma.supportTicket.findUnique({ where: { id }, select: { id: true } });
    if (!ticket) throw notFound("No encontramos esa solicitud.", "TICKET_NOT_FOUND");
    await prisma.supportTicket.update({ where: { id }, data: { status, closedAt: status === "CLOSED" ? clock.now() : null } });
    return supportService.adminGet(id);
  },

  /** Por responder y, de esos, los que ya pasaron el plazo. */
  async counts() {
    const [open, overdue] = await Promise.all([
      prisma.supportTicket.count({ where: { status: "OPEN" } }),
      prisma.supportTicket.count({ where: { status: "OPEN", dueAt: { lt: clock.now() } } }),
    ]);
    return { open, overdue };
  },
};
