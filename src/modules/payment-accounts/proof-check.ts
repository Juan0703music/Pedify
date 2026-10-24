import { formatCOP } from "../../utils/currency.js";

/**
 * Verificación automática del comprobante de pago: con el texto leído (OCR) se revisa que sea un pago
 * exitoso, por el valor del pedido, a una cuenta del negocio, de ese momento y no usado en otro pedido.
 * Es una revisión del comprobante: la confirmación definitiva es ver el dinero en la cuenta del negocio.
 */
export type ProofStatus = "VERIFIED" | "REVIEW" | "MISMATCH";
export type CheckKey = "receipt" | "amount" | "recipient" | "date" | "unique";

export interface ProofCheck {
  key: CheckKey;
  /** true = coincide · false = no coincide · null = no se pudo leer. */
  ok: boolean | null;
  title: string;
  detail: string;
}

export interface ParsedReceipt {
  amounts: number[];
  references: string[];
  /** Fecha y hora del pago (hora de Colombia); `hasTime` false si solo se leyó el día. */
  paidAt: { date: Date; hasTime: boolean } | null;
  /** Celulares completos y finales de números ocultos (••• 4567) en el comprobante. */
  phones: string[];
  maskedEndings: string[];
  /** Celulares, llaves o nombres que aparecen junto a «Para», «Destino», «Beneficiario»… */
  recipientLines: string[];
  success: string | null;
  failure: string | null;
  /** Texto en minúsculas y sin tildes, para buscar nombres y llaves. */
  plain: string;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const COLOMBIA_OFFSET_H = 5; // UTC−5, sin horario de verano

const plainText = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const digitsOf = (text: string) => text.replace(/\D/g, "");

/** "$ 36.000,00", "$36000", "S 36.000" (el OCR a veces lee la $ como S) → 36000. */
function readAmounts(text: string): number[] {
  const found = new Set<number>();
  const pattern = /(?:\$|\bS|\bCOP)[ \u00a0]?(\d{1,3}(?:[., \u00a0]\d{3})+|\d{4,9})(?:[.,](\d{2}))?(?!\d)/g;
  for (const match of text.matchAll(pattern)) {
    const value = Number(digitsOf(match[1]!));
    if (value > 0 && value <= 50_000_000) found.add(value);
  }
  return [...found];
}

/** Referencia, número de aprobación o de transacción: un código con al menos 4 cifras. */
function readReferences(lines: string[]): string[] {
  const label = /(referencia|\bref\b|aprobacion|autorizacion|transaccion|operacion|codigo|comprobante n|numero de (pago|movimiento|comprobante))/;
  const found = new Set<string>();
  lines.forEach((line, index) => {
    const plain = plainText(line);
    const at = plain.search(label);
    if (at === -1) return;
    const candidates = `${line.slice(at)} ${lines[index + 1] ?? ""}`.match(/\b[A-Za-z0-9-]{5,24}\b/g) ?? [];
    for (const candidate of candidates) {
      const code = candidate.replace(/-/g, "").toUpperCase();
      if ((code.match(/\d/g) ?? []).length >= 4 && !/^3\d{9}$/.test(code)) {
        found.add(code);
        break;
      }
    }
  });
  return [...found];
}

/** Fecha (23 de octubre de 2026 · 23 oct 2026 · 23/10/2026 · 2026-10-23) y hora (5:32 p. m. · 17:32). */
function readDate(plain: string, fallbackYear: number): ParsedReceipt["paidAt"] {
  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;
  let at = 0;
  const named = /(\d{1,2})\s*(?:de\s+)?(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z.]*\s*(?:de\s+|del\s+)?(\d{4})?/.exec(plain);
  const numeric = /(?<!\d)(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?!\d)/.exec(plain);
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(plain);
  if (named) {
    [day, month, year] = [Number(named[1]), MONTHS.indexOf(named[2]!) + 1, named[3] ? Number(named[3]) : fallbackYear];
    at = named.index;
  } else if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    at = iso.index;
  } else if (numeric) {
    [day, month, year] = [Number(numeric[1]), Number(numeric[2]), Number(numeric[3])];
    if (year < 100) year += 2000;
    at = numeric.index;
  }
  if (!day || !month || !year || month > 12 || day > 31) return null;

  // La hora más cercana después de la fecha (o en cualquier parte del comprobante).
  const timePattern = /(?<!\d)(\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/g;
  const times = [...plain.matchAll(timePattern)];
  const time = times.find((match) => match.index >= at) ?? times[0];
  let hours = 0;
  let minutes = 0;
  if (time) {
    hours = Number(time[1]);
    minutes = Number(time[2]);
    const meridiem = time[3]?.replace(/[\s.]/g, "");
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    if (hours > 23 || minutes > 59) return null;
  }
  return { date: new Date(Date.UTC(year, month - 1, day, hours + COLOMBIA_OFFSET_H, minutes)), hasTime: Boolean(time) };
}

/** Palabras de un pago hecho o fallido, de la más clara a la menos clara. */
const SUCCESS_WORDS = [/exitos[ao]/, /aprobad[ao]/, /completad[ao]/, /realizad[ao]/, /enviaste|transferiste|pagaste/, /pago recibido/, /listo/];
const FAILURE_WORDS = [/no exitos[ao]/, /rechazad[ao]/, /fallid[ao]/, /declinad[ao]/, /no se pudo/, /reversad[ao]/, /pendiente/, /en proceso/];
const firstWord = (plain: string, words: RegExp[]) => words.map((word) => word.exec(plain)?.[0]).find(Boolean) ?? null;

/** Lee del texto del comprobante los datos que se comparan con el pedido. */
export function parseReceipt(text: string, now: Date): ParsedReceipt {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const plain = plainText(text);
  const phones = [...new Set([...text.matchAll(/(?<!\d)3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g)].map((match) => digitsOf(match[0])))];
  const maskedEndings = [...new Set([...text.matchAll(/[*•·xX]{2,}[\s*•·xX-]*(\d{3,4})(?!\d)/g)].map((match) => match[1]!))];
  const recipientLabel = /^(para|destino|destinatario|beneficiario|cuenta destino|producto destino|enviado a|le enviaste a|a nombre de|titular|llave|numero nequi|numero daviplata|numero de celular|celular destino)/;
  const recipientLines = lines.flatMap((line, index) => (recipientLabel.test(plainText(line)) ? [line, lines[index + 1] ?? ""] : []));
  return {
    amounts: readAmounts(text),
    references: readReferences(lines),
    paidAt: readDate(plain, now.getUTCFullYear()),
    phones,
    maskedEndings,
    recipientLines,
    success: firstWord(plain, SUCCESS_WORDS),
    failure: firstWord(plain, FAILURE_WORDS),
    plain,
  };
}

export interface ProofAccount {
  label: string;
  accountKey: string | null;
  holderName: string | null;
}

const maskPhone = (digits: string) => `${digits.slice(0, 3)}•••${digits.slice(-4)}`;
const dayLabel = (date: Date) => new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", timeZone: "America/Bogota" }).format(date);
const timeLabel = (date: Date) => new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" }).format(date);

/** Palabras que no identifican al titular (se ignoran al comparar el nombre). */
const NAME_STOPWORDS = new Set(["de", "del", "la", "las", "los", "el", "y", "sas", "s.a.s", "ltda", "e.u"]);
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ¿El comprobante muestra una de las cuentas del negocio (celular, llave o nombre del titular)? */
function matchRecipient(parsed: ParsedReceipt, accounts: ProofAccount[]): string | null {
  // Las cifras de cada línea, sin espacios (el celular puede venir «300 123 4567»).
  const lineDigits = parsed.plain.split("\n").map(digitsOf);
  for (const account of accounts) {
    const key = account.accountKey?.trim() ?? "";
    const digits = digitsOf(key);
    if (digits.length >= 7) {
      if (lineDigits.some((line) => line.includes(digits))) return `Va a tu ${account.label} ${maskPhone(digits)}.`;
      if (parsed.maskedEndings.includes(digits.slice(-4)) || parsed.maskedEndings.includes(digits.slice(-3))) {
        return `Va a tu ${account.label} terminado en ${digits.slice(-4)}.`;
      }
    } else if (key.length >= 3 && parsed.plain.includes(plainText(key))) {
      return `Va a tu llave ${key}.`;
    }
    const tokens = plainText(account.holderName ?? "")
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !NAME_STOPWORDS.has(token));
    const matched = tokens.filter((token) => new RegExp(`\\b${escapeRegex(token)}\\b`).test(parsed.plain));
    if (tokens.length > 0 && matched.length >= Math.min(2, tokens.length)) return `A nombre de ${account.holderName}.`;
  }
  return null;
}

/** ¿Junto a «Para» o «Destino» aparece un celular que no es del negocio? */
function otherRecipient(parsed: ParsedReceipt, accounts: ProofAccount[]): string | null {
  const ours = accounts.map((account) => digitsOf(account.accountKey ?? "")).filter((digits) => digits.length >= 7);
  for (const line of parsed.recipientLines) {
    for (const match of line.matchAll(/(?<!\d)3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g)) {
      const phone = digitsOf(match[0]);
      if (!ours.includes(phone)) return phone;
    }
  }
  return null;
}

export interface EvaluateInput {
  /** Texto leído; null si no se pudo leer. */
  text: string | null;
  total: number;
  accounts: ProofAccount[];
  uploadedAt: Date;
  /** Pedido que ya usó el mismo archivo o la misma referencia. */
  reusedImageIn: number | null;
  reusedReferenceIn: { reference: string; orderNumber: number } | null;
}

/** Revisa el comprobante contra el pedido y devuelve el resultado con el detalle de cada revisión. */
export function evaluateProof(input: EvaluateInput): { status: ProofStatus; checks: ProofCheck[] } {
  const checks: ProofCheck[] = [];
  const parsed = input.text ? parseReceipt(input.text, input.uploadedAt) : null;

  // 1. Que sea un comprobante de un pago hecho.
  if (!parsed || parsed.plain.replace(/\s/g, "").length < 20) {
    checks.push({ key: "receipt", ok: input.text === null ? null : false, title: "Comprobante", detail: input.text === null ? "No pudimos leer la imagen." : "La imagen no tiene el texto de un comprobante de pago." });
  } else if (parsed.failure) {
    checks.push({ key: "receipt", ok: false, title: "Comprobante", detail: `Dice «${parsed.failure}»: el pago no quedó hecho.` });
  } else if (parsed.success) {
    checks.push({ key: "receipt", ok: true, title: "Comprobante", detail: `Dice «${parsed.success}».` });
  } else {
    checks.push({ key: "receipt", ok: null, title: "Comprobante", detail: "No dice «exitoso» ni «aprobado»." });
  }

  if (parsed) {
    // 2. El valor del pedido.
    if (parsed.amounts.includes(input.total)) {
      checks.push({ key: "amount", ok: true, title: "Valor", detail: `${formatCOP(input.total)}, igual al total del pedido.` });
    } else if (parsed.amounts.length > 0) {
      const closest = parsed.amounts.reduce((best, value) => (Math.abs(value - input.total) < Math.abs(best - input.total) ? value : best));
      checks.push({ key: "amount", ok: false, title: "Valor", detail: `Dice ${formatCOP(closest)} y el pedido es de ${formatCOP(input.total)}.` });
    } else {
      checks.push({ key: "amount", ok: null, title: "Valor", detail: "No pudimos leer el valor." });
    }

    // 3. A una cuenta del negocio.
    const recipient = matchRecipient(parsed, input.accounts);
    const other = recipient ? null : otherRecipient(parsed, input.accounts);
    checks.push(
      recipient
        ? { key: "recipient", ok: true, title: "Destinatario", detail: recipient }
        : other
          ? { key: "recipient", ok: false, title: "Destinatario", detail: `El pago fue a ${maskPhone(other)}, que no es una de tus cuentas.` }
          : { key: "recipient", ok: null, title: "Destinatario", detail: "No pudimos leer a quién se pagó." },
    );

    // 4. De este pedido: hecho poco antes de subirlo (hasta 3 horas antes).
    const paid = parsed.paidAt;
    const uploaded = input.uploadedAt.getTime();
    if (!paid) {
      checks.push({ key: "date", ok: null, title: "Fecha y hora", detail: "No pudimos leer la fecha." });
    } else if (dayLabel(paid.date) !== dayLabel(input.uploadedAt)) {
      checks.push({ key: "date", ok: false, title: "Fecha y hora", detail: `Es del ${dayLabel(paid.date)}: no es de este pedido.` });
    } else if (!paid.hasTime) {
      checks.push({ key: "date", ok: true, title: "Fecha y hora", detail: "Es de hoy (sin hora)." });
    } else if (paid.date.getTime() > uploaded + 15 * 60_000) {
      checks.push({ key: "date", ok: false, title: "Fecha y hora", detail: `Dice ${timeLabel(paid.date)}, una hora que aún no había llegado.` });
    } else if (paid.date.getTime() < uploaded - 3 * 3_600_000) {
      const hours = Math.floor((uploaded - paid.date.getTime()) / 3_600_000);
      checks.push({ key: "date", ok: false, title: "Fecha y hora", detail: `Es de hace ${hours} horas (${timeLabel(paid.date)}): no parece de este pedido.` });
    } else {
      checks.push({ key: "date", ok: true, title: "Fecha y hora", detail: `Hoy a las ${timeLabel(paid.date)}` });
    }
  }

  // 5. Que no se haya usado en otro pedido.
  if (input.reusedImageIn !== null) {
    checks.push({ key: "unique", ok: false, title: "No repetido", detail: `Es el mismo pantallazo del pedido #${input.reusedImageIn}.` });
  } else if (input.reusedReferenceIn) {
    checks.push({ key: "unique", ok: false, title: "No repetido", detail: `La referencia ${input.reusedReferenceIn.reference} ya se usó en el pedido #${input.reusedReferenceIn.orderNumber}.` });
  } else {
    const reference = parsed?.references[0];
    checks.push({ key: "unique", ok: true, title: "No repetido", detail: reference ? `Referencia ${reference}, no usada en otro pedido.` : "No se ha usado en otros pedidos." });
  }

  const ok = (key: CheckKey) => checks.find((check) => check.key === key)?.ok;
  const status: ProofStatus = checks.some((check) => check.ok === false)
    ? "MISMATCH"
    : ok("amount") && ok("recipient") && ok("date") && ok("unique")
      ? "VERIFIED"
      : "REVIEW";
  return { status, checks };
}
