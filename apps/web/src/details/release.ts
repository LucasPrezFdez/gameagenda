// Fechas de lanzamiento de los *shards* (§7.6) como fechas de calendario, y los grupos de la vista
// Próximos (§9.2): Ya disponibles (14 días) · Esta semana · por meses · Más adelante · Por
// confirmar. Sin DOM ni React; los textos están en `release-text.ts`.
import type { ReleasePrecision } from '@gameagenda/core/catalog-format';

/** Lanzamiento con su precisión; las fechas son de calendario (Steam las da en UTC). */
export type Release =
  | { readonly kind: 'tbd' }
  | { readonly kind: 'day'; readonly y: number; readonly m: number; readonly d: number }
  | { readonly kind: 'month'; readonly y: number; readonly m: number }
  | { readonly kind: 'quarter'; readonly y: number; readonly q: number }
  | { readonly kind: 'year'; readonly y: number };

export interface ReleaseInfo {
  readonly release: Release;
  /**
   * Lo que dice el núcleo (bit 1 de `flags`): `true` si aún no ha salido, `false` si ya está
   * publicado y `null` si no se sabe.
   */
  readonly comingSoon: boolean | null;
}

/** Día de calendario como número de días desde 1970-01-01. */
export type DayNumber = number;

const DAY_MS = 86_400_000;
export const RECENT_DAYS = 14;
/** Meses con grupo propio, contando el actual; lo posterior va a «Más adelante». */
export const MONTHS_AHEAD = 12;

const TBD: Release = { kind: 'tbd' };

export function dayNumber(y: number, m: number, d: number): DayNumber {
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** El día de hoy en el calendario local del usuario. */
export function localToday(now: Date): DayNumber {
  return dayNumber(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** `release` de un *shard*: `[t, p]`, con `t` en segundos Unix (o `null`). */
export function releaseFromDetails(time: number | null, precision: ReleasePrecision): Release {
  if (time === null || precision === 'soon' || precision === 'tba') return TBD;
  const date = new Date(time * 1000);
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  switch (precision) {
    case 'day':
      return { kind: 'day', y, m, d: date.getUTCDate() };
    case 'month':
      return { kind: 'month', y, m };
    case 'quarter':
      return { kind: 'quarter', y, q: Math.floor((m - 1) / 3) + 1 };
    case 'year':
      return { kind: 'year', y };
  }
}

const FLAG_COMING_SOON = 1;
const FLAG_DATE_TBA = 32;

/** Sin *shard*: el año y los bits del núcleo (§7.6), con precisión de año. */
export function releaseFromCore(game: { year: number | null; flags: number }): ReleaseInfo {
  const comingSoon = (game.flags & FLAG_COMING_SOON) !== 0;
  const release: Release =
    (game.flags & FLAG_DATE_TBA) !== 0 || game.year === null ? TBD : { kind: 'year', y: game.year };
  return { release, comingSoon };
}

/** Primer y último día del periodo del lanzamiento (`null` si está por confirmar). */
export function releasePeriod(release: Release): readonly [DayNumber, DayNumber] | null {
  switch (release.kind) {
    case 'tbd':
      return null;
    case 'day': {
      const day = dayNumber(release.y, release.m, release.d);
      return [day, day];
    }
    case 'month':
      return [dayNumber(release.y, release.m, 1), dayNumber(release.y, release.m + 1, 1) - 1];
    case 'quarter': {
      const first = (release.q - 1) * 3 + 1;
      return [dayNumber(release.y, first, 1), dayNumber(release.y, first + 3, 1) - 1];
    }
    case 'year':
      return [dayNumber(release.y, 1, 1), dayNumber(release.y + 1, 1, 1) - 1];
  }
}

export type UpcomingGroup =
  | { readonly kind: 'recent' }
  | { readonly kind: 'week' }
  | { readonly kind: 'month'; readonly y: number; readonly m: number }
  | { readonly kind: 'later' }
  | { readonly kind: 'tbd' };

function monthIndex(y: number, m: number): number {
  return y * 12 + (m - 1);
}

function calendarOf(day: DayNumber): { y: number; m: number; d: number; weekday: number } {
  const date = new Date(day * DAY_MS);
  // Lunes = 1 … domingo = 7: en España la semana empieza el lunes.
  const weekday = ((date.getUTCDay() + 6) % 7) + 1;
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate(), weekday };
}

function monthGroup(y: number, m: number, today: DayNumber): UpcomingGroup {
  const now = calendarOf(today);
  return monthIndex(y, m) - monthIndex(now.y, now.m) < MONTHS_AHEAD
    ? { kind: 'month', y, m }
    : { kind: 'later' };
}

/**
 * Grupo de Próximos, o `null` si el juego no va en la vista (salió hace más de 14 días). Una
 * fecha pasada de un juego que el núcleo aún da por «próximamente» ya no vale: «Por confirmar».
 */
export function upcomingGroup(info: ReleaseInfo, today: DayNumber): UpcomingGroup | null {
  const { release, comingSoon } = info;
  if (release.kind === 'tbd') return comingSoon === false ? null : { kind: 'tbd' };
  const weekEnd = today + (7 - calendarOf(today).weekday);
  if (release.kind === 'day') {
    const day = dayNumber(release.y, release.m, release.d);
    if (day < today) {
      if (comingSoon === true) return { kind: 'tbd' };
      return day >= today - RECENT_DAYS ? { kind: 'recent' } : null;
    }
    if (day === today && comingSoon === false) return { kind: 'recent' };
    if (day <= weekEnd) return { kind: 'week' };
    return monthGroup(release.y, release.m, today);
  }
  // Mes, trimestre o año: solo cuentan si aún no ha salido.
  if (comingSoon === false) return null;
  const period = releasePeriod(release);
  if (period && period[1] < today) return { kind: 'tbd' };
  return release.kind === 'month' ? monthGroup(release.y, release.m, today) : { kind: 'later' };
}

/** Orden de los grupos: Ya disponibles, Esta semana, meses, Más adelante y Por confirmar. */
export function groupOrder(group: UpcomingGroup): number {
  switch (group.kind) {
    case 'recent':
      return 0;
    case 'week':
      return 1;
    case 'month':
      return 2 + monthIndex(group.y, group.m);
    case 'later':
      return Number.MAX_SAFE_INTEGER - 1;
    case 'tbd':
      return Number.MAX_SAFE_INTEGER;
  }
}

export function groupKey(group: UpcomingGroup): string {
  return group.kind === 'month'
    ? `month-${group.y}-${String(group.m).padStart(2, '0')}`
    : group.kind;
}

const PRECISION_RANK: Readonly<Record<Exclude<Release['kind'], 'tbd'>, number>> = {
  day: 0,
  month: 1,
  quarter: 2,
  year: 3,
};

/**
 * Clave del orden por lanzamiento: primero lo más antiguo, por el primer día de su periodo (a
 * igual día, lo más preciso); después lo que está por confirmar y, al final, lo que no tiene
 * fecha conocida (juegos manuales o sin datos).
 */
export function releaseSortKey(info: ReleaseInfo | null | undefined): readonly [number, number] {
  if (!info) return [Number.POSITIVE_INFINITY, 1];
  const period = releasePeriod(info.release);
  if (!period || info.release.kind === 'tbd') return [Number.POSITIVE_INFINITY, 0];
  return [period[0], PRECISION_RANK[info.release.kind]];
}

export function compareReleaseKeys(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  return a[1] - b[1];
}

/** Días hasta el lanzamiento (negativo si ya pasó), solo con precisión de día. */
export function daysUntil(release: Release, today: DayNumber): number | null {
  return release.kind === 'day' ? dayNumber(release.y, release.m, release.d) - today : null;
}
