import { describe, expect, it } from 'vitest';
import type { AgendaEntry, Flags, Status } from '../../agenda/types.ts';
import {
  buildSections,
  countViews,
  DEFAULT_LIST_PARAMS,
  listSearchParams,
  parseListParams,
  priorityOf,
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

  it('calcula la prioridad dentro de la vista', () => {
    const hades = entries[0];
    if (!hades) throw new Error('falta Hades II');
    expect(priorityOf(entries, hades)).toEqual({ position: 2, total: 2 });
  });
});
