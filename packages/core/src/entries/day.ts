// Fechas parciales que existen de verdad (§7.4): ida y vuelta por Date.UTC, años 1900–2100.

const DAY_PATTERN = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;
const FULL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

/** `'2019'`, `'2019-05'` o `'2020-02-29'`; rechaza `'2019-00'` y `'2019-02-29'`. */
export function isValidDay(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DAY_PATTERN.exec(value);
  if (m === null) return false;
  const year = Number(m[1]);
  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  const month = m[2] === undefined ? 1 : Number(m[2]);
  const day = m[3] === undefined ? 1 : Number(m[3]);
  const t = new Date(Date.UTC(year, month - 1, day));
  return t.getUTCFullYear() === year && t.getUTCMonth() === month - 1 && t.getUTCDate() === day;
}

/** Fecha completa `AAAA-MM-DD` (la de «hoy» que pasa la web). */
export function isFullDate(value: unknown): value is string {
  return typeof value === 'string' && FULL_DATE_PATTERN.test(value) && isValidDay(value);
}
