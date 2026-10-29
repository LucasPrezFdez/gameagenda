import { describe, expect, it } from 'vitest';
import type { AgendaEntry } from '../agenda/types.ts';
import type { QueryState, SearchItem, StatusMessage } from '../search-client/index.ts';
import { buildPaletteModel } from './palette-model.ts';

const status = (state: StatusMessage['state']): StatusMessage => ({
  type: 'status',
  state,
  version: null,
  count: 0,
  progress: 0.4,
  error: null,
});

const game = (appid: number, name: string): SearchItem => ({
  appid,
  name,
  nameEs: null,
  year: 2020,
  flags: 0,
  tier: 1,
});

function query(text: string, items: SearchItem[] | null, suggestions: SearchItem[] = []) {
  return {
    seq: 1,
    text,
    inputTimeStamp: 0,
    results: items && { type: 'results', seq: 1, items, strong: items.length, ms: 0 },
    suggestions: suggestions.length ? { type: 'suggestions', seq: 1, items: suggestions } : null,
    fresh: items !== null,
  } satisfies QueryState;
}

const elden = { id: 'steam:1245620', title: 'ELDEN RING', status: 'completed' } as AgendaEntry;
const inList = new Map([[elden.id, elden]]);

describe('buildPaletteModel', () => {
  it('resultados, «En tu lista» y la fila manual siempre al final', () => {
    const model = buildPaletteModel(
      query('elden', [game(1245620, 'ELDEN RING'), game(2622380, 'ELDEN RING NIGHTREIGN')]),
      status('full'),
      inList,
    );
    expect(model.options.map((o) => o.kind)).toEqual(['game', 'game', 'manual']);
    expect(model.options[0]).toMatchObject({ entry: elden });
    expect(model.defaultIndex).toBe(0);
  });

  it('sin resultados resalta la fila manual; con solo sugerencias, ninguna', () => {
    expect(buildPaletteModel(query('mario kart', []), status('full'), new Map())).toMatchObject({
      defaultIndex: 0,
      noItems: true,
    });
    const onlySuggestions = buildPaletteModel(
      query('hollow knigth', [], [game(367520, 'Hollow Knight')]),
      status('full'),
      new Map(),
    );
    expect(onlySuggestions).toMatchObject({ defaultIndex: -1, onlySuggestions: true });
  });

  it('en `none` busca en Mi lista y no resalta la fila manual', () => {
    const none = buildPaletteModel(query('mario', null), status('none'), inList);
    expect(none.options.map((o) => o.kind)).toEqual(['manual']);
    expect(none.defaultIndex).toBe(-1);
    const fromList = buildPaletteModel(query('eld', null), status('none'), inList);
    expect(fromList.options.map((o) => o.kind)).toEqual(['entry', 'manual']);
    expect(fromList.defaultIndex).toBe(0);
  });

  it('con 8 resultados ofrece verlos en el Catálogo', () => {
    const items = Array.from({ length: 8 }, (_, i) => game(i + 1, `Juego ${i + 1}`));
    const model = buildPaletteModel(query('juego', items), status('full'), new Map());
    expect(model.options.slice(-2).map((o) => o.kind)).toEqual(['catalog', 'manual']);
  });
});
