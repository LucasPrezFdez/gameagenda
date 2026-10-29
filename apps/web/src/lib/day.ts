// Fechas parciales de la ficha: `AAAA`, `AAAA-MM` o `AAAA-MM-DD`, que existan y entre 1900 y
// 2100 (ver §7.4). En la agenda real lo valida el esquema Zod de `@gameagenda/core`.

const DAY = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

export function isValidDay(value: string): boolean {
  const match = DAY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  if (year < 1900 || year > 2100) return false;
  if (match[2] === undefined) return true;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return false;
  if (match[3] === undefined) return true;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
