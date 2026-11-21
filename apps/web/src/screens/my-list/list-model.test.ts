import { describe, expect, it } from 'vitest';
import type { AgendaEntry, Flags, Status } from '../../agenda/types.ts';
import { dayNumber, type ReleaseInfo } from '../../details/release.ts';
import { formatAgendaDay } from '../../details/release-text.ts';
import {
  buildSections,
  countUpcoming,
  countViews,
  DEFAULT_LIST_PARAMS,
  listSearchParams,
  parseListParams,
  priorityOf,
  type ReleaseLookup,
  rowDate,
} from './list-model.ts';

function entry(id: string, status: Status, rank: number, flags: Flags = {}): AgendaEntry {
  return {
    id,
    title: id,
    status,
    flags,
    rank: String(rank).padStart(4, '0'),
    note: '',
    platform: null,
    addedAt: `2026-10-${String(rank).padStart(2, '0')}`,
    startedAt: null,
    completedAt: null,
    platinumAt: null,
    ownedAt: null,
    lastHlc: '1',
  };
}

const entries = [
  entry('Hades II', 'want_to_play', 2),
  entry('Celeste', 'want_to_play', 1),
  entry('Silksong', 'want_to_play', 3, { next: true, owned: true }),
  entry('Stardew', 'playing', 4, { owned: true }),
  entry('Cyberpunk', 'on_hold', 5),
  entry('Elden', 'completed', 6),
];

describe('Mi lista', () => {
  it('«Pendientes»: Jugando, A continuación, Quiero jugar (por rango) y En pausa', () => {
    const sections = buildSections(entries, DEFAULT_LIST_PARAMS);
    expect(sections.map((s) => [s.id, s.entries.map((e) => e.id)])).toEqual([
      ['playing', ['Stardew']],
      ['next', ['Silksong']],
      ['want_to_play', ['Celeste', 'Hades II']],
      ['on_hold', ['Cyberpunk']],
    ]);
    expect(sections.find((s) => s.id === 'on_hold')?.collapsible).toBe(true);
    expect(sections.find((s) => s.id === 'want_to_play')?.ranked).toBe(true);
  });

  it('filtra por compra y texto, y sin prioridad no hay secciones', () => {
    const params = {
      ...DEFAULT_LIST_PARAMS,
      view: 'all',
      purchase: 'owned',
      order: 'name',
    } as const;
    const [section] = buildSections(entries, params);
    expect(section?.id).toBeNull();
    expect(section?.entries.map((e) => e.id)).toEqual(['Silksong', 'Stardew']);
    const text = buildSections(entries, { ...DEFAULT_LIST_PARAMS, q: 'hades' });
    expect(text.flatMap((s) => s.entries.map((e) => e.id))).toEqual(['Hades II']);
  });

  it('cuenta las vistas', () => {
    const counts = countViews(entries, 'any');
    expect(counts.pending).toBe(5);
    expect(counts.want_to_play).toBe(3);
    expect(counts.all).toBe(6);
    expect(countViews(entries, 'not_owned').pending).toBe(3);
  });

  it('lleva vista, filtros y orden a la URL sin los valores por defecto', () => {
    expect(listSearchParams(DEFAULT_LIST_PARAMS).toString()).toBe('');
    const params = { view: 'playing', purchase: 'not_owned', order: 'added', q: 'ha' } as const;
    const search = listSearchParams(params).toString();
    expect(search).toBe('vista=jugando&compra=por-comprar&orden=apuntado&q=ha');
    expect(parseListParams(`?${search}`)).toEqual(params);
    expect(parseListParams('?vista=rara')).toEqual(DEFAULT_LIST_PARAMS);
  });

  it('Multijugador no sale en Pendientes; en Todos, detrás de En pausa, y tiene su vista', () => {
    const withMultiplayer = [
      ...entries,
      entry('Golf It', 'multiplayer', 7),
      entry('PEAK', 'multiplayer', 8, { owned: true }),
      entry('Hollow Knight', 'not_started', 9),
    ];
    const pending = buildSections(withMultiplayer, DEFAULT_LIST_PARAMS);
    expect(pending.some((s) => s.id === 'multiplayer')).toBe(false);
    const all = buildSections(withMultiplayer, { ...DEFAULT_LIST_PARAMS, view: 'all' });
    expect(all.map((s) => s.id)).toEqual([
      'playing',
      'next',
      'want_to_play',
      'on_hold',
      'multiplayer',
      'completed',
      'not_started',
    ]);
    const section = all.find((s) => s.id === 'multiplayer');
    expect(section?.entries.map((e) => e.id)).toEqual(['Golf It', 'PEAK']);
    expect(section?.collapsible).toBe(false);
    const counts = countViews(withMultiplayer, 'any');
    expect(counts.multiplayer).toBe(2);
    expect(counts.pending).toBe(5);
    const view = { ...DEFAULT_LIST_PARAMS, view: 'multiplayer' } as const;
    expect(listSearchParams(view).toString()).toBe('vista=multijugador');
    expect(parseListParams('?vista=multijugador')).toEqual(view);
  });

  it('calcula la prioridad dentro de la vista', () => {
    const hades = entries[0];
    if (!hades) throw new Error('falta Hades II');
    expect(priorityOf(entries, hades)).toEqual({ position: 2, total: 2 });
  });
});

describe('Próximos y orden por lanzamiento (M2, §9.2)', () => {
  const day = (y: number, m: number, d: number) => ({ kind: 'day', y, m, d }) as const;
  // Lunes, 2 de noviembre de 2026.
  const releases: Record<string, ReleaseInfo> = {
    Recién: { release: day(2026, 10, 28), comingSoon: false },
    Viejo: { release: day(2020, 3, 12), comingSoon: false },
    Jueves: { release: day(2026, 11, 5), comingSoon: true },
    Martes: { release: day(2026, 11, 3), comingSoon: true },
    Diciembre: { release: { kind: 'month', y: 2026, m: 12 }, comingSoon: true },
    Lejano: { release: { kind: 'year', y: 2028 }, comingSoon: true },
    Incierto: { release: { kind: 'tbd' }, comingSoon: true },
  };
  const games = [
    ...Object.keys(releases).map((id, i) => entry(id, 'want_to_play', i + 1)),
    entry('Manual', 'want_to_play', 20),
    entry('Completo', 'completed', 21, { owned: true }),
  ];
  const lookup: ReleaseLookup = {
    today: dayNumber(2026, 11, 2),
    get: (e) => releases[e.id] ?? null,
  };
  const upcoming = { ...DEFAULT_LIST_PARAMS, view: 'upcoming' } as const;

  it('agrupa: Ya disponibles, Esta semana, meses, Más adelante y Por confirmar', () => {
    const sections = buildSections(games, upcoming, lookup);
    expect(sections.map((s) => [s.key, s.entries.map((e) => e.id)])).toEqual([
      ['recent', ['Recién']],
      ['week', ['Martes', 'Jueves']],
      ['month-2026-12', ['Diciembre']],
      ['later', ['Lejano']],
      ['tbd', ['Incierto']],
    ]);
    expect(countUpcoming(games, 'any', lookup)).toBe(6);
    expect(countUpcoming(games, 'owned', lookup)).toBe(0);
    expect(countUpcoming(games, 'any', null)).toBeNull();
    // Sin las fechas, aún no hay secciones.
    expect(buildSections(games, upcoming)).toEqual([]);
    expect(parseListParams('?vista=proximos')).toEqual(upcoming);
  });

  it('ordena por lanzamiento: lo más antiguo primero y lo que no tiene fecha, al final', () => {
    const params = { ...DEFAULT_LIST_PARAMS, view: 'all', order: 'release' } as const;
    const [section] = buildSections(games, params, lookup);
    expect(section?.entries.map((e) => e.id)).toEqual([
      'Viejo',
      'Recién',
      'Martes',
      'Jueves',
      'Diciembre',
      'Lejano',
      'Incierto',
      'Completo',
      'Manual',
    ]);
    expect(listSearchParams(params).toString()).toBe('vista=todos&orden=lanzamiento');
  });
});

describe('la fecha de la fila ancha (revisión responsive)', () => {
  it('enseña la que más dice de su estado y, si falta, la anterior', () => {
    const base = entry('Hades II', 'want_to_play', 5);
    expect(rowDate(base)).toEqual({ field: 'addedAt', day: '2026-10-05' });
    expect(rowDate({ ...base, status: 'playing' })).toEqual({
      field: 'addedAt',
      day: '2026-10-05',
    });
    expect(rowDate({ ...base, status: 'on_hold', startedAt: '2026-11' })).toEqual({
      field: 'startedAt',
      day: '2026-11',
    });
    expect(
      rowDate({ ...base, status: 'completed', startedAt: '2026', completedAt: '2026-11-20' }),
    ).toEqual({
      field: 'completedAt',
      day: '2026-11-20',
    });
    expect(rowDate({ ...base, status: 'not_started', startedAt: '2026-11-01' })).toEqual({
      field: 'addedAt',
      day: '2026-10-05',
    });
    expect(rowDate({ ...base, status: 'multiplayer', startedAt: '2026-11-02' })).toEqual({
      field: 'startedAt',
      day: '2026-11-02',
    });
    expect(rowDate({ ...base, addedAt: null })).toBeNull();
  });

  it('las fechas parciales se escriben como tales', () => {
    expect(formatAgendaDay('2026')).toBe('2026');
    expect(formatAgendaDay('2026-10')).toBe('oct 2026');
    expect(formatAgendaDay('2026-10-28')).toBe('28 oct 2026');
  });
});
