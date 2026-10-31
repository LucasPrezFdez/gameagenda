import { describe, expect, it } from 'vitest';
import {
  compareReleaseKeys,
  dayNumber,
  groupKey,
  groupOrder,
  localToday,
  type Release,
  type ReleaseInfo,
  releaseFromCore,
  releaseFromDetails,
  releaseSortKey,
  upcomingGroup,
} from './release.ts';

const seconds = (y: number, m: number, d: number, h = 8) => Date.UTC(y, m - 1, d, h) / 1000;
// Lunes, 2 de noviembre de 2026: la semana acaba el domingo 8.
const TODAY = dayNumber(2026, 11, 2);

const day = (y: number, m: number, d: number): Release => ({ kind: 'day', y, m, d });
const info = (release: Release, comingSoon: boolean | null = null): ReleaseInfo => ({
  release,
  comingSoon,
});
const group = (i: ReleaseInfo) => {
  const g = upcomingGroup(i, TODAY);
  return g && groupKey(g);
};

describe('releaseFromDetails', () => {
  it('pasa `[t, p]` a una fecha de calendario en UTC', () => {
    expect(releaseFromDetails(seconds(2026, 11, 19), 'day')).toEqual(day(2026, 11, 19));
    // 23:30 UTC sigue siendo el día 19, aunque en Madrid ya sea el 20.
    expect(releaseFromDetails(seconds(2026, 11, 19, 23), 'day')).toEqual(day(2026, 11, 19));
    expect(releaseFromDetails(seconds(2026, 12, 1), 'month')).toEqual({
      kind: 'month',
      y: 2026,
      m: 12,
    });
    expect(releaseFromDetails(seconds(2027, 2, 15), 'quarter')).toEqual({
      kind: 'quarter',
      y: 2027,
      q: 1,
    });
    expect(releaseFromDetails(seconds(2027, 8, 1), 'quarter')).toEqual({
      kind: 'quarter',
      y: 2027,
      q: 3,
    });
    expect(releaseFromDetails(seconds(2027, 1, 1), 'year')).toEqual({ kind: 'year', y: 2027 });
  });

  it('`soon`, `tba` y sin fecha son «Por confirmar»', () => {
    expect(releaseFromDetails(seconds(2027, 1, 1), 'soon')).toEqual({ kind: 'tbd' });
    expect(releaseFromDetails(seconds(2027, 1, 1), 'tba')).toEqual({ kind: 'tbd' });
    expect(releaseFromDetails(null, 'day')).toEqual({ kind: 'tbd' });
  });
});

describe('releaseFromCore', () => {
  it('usa el año y los bits 1 y 32 del núcleo', () => {
    expect(releaseFromCore({ year: 2027, flags: 1 })).toEqual({
      release: { kind: 'year', y: 2027 },
      comingSoon: true,
    });
    expect(releaseFromCore({ year: 2026, flags: 33 }).release).toEqual({ kind: 'tbd' });
    expect(releaseFromCore({ year: null, flags: 0 })).toEqual({
      release: { kind: 'tbd' },
      comingSoon: false,
    });
  });
});

describe('upcomingGroup (Próximos, §9.2)', () => {
  it('Ya disponibles: lo publicado en los últimos 14 días', () => {
    expect(group(info(day(2026, 10, 25), false))).toBe('recent');
    expect(group(info(day(2026, 10, 19), false))).toBe('recent');
    expect(group(info(day(2026, 10, 18), false))).toBeNull();
    expect(group(info(day(2026, 11, 2), false))).toBe('recent');
  });

  it('Esta semana: de hoy al domingo, si aún no ha salido', () => {
    expect(group(info(day(2026, 11, 2), true))).toBe('week');
    expect(group(info(day(2026, 11, 8)))).toBe('week');
    expect(group(info(day(2026, 11, 9)))).toBe('month-2026-11');
  });

  it('por meses durante 12 meses y después «Más adelante»', () => {
    expect(group(info(day(2026, 12, 10), true))).toBe('month-2026-12');
    expect(group(info(day(2027, 10, 31), true))).toBe('month-2027-10');
    expect(group(info(day(2027, 11, 1), true))).toBe('later');
    expect(group(info({ kind: 'month', y: 2026, m: 11 }, true))).toBe('month-2026-11');
    expect(group(info({ kind: 'quarter', y: 2027, q: 1 }, true))).toBe('later');
    expect(group(info({ kind: 'year', y: 2027 }, true))).toBe('later');
  });

  it('Por confirmar: sin fecha o con una fecha que ya pasó sin salir', () => {
    expect(group(info({ kind: 'tbd' }, true))).toBe('tbd');
    expect(group(info({ kind: 'tbd' }))).toBe('tbd');
    expect(group(info(day(2026, 10, 30), true))).toBe('tbd');
    expect(group(info({ kind: 'month', y: 2026, m: 10 }, true))).toBe('tbd');
    expect(group(info({ kind: 'year', y: 2025 }))).toBe('tbd');
  });

  it('lo ya publicado sin fecha exacta no va en Próximos', () => {
    expect(group(info({ kind: 'tbd' }, false))).toBeNull();
    expect(group(info({ kind: 'year', y: 2026 }, false))).toBeNull();
    expect(group(info(day(2020, 3, 12), false))).toBeNull();
  });

  it('ordena los grupos como la §9.2', () => {
    const keys = [
      { kind: 'tbd' },
      { kind: 'month', y: 2027, m: 1 },
      { kind: 'later' },
      { kind: 'week' },
      { kind: 'month', y: 2026, m: 12 },
      { kind: 'recent' },
    ] as const;
    expect([...keys].sort((a, b) => groupOrder(a) - groupOrder(b)).map((g) => groupKey(g))).toEqual(
      ['recent', 'week', 'month-2026-12', 'month-2027-01', 'later', 'tbd'],
    );
  });
});

describe('releaseSortKey (orden por lanzamiento)', () => {
  it('de lo más antiguo a lo más nuevo; por confirmar y sin datos, al final', () => {
    const items: Array<[string, ReleaseInfo | null]> = [
      ['manual', null],
      ['tbd', info({ kind: 'tbd' }, true)],
      ['2027', info({ kind: 'year', y: 2027 }, true)],
      ['dic', info({ kind: 'month', y: 2026, m: 12 }, true)],
      ['1-dic', info(day(2026, 12, 1), true)],
      ['2020', info(day(2020, 3, 12), false)],
    ];
    const sorted = [...items].sort((a, b) =>
      compareReleaseKeys(releaseSortKey(a[1]), releaseSortKey(b[1])),
    );
    expect(sorted.map(([name]) => name)).toEqual(['2020', '1-dic', 'dic', '2027', 'tbd', 'manual']);
  });

  it('hoy es el día local', () => {
    expect(localToday(new Date(2026, 10, 2, 0, 30))).toBe(TODAY);
    expect(localToday(new Date(2026, 10, 2, 23, 59))).toBe(TODAY);
  });
});
