/**
 * Festivos de Colombia: los de fecha fija, los que se corren al lunes siguiente (Ley 51 de 1983,
 * «Ley Emiliani») y los que dependen de la Semana Santa. Fechas en formato AAAA-MM-DD.
 */
const DAY = 86_400_000;
const FIXED = ["01-01", "05-01", "07-20", "08-07", "12-08", "12-25"];
const MOVED_TO_MONDAY = ["01-06", "03-19", "06-29", "08-15", "10-12", "11-01", "11-11"];
/** Días respecto al domingo de Pascua: Jueves y Viernes Santo, Ascensión, Corpus Christi y Sagrado Corazón (ya en lunes). */
const FROM_EASTER = [-3, -2, 43, 64, 71];

const iso = (date: Date) => date.toISOString().slice(0, 10);

/** Domingo de Pascua (algoritmo anónimo gregoriano), a la medianoche UTC. */
function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** El mismo día si es lunes; si no, el lunes siguiente. */
const nextMonday = (date: Date) => new Date(date.getTime() + ((8 - date.getUTCDay()) % 7) * DAY);

const cache = new Map<number, Set<string>>();

export function colombianHolidays(year: number): Set<string> {
  let holidays = cache.get(year);
  if (!holidays) {
    const easterDay = easter(year).getTime();
    holidays = new Set([
      ...FIXED.map((day) => `${year}-${day}`),
      ...MOVED_TO_MONDAY.map((day) => iso(nextMonday(new Date(`${year}-${day}T00:00:00Z`)))),
      ...FROM_EASTER.map((offset) => iso(new Date(easterDay + offset * DAY))),
    ]);
    cache.set(year, holidays);
  }
  return holidays;
}

/** ¿Es festivo en Colombia? (`day` en formato AAAA-MM-DD). */
export const isColombianHoliday = (day: string) => colombianHolidays(Number(day.slice(0, 4))).has(day);
