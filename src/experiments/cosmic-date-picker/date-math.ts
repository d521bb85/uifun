export type CosmicMode = "idle" | "day" | "month" | "year";

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export const CURRENT_YEAR = new Date().getFullYear();
export const DEFAULT_MIN_YEAR = CURRENT_YEAR - 120;
export const DEFAULT_MAX_YEAR = CURRENT_YEAR + 30;

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function parseIsoDate(iso: string | null): CalendarDate | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) return null;
  return { year, month, day };
}

export function formatIsoDate({ year, month, day }: CalendarDate): string {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function clampDate(date: CalendarDate, minYear: number, maxYear: number): CalendarDate {
  const year = clamp(date.year, minYear, maxYear);
  const month = clamp(date.month, 1, 12);
  const day = clamp(date.day, 1, daysInMonth(year, month));
  return { year, month, day };
}

export function stepDay(date: CalendarDate, deltaDays: number): CalendarDate {
  if (deltaDays === 0) return date;
  const totalDays = daysInMonth(date.year, date.month);
  const zeroBased = (((date.day - 1 + deltaDays) % totalDays) + totalDays) % totalDays;
  return {
    year: date.year,
    month: date.month,
    day: zeroBased + 1,
  };
}

export function stepMonth(date: CalendarDate, deltaMonths: number): CalendarDate {
  if (deltaMonths === 0) return date;
  const zeroBased = (((date.month - 1 + deltaMonths) % 12) + 12) % 12;
  const month = zeroBased + 1;
  const day = Math.min(date.day, daysInMonth(date.year, month));
  return { year: date.year, month, day };
}

export function stepYear(
  date: CalendarDate,
  deltaYears: number,
  minYear: number,
  maxYear: number,
): CalendarDate {
  if (deltaYears === 0) return date;
  const year = clamp(date.year + deltaYears, minYear, maxYear);
  const day = Math.min(date.day, daysInMonth(year, date.month));
  return { year, month: date.month, day };
}

export function dateToMonthFraction(date: CalendarDate): number {
  const totalDays = daysInMonth(date.year, date.month);
  return (date.month - 1 + (date.day - 1) / totalDays) / 12;
}

export function dateToContinuousYear(date: CalendarDate): number {
  return date.year + dateToMonthFraction(date);
}

export function dateToMoonAngle(date: CalendarDate): number {
  const totalDays = daysInMonth(date.year, date.month);
  return ((date.day - 1) / totalDays) * Math.PI * 2;
}

export function dateToEarthOrbitAngle(date: CalendarDate): number {
  return dateToMonthFraction(date) * Math.PI * 2;
}
