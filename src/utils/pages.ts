import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Response } from "express";
import { isProduction, isStaging } from "../config/env.js";

export const publicDir = fileURLToPath(new URL("../../public", import.meta.url));

const STAGING_FLAG = `<div class="staging-flag" role="note">Entorno de pruebas</div>`;

/** En el entorno de pruebas: "[Pruebas]" en el título de la pestaña y una franja visible en la página. */
export function markEnvironment(html: string): string {
  if (!isStaging) return html;
  return html.replace("<title>", "<title>[Pruebas] ").replace(/<body([^>]*)>/, `<body$1>\n    ${STAGING_FLAG}`);
}

const cache = new Map<string, string>();

/** Lee una página de public/: una vez en producción; en desarrollo, en cada visita (para ver los cambios). */
export async function readPage(file: string): Promise<string> {
  const cached = cache.get(file);
  if (cached) return cached;
  const html = await readFile(path.join(publicDir, file), "utf8");
  if (isProduction) cache.set(file, html);
  return html;
}

/** Envía una página HTML de public/ marcada según el entorno. */
export async function sendPage(res: Response, file: string, status = 200) {
  res.status(status).type("html").send(markEnvironment(await readPage(file)));
}
