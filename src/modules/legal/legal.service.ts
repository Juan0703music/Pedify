import { prisma } from "../../config/database.js";
import { escapeHtml } from "../../utils/html.js";
import { markEnvironment, readPage } from "../../utils/pages.js";
import { formatColombianPhone } from "../../utils/phone.js";
import { ID_TYPE_LABEL } from "../../utils/id-document.js";
import type { UpdateLegalInput } from "./legal.schemas.js";

/** Páginas legales: llevan los datos de Pedify (el responsable) que se llenan en el panel central. */
export const LEGAL_PAGES: Record<string, string> = {
  "/privacidad": "pages/legal/privacy.html",
  "/terminos": "pages/legal/terms.html",
};

const PENDING = `<span class="legal-pending">[pendiente]</span>`;

export const legalService = {
  get() {
    return prisma.platformLegal.findUnique({ where: { id: 1 }, omit: { id: true } });
  },

  update(input: UpdateLegalInput) {
    const data = { ...input, phone: input.phone ?? null };
    return prisma.platformLegal.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data, omit: { id: true } });
  },

  /**
   * La página con los datos de Pedify en lugar de `{{legal.*}}`. Mientras no se hayan llenado, se ve
   * «[pendiente]» y el aviso entre `<!--legal-pending-->` y `<!--/legal-pending-->`.
   */
  async render(file: string): Promise<string> {
    const [html, legal] = await Promise.all([readPage(file), legalService.get()]);
    const fields: Record<string, string> = legal
      ? {
          name: escapeHtml(legal.legalName),
          id: escapeHtml(`${ID_TYPE_LABEL[legal.idType]} ${legal.idNumber}`),
          address: escapeHtml(`${legal.address}, ${legal.city}`),
          email: `<a href="mailto:${escapeHtml(legal.email)}">${escapeHtml(legal.email)}</a>`,
          phone: legal.phone ? escapeHtml(formatColombianPhone(legal.phone)) : "",
        }
      : {};
    const filled = html
      .replace(/\{\{legal\.(\w+)\}\}/g, (_match, key: string) => fields[key] ?? (legal ? "" : PENDING))
      .replace(/<!--legal-pending-->([\s\S]*?)<!--\/legal-pending-->/g, legal ? "" : "$1");
    return markEnvironment(filled);
  },
};
