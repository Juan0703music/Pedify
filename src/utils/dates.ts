/**
 * Fechas de calendario ("2026-10-16") en la zona horaria del negocio (por defecto America/Bogota).
 * Los reportes diarios deben respetar la hora de Colombia (sección 11 del documento),
 * no la del servidor ni UTC.
 */

/** Minutos que la hora local de `timeZone` está adelantada respecto a UTC en ese instante (Bogotá: −300). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** Instante en que empieza el día `date` en `timeZone`. */
export function startOfDay(date: string, timeZone: string): Date {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  const midnightUtc = Date.UTC(year, month - 1, day);
  return new Date(midnightUtc - offsetMinutes(new Date(midnightUtc), timeZone) * 60_000);
}

/** Fecha de calendario de un instante en `timeZone`. */
export function dateIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** "2026-10-16" + 1 → "2026-10-17" */
export function addDays(date: string, days: number): string {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Días entre dos fechas de calendario (to − from). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
