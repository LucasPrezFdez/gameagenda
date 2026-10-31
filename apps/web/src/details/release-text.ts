// Textos de los lanzamientos (§9.9): fechas con `Intl` es-ES («28 oct 2026», «dentro de 22
// días»), meses («Noviembre de 2026») y «Por confirmar». Las fechas son de calendario, en UTC.
import { es } from '../i18n/es.ts';
import {
  type DayNumber,
  daysUntil,
  RECENT_DAYS,
  type ReleaseInfo,
  type UpcomingGroup,
} from './release.ts';

interface Formats {
  readonly day: Intl.DateTimeFormat;
  readonly dayWithWeekday: Intl.DateTimeFormat;
  readonly month: Intl.DateTimeFormat;
  readonly relative: Intl.RelativeTimeFormat;
}

let formats: Formats | null = null;

/** Los formateadores se crean la primera vez (no en el arranque). */
function f(): Formats {
  formats ??= {
    day: new Intl.DateTimeFormat('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }),
    dayWithWeekday: new Intl.DateTimeFormat('es-ES', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }),
    month: new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    relative: new Intl.RelativeTimeFormat('es-ES', { numeric: 'auto' }),
  };
  return formats;
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase('es-ES') + text.slice(1);
}

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

/** «Noviembre de 2026». */
export function monthLabel(y: number, m: number): string {
  return capitalize(f().month.format(utc(y, m, 1)));
}

/** «28 oct 2026». */
export function formatDay(y: number, m: number, d: number): string {
  return f().day.format(utc(y, m, d));
}

/**
 * Lanzamiento para una fila o la ficha: «Sale el jue, 19 nov 2026 · dentro de 22 días», «Salió
 * el 28 oct 2026 · hace 3 días», «28 oct 2026», «Noviembre de 2026», «Primer trimestre de 2027»,
 * «2027» o «Por confirmar».
 */
export function releaseText(info: ReleaseInfo, today: DayNumber): string {
  const { release, comingSoon } = info;
  switch (release.kind) {
    case 'tbd':
      return es.release.tbd;
    case 'month':
      return monthLabel(release.y, release.m);
    case 'quarter':
      return es.release.quarter(release.q, release.y);
    case 'year':
      return String(release.y);
    case 'day': {
      const days = daysUntil(release, today) ?? 0;
      const { y, m, d } = release;
      if (days > 0) {
        return es.release.upcoming(
          f().dayWithWeekday.format(utc(y, m, d)),
          f().relative.format(days, 'day'),
        );
      }
      if (days === 0) return comingSoon === false ? es.release.outToday : es.release.today;
      // Una fecha pasada de un juego aún «próximamente», o algo publicado hace tiempo: la fecha.
      if (comingSoon === true || -days > RECENT_DAYS) return formatDay(y, m, d);
      return es.release.recent(formatDay(y, m, d), f().relative.format(days, 'day'));
    }
  }
}

/** Título de un grupo de Próximos. */
export function groupLabel(group: UpcomingGroup): string {
  switch (group.kind) {
    case 'recent':
      return es.list.upcoming.recent;
    case 'week':
      return es.list.upcoming.week;
    case 'month':
      return monthLabel(group.y, group.m);
    case 'later':
      return es.list.upcoming.later;
    case 'tbd':
      return es.list.upcoming.tbd;
  }
}
