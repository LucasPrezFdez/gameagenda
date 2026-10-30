import { describe, expect, it } from 'vitest';
import type { AgendaEntry } from '../agenda/types.ts';
import type { QueryState, SearchItem, StatusMessage } from '../search-client/index.ts';
import { buildPaletteModel, linkInText, provisionalTitle } from './palette-model.ts';

const status = (state: StatusMessage['state']): StatusMessage => ({
  type: 'status',
  state,
  version: null,
  count: 0,
  progress: 0.4,
  error: null,
  catalog: null,
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

describe('pegar un enlace (RF-04)', () => {
  const url = 'https://store.steampowered.com/app/1030300/Hollow_Knight_Silksong/';
  const pasted = (text: string, found: SearchItem | null | undefined) => {
    const link = linkInText(text);
    return link && { ...link, game: found };
  };

  it('reconoce los seis formatos y el enlace dentro de un texto', () => {
    for (const text of [
      url,
      'https://s.team/a/1030300',
      'https://steamcommunity.com/app/1030300',
      'steam://store/1030300',
      'https://steamdb.info/app/1030300/',
      'appid:1030300',
    ]) {
      expect(linkInText(text)).toMatchObject({ link: { appid: 1030300 }, whole: true });
    }
    expect(linkInText(`Mira esto: ${url}`)).toMatchObject({ whole: false });
    expect(linkInText('hollow knight')).toBeNull();
  });

  it('con el juego en el catálogo, la única fila es «Apuntar» con su nombre', () => {
    const silksong = game(1030300, 'Hollow Knight: Silksong');
    const model = buildPaletteModel(
      query(url, []),
      status('full'),
      new Map(),
      pasted(url, silksong),
    );
    expect(model.options).toEqual([
      expect.objectContaining({
        kind: 'link',
        appid: 1030300,
        title: 'Hollow Knight: Silksong',
        provisional: false,
        resolving: false,
      }),
    ]);
    expect(model.defaultIndex).toBe(0);
    expect(model.noItems).toBe(false);
  });

  it('un `appid` desconocido o sin catálogo queda provisional con el título del *slug*', () => {
    const unknown = buildPaletteModel(query(url, []), status('full'), new Map(), pasted(url, null));
    expect(unknown.options[0]).toMatchObject({
      title: 'Hollow Knight Silksong',
      provisional: true,
    });
    const none = buildPaletteModel(
      query(url, null),
      status('none'),
      new Map(),
      pasted(url, undefined),
    );
    expect(none.options[0]).toMatchObject({ provisional: true, resolving: false });
    const noSlug = 'https://s.team/a/42';
    const model = buildPaletteModel(
      query(noSlug, []),
      status('full'),
      new Map(),
      pasted(noSlug, null),
    );
    expect(model.options[0]).toMatchObject({
      title: provisionalTitle({ appid: 42, title: null, source: 's.team' }),
    });
    expect(provisionalTitle({ appid: 42, title: null, source: 's.team' })).toBe(
      'Juego de Steam 42',
    );
  });

  it('si ya está apuntado lo dice; el enlace dentro de un texto va antes que los resultados', () => {
    const elden = buildPaletteModel(
      query('appid:1245620', []),
      status('full'),
      inList,
      pasted('appid:1245620', game(1245620, 'ELDEN RING')),
    );
    expect(elden.options[0]).toMatchObject({ kind: 'link', entry: inList.get('steam:1245620') });
    const text = `elden ${url}`;
    const mixed = buildPaletteModel(
      query(text, [game(1245620, 'ELDEN RING')]),
      status('full'),
      new Map(),
      pasted(text, undefined),
    );
    expect(mixed.options.map((o) => o.kind)).toEqual(['link', 'game', 'manual']);
    expect(mixed.options[0]).toMatchObject({ resolving: true });
    expect(mixed.defaultIndex).toBe(0);
  });
});
