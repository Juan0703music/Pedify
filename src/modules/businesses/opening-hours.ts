import { z } from "zod";
import { dayScheduleSchema, type DaySchedule } from "./businesses.schemas.js";

/** Estado de atención según el horario semanal, calculado en la zona horaria del negocio. */
export interface OpeningStatus {
  isOpen: boolean;
  /** Hora de cierre del turno en curso ("23:30"), si está abierto. */
  closesAt: string | null;
  /** Si está cerrado: próxima apertura (`inDays` 0 = hoy, 1 = mañana…; `day` 0 = domingo). */
  nextOpen: { inDays: number; day: number; time: string } | null;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const toMinutes = (time: string) => {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

/** Día de la semana y minuto del día en la zona horaria indicada (Colombia no tiene horario de verano). */
export function localClock(now: Date, timeZone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return {
    day: WEEKDAY_INDEX[part("weekday")] ?? 0,
    minutes: (Number(part("hour")) % 24) * 60 + Number(part("minute")),
  };
}

/**
 * Calcula si el negocio está abierto. Un turno cuyo cierre es menor que la apertura
 * termina al día siguiente (18:00–02:00); "00:00" como cierre significa medianoche.
 */
export function getOpeningStatus(hours: DaySchedule[], timeZone: string, now = new Date()): OpeningStatus {
  const byDay = new Map(hours.map((entry) => [entry.day, entry]));
  const { day, minutes } = localClock(now, timeZone);

  // Turno de ayer que pasó la medianoche.
  const yesterday = byDay.get((day + 6) % 7);
  if (yesterday && !yesterday.closed && toMinutes(yesterday.close) < toMinutes(yesterday.open) && minutes < toMinutes(yesterday.close)) {
    return { isOpen: true, closesAt: yesterday.close, nextOpen: null };
  }

  const today = byDay.get(day);
  if (today && !today.closed) {
    const open = toMinutes(today.open);
    const close = toMinutes(today.close);
    const overnight = close < open;
    if (minutes >= open && (overnight || minutes < close)) return { isOpen: true, closesAt: today.close, nextOpen: null };
    if (minutes < open) return { isOpen: false, closesAt: null, nextOpen: { inDays: 0, day, time: today.open } };
  }

  for (let offset = 1; offset <= 7; offset++) {
    const nextDay = (day + offset) % 7;
    const entry = byDay.get(nextDay);
    if (entry && !entry.closed) return { isOpen: false, closesAt: null, nextOpen: { inDays: offset, day: nextDay, time: entry.open } };
  }
  return { isOpen: false, closesAt: null, nextOpen: null };
}

/** Lee el horario guardado en JSON; si estuviera dañado se trata como cerrado. */
export function parseOpeningHours(value: unknown): DaySchedule[] {
  const parsed = z.array(dayScheduleSchema).safeParse(value);
  return parsed.success ? [...parsed.data].sort((a, b) => a.day - b.day) : [];
}

const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** "17:00" → "5:00 p. m." (formato habitual en Colombia). */
export function formatTime12(time: string): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "a. m." : "p. m."}`;
}

/** "abre hoy a las 5:00 p. m." / "abre mañana…" / "abre el martes…" */
export function describeNextOpening(nextOpen: OpeningStatus["nextOpen"]): string | null {
  if (!nextOpen) return null;
  const when = nextOpen.inDays === 0 ? "hoy" : nextOpen.inDays === 1 ? "mañana" : `el ${DAY_NAMES[nextOpen.day]}`;
  return `abre ${when} a las ${formatTime12(nextOpen.time)}`;
}
