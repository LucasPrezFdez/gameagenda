// Importar la biblioteca de Steam en la agenda (Fase 2, parte 3; DECISIONES §10.50): el plan, el
// alta compacta, las marcas y los lotes.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type ActionResult,
  addEntry,
  addEntryExact,
  addImported,
  applySteamImport,
  type Entry,
  type ImportedGame,
  isLive,
  markImported,
  planSteamImport,
  RECENT_PLAY_MS,
  removeEntry,
  type SteamImportGame,
  type SteamImportInput,
  undo,
} from '../src/entries/index.ts';
import { merge } from '../src/sync/index.ts';
import { harness, values } from './actions-harness.ts';
import { TODAY, uuids } from './helpers.ts';

const NOW = Date.UTC(2026, 10, 20, 12);
const DAY = 24 * 60 * 60 * 1000;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function must(r: ActionResult | null): ActionResult {
  if (r === null) throw new Error('la acción no ha hecho nada');
  return r;
}

function game(appid: number, minutes = 0, lastPlayedAt: number | null = null): SteamImportGame {
  return { appid, name: `Juego ${appid}`, minutes, lastPlayedAt };
}

function input(over: Partial<SteamImportInput> = {}): SteamImportInput {
  return {
    owned: [],
    wishlist: null,
    platinum: new Map(),
    nowMs: NOW,
    dayOf,
    get: () => undefined,
    catalogTitle: () => null,
    fallbackTitle: (appid) => `Juego de Steam ${appid}`,
    ...over,
  };
}

/** Una agenda en memoria con algunos juegos ya apuntados. */
function agenda(...list: Entry[]) {
  const all = new Map(list.map((e) => [e.id, e]));
  return { all, get: (id: string) => all.get(id) };
}

describe('planSteamImport: lo que decidió el usuario', () => {
  it('sin jugar, Sin empezar (nunca Quiero jugar); jugado hace menos de 14 días, Jugando; antes, En pausa', () => {
    const plan = planSteamImport(
      input({
        owned: [
          game(10),
          game(20, 30, NOW - RECENT_PLAY_MS + 1),
          game(30, 30, NOW - RECENT_PLAY_MS),
          game(40, 5, null),
        ],
      }),
    );
    const status = Object.fromEntries(
      plan.items.map((i) => [i.appid, i.kind === 'add' ? i.status : 'mark']),
    );
    expect(status).toEqual({ 10: 'not_started', 20: 'playing', 30: 'on_hold', 40: 'on_hold' });
    expect(plan.counts.added).toEqual({
      want_to_play: 0,
      playing: 1,
      on_hold: 2,
      completed: 0,
      dropped: 0,
      not_started: 1,
      multiplayer: 0,
      software: 0,
    });
    for (const item of plan.items) expect(item.kind === 'add' && item.owned).toBe(true);
  });

  it('todos los logros: Completado y Platinado, con el día del último logro', () => {
    const at = Date.UTC(2023, 10, 26, 12);
    const plan = planSteamImport(
      input({ owned: [game(10, 600, NOW - DAY), game(20)], platinum: new Map([[10, at]]) }),
    );
    expect(plan.items[0]).toMatchObject({
      appid: 10,
      status: 'completed',
      platinumAt: '2023-11-26',
      owned: true,
    });
    expect(plan.counts.platinum).toBe(1);
    expect(plan.counts.added.completed).toBe(1);
  });

  it('un platinado sin fecha de Steam lleva la de hoy', () => {
    const plan = planSteamImport(input({ owned: [game(10, 5)], platinum: new Map([[10, null]]) }));
    expect(plan.items[0]).toMatchObject({ platinumAt: dayOf(NOW) });
  });

  it('lo ya apuntado no cambia de estado: solo gana Comprado y, si toca, Platinado', () => {
    const h = harness();
    const playing = must(
      addEntry(undefined, { id: 'steam:10', title: 'A', status: 'playing' }, h.addCtx()),
    ).entry;
    const owned = must(
      addEntry(undefined, { id: 'steam:20', title: 'B', flags: { owned: true } }, h.addCtx()),
    ).entry;
    const a = agenda(playing, owned);
    const plan = planSteamImport(
      input({
        owned: [game(10, 60, NOW), game(20, 60, NOW)],
        platinum: new Map([[20, Date.UTC(2024, 0, 2)]]),
        get: a.get,
      }),
    );
    expect(plan.items).toEqual([
      {
        kind: 'mark',
        id: 'steam:10',
        appid: 10,
        title: 'A',
        owned: true,
        platinumAt: null,
        software: false,
      },
      {
        kind: 'mark',
        id: 'steam:20',
        appid: 20,
        title: 'B',
        owned: false,
        platinumAt: '2024-01-02',
        software: false,
      },
    ]);
    expect(plan.counts).toMatchObject({ markedOwned: 1, platinum: 1, unchanged: 0 });
  });

  it('Software (§10.57): lo nuevo entra ahí, sin Platinado y por nombre; lo que ya estaba pasa ahí', () => {
    const h = harness();
    const playing = must(
      addEntry(
        undefined,
        { id: 'steam:431960', title: 'Wallpaper Engine', status: 'playing' },
        h.addCtx(),
      ),
    ).entry;
    const already = must(
      addEntry(
        undefined,
        { id: 'steam:365670', title: 'Blender', status: 'software', flags: { owned: true } },
        h.addCtx(),
      ),
    ).entry;
    const a = agenda(playing, already);
    const plan = planSteamImport(
      input({
        owned: [
          game(431960, 600, NOW),
          game(365670, 60, NOW),
          { ...game(993090, 30, NOW), name: 'Lossless Scaling' },
          { ...game(388080), name: 'Borderless Gaming' },
          game(730, 60, NOW),
        ],
        // Aseprite tiene todos sus logros: un programa no se platina.
        platinum: new Map([[993090, NOW]]),
        software: new Set([431960, 365670, 993090, 388080]),
        get: a.get,
      }),
    );
    const adds = plan.items.filter((i) => i.kind === 'add');
    expect(adds.map((i) => [i.appid, i.status, i.platinumAt])).toEqual([
      [730, 'playing', null],
      [388080, 'software', null],
      [993090, 'software', null],
    ]);
    expect(plan.items.filter((i) => i.kind === 'mark')).toEqual([
      {
        kind: 'mark',
        id: 'steam:431960',
        appid: 431960,
        title: 'Wallpaper Engine',
        owned: true,
        platinumAt: null,
        software: true,
      },
    ]);
    expect(plan.counts).toMatchObject({
      added: { software: 2, playing: 1, completed: 0 },
      toSoftware: 1,
      platinum: 0,
      markedOwned: 1,
      unchanged: 1,
    });
  });

  it('lo ya apuntado con Comprado (y Platinado) se queda como está', () => {
    const h = harness();
    const done = must(
      addEntry(
        undefined,
        { id: 'steam:10', title: 'A', flags: { owned: true, platinum: true } },
        h.addCtx(),
      ),
    ).entry;
    const plan = planSteamImport(
      input({ owned: [game(10, 60)], platinum: new Map([[10, NOW]]), get: agenda(done).get }),
    );
    expect(plan.items).toEqual([]);
    expect(plan.counts.unchanged).toBe(1);
  });

  it('lo que el usuario quitó no vuelve, ni de la biblioteca ni de los deseados (ADR-014)', () => {
    const h = harness();
    const removedOf = (id: string) => {
      const added = must(addEntry(undefined, { id, title: 'A' }, h.addCtx())).entry;
      return must(removeEntry(added, h.ctx())).entry;
    };
    const owned = removedOf('steam:10');
    const wish = removedOf('steam:20');
    // Pasados 90 días, D1 la deja sin contenido: solo `deletedAt`, y sigue sin volver.
    const bare: Entry = { ...owned, hlc: { deletedAt: owned.hlc.deletedAt ?? '' } };
    for (const prev of [owned, bare]) {
      const plan = planSteamImport(
        input({
          owned: [game(10)],
          wishlist: [{ appid: 20, priority: 1, addedAt: null }],
          get: agenda(prev, wish).get,
        }),
      );
      expect(plan.items).toEqual([]);
      expect(plan.counts).toMatchObject({ removed: 2, unchanged: 0, wishes: 0 });
    }
  });

  it('un esqueleto (sin título ni estado, y sin borrar) cuenta como no apuntado', () => {
    const h = harness();
    const added = must(addEntry(undefined, { id: 'steam:10', title: 'A' }, h.addCtx())).entry;
    const skeleton: Entry = { ...added, hlc: { note: added.hlc.title ?? '' } };
    expect(isLive(skeleton)).toBe(false);
    const plan = planSteamImport(input({ owned: [game(10)], get: agenda(skeleton).get }));
    expect(plan.items[0]?.kind).toBe('add');
    expect(plan.counts.removed).toBe(0);
  });

  it('el título: el del catálogo; si no, el de Steam; si no, el de reserva', () => {
    const plan = planSteamImport(
      input({
        owned: [game(10), { ...game(20), name: null }, game(30)],
        catalogTitle: (appid) => (appid === 30 ? 'Del catálogo' : null),
      }),
    );
    const titles = Object.fromEntries(plan.items.map((i) => [i.appid, i.title]));
    expect(titles).toEqual({ 10: 'Juego 10', 20: 'Juego de Steam 20', 30: 'Del catálogo' });
  });

  it('el orden: Jugando, En pausa y Completado por última partida; Sin empezar por nombre; deseados detrás', () => {
    const plan = planSteamImport(
      input({
        owned: [
          { ...game(1), name: 'Zelda' },
          { ...game(2), name: 'ábaco' },
          game(3, 10, NOW - 100 * DAY),
          game(4, 10, NOW - 50 * DAY),
          game(5, 10, NOW - DAY),
          game(6, 10, NOW - 2 * DAY),
        ],
        wishlist: [
          { appid: 7, priority: 0, addedAt: 1 },
          { appid: 8, priority: 2, addedAt: 5 },
          { appid: 9, priority: 1, addedAt: 9 },
        ],
      }),
    );
    expect(plan.items.map((i) => i.appid)).toEqual([5, 6, 4, 3, 2, 1, 9, 8, 7]);
  });

  it('los deseados: a Quiero jugar, sin Comprado, salvo los que ya están o se tienen', () => {
    const h = harness();
    const live = must(addEntry(undefined, { id: 'steam:30', title: 'C' }, h.addCtx())).entry;
    const plan = planSteamImport(
      input({
        owned: [game(10)],
        wishlist: [
          { appid: 10, priority: 1, addedAt: null },
          { appid: 20, priority: 2, addedAt: null },
          { appid: 30, priority: 3, addedAt: null },
        ],
        get: agenda(live).get,
      }),
    );
    expect(
      plan.items.map((i) => [i.appid, i.kind === 'add' && i.owned, i.kind === 'add' && i.wish]),
    ).toEqual([
      [10, true, false],
      [20, false, true],
    ]);
    expect(plan.counts).toMatchObject({ wishes: 1, unchanged: 1 });
  });

  it('un juego repetido en la biblioteca cuenta una vez', () => {
    const plan = planSteamImport(input({ owned: [game(10), game(10, 50, NOW)] }));
    expect(plan.items).toHaveLength(1);
  });
});

describe('addImported: el alta compacta', () => {
  const base: ImportedGame = {
    id: 'steam:10',
    title: 'Hades',
    status: 'on_hold',
    rank: 'a5',
    owned: true,
    platinumAt: null,
  };

  it('escribe solo lo que no es como en un esqueleto: 6 operaciones, 9 con el platino', () => {
    const h = harness();
    const plain = must(addImported(undefined, base, h.ctx()));
    expect(plain.ops.map((o) => o.field)).toEqual([
      'status',
      'flags.owned',
      'rank',
      'addedAt',
      'title',
      'deletedAt',
    ]);
    const plat = must(
      addImported(undefined, { ...base, status: 'completed', platinumAt: '2023-11-26' }, h.ctx()),
    );
    expect(plat.ops).toHaveLength(9);
    expect(values(plat.entry)).toMatchObject({
      status: 'completed',
      flags: { owned: true, platinum: true },
      completedAt: '2023-11-26',
      platinumAt: '2023-11-26',
      addedAt: TODAY,
      startedAt: null,
      note: '',
      platform: null,
      ownedAt: null,
      cover: null,
    });
    expect(isLive(plat.entry)).toBe(true);
  });

  it('un deseado no lleva Comprado: 5 operaciones', () => {
    const h = harness();
    const r = must(
      addImported(undefined, { ...base, status: 'want_to_play', owned: false }, h.ctx()),
    );
    expect(r.ops).toHaveLength(5);
    expect(r.entry.flags.owned ?? false).toBe(false);
  });

  it('sobre una lápida lo escribe todo (empieza de cero, como addEntryExact)', () => {
    const h = harness();
    const added = must(
      addEntry(
        undefined,
        { id: 'steam:10', title: 'Hades', note: 'vieja', platform: 'ps5' },
        h.addCtx(),
      ),
    ).entry;
    const removed = must(removeEntry(added, h.ctx())).entry;
    const r = must(addImported(removed, base, h.ctx()));
    expect(r.ops.length).toBeGreaterThanOrEqual(15);
    expect(values(r.entry)).toMatchObject({ note: '', platform: null, status: 'on_hold' });
    expect(isLive(r.entry)).toBe(true);
  });

  it('no duplica: null si ya está apuntado', () => {
    const h = harness();
    const live = must(addImported(undefined, base, h.ctx())).entry;
    expect(addImported(live, base, h.ctx())).toBeNull();
  });

  it('un platinado tiene que ir en Completado; un título vacío o un id raro no valen', () => {
    const h = harness();
    expect(() => addImported(undefined, { ...base, platinumAt: '2023-01-01' }, h.ctx())).toThrow(
      RangeError,
    );
    expect(() => addImported(undefined, { ...base, title: ' ' }, h.ctx())).toThrow(TypeError);
    expect(() => addImported(undefined, { ...base, id: 'steam:0' }, h.ctx())).toThrow(TypeError);
    expect(() =>
      addImported(undefined, { ...base, platinumAt: '2023-02-30', status: 'completed' }, h.ctx()),
    ).toThrow(TypeError);
  });

  it('deshacer el alta deja una lápida', () => {
    const h = harness();
    const r = must(addImported(undefined, base, h.ctx()));
    const back = must(undo(r.undo, () => r.entry, h.ctx()));
    expect(isLive(back.entry)).toBe(false);
  });

  it('propiedad: da lo mismo que el alta completa, y otro dispositivo llega a la misma entrada', () => {
    const statuses = ['want_to_play', 'playing', 'on_hold', 'completed'] as const;
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4_000_000_000 }),
        fc.constantFrom(...statuses),
        fc.boolean(),
        fc.option(fc.constantFrom('2020-01-31', '2023-11-26', '2026-11-20'), { nil: null }),
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim() !== ''),
        (appid, status, owned, platinumAt, title) => {
          const h = harness();
          const game: ImportedGame = {
            id: `steam:${appid}`,
            title,
            status: platinumAt === null ? status : 'completed',
            rank: 'a0',
            owned,
            platinumAt,
          };
          const local = must(addImported(undefined, game, h.ctx()));
          // Lo mismo que el alta de 15 operaciones con esos valores.
          const full = must(
            addEntryExact(
              undefined,
              {
                id: game.id,
                title,
                cover: null,
                status: game.status,
                flags: { owned, platinum: platinumAt !== null },
                rank: game.rank,
                note: '',
                platform: null,
                addedAt: TODAY,
                startedAt: null,
                completedAt: platinumAt,
                platinumAt,
                ownedAt: null,
              },
              h.ctx(),
            ),
          );
          expect(full.ops).toHaveLength(15);
          expect(values(local.entry)).toEqual(values(full.entry));
          // Otro dispositivo, con solo esas operaciones, desde un esqueleto.
          const remote = merge(undefined, local.ops, uuids(9)).entry;
          expect(values(remote)).toEqual(values(local.entry));
          expect(isLive(remote)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('markImported', () => {
  it('Comprado sin tocar el estado; Platinado pone Completado con el día del logro', () => {
    const h = harness();
    const e = must(
      addEntry(undefined, { id: 'steam:10', title: 'A', status: 'playing' }, h.addCtx()),
    ).entry;
    const owned = must(markImported(e, { owned: true, platinumAt: null }, h.ctx()));
    expect(owned.ops.map((o) => o.field)).toEqual(['flags.owned']);
    expect(owned.entry.status).toBe('playing');
    const plat = must(
      markImported(owned.entry, { owned: true, platinumAt: '2022-05-04' }, h.ctx()),
    );
    expect(values(plat.entry)).toMatchObject({
      status: 'completed',
      flags: { owned: true, platinum: true },
      completedAt: '2022-05-04',
      platinumAt: '2022-05-04',
    });
  });

  it('una fecha de Completado que ya estaba se respeta', () => {
    const h = harness();
    const e = must(
      addEntry(undefined, { id: 'steam:10', title: 'A', status: 'completed' }, h.addCtx()),
    ).entry;
    const plat = must(markImported(e, { owned: false, platinumAt: '2022-05-04' }, h.ctx()));
    expect(plat.entry.completedAt).toBe(TODAY);
    expect(plat.entry.platinumAt).toBe('2022-05-04');
  });

  it('Software (§10.57): pasa a Software sin fechas nuevas, y con Deshacer vuelve', () => {
    const h = harness();
    const e = must(
      addEntry(undefined, { id: 'steam:431960', title: 'W', status: 'on_hold' }, h.addCtx()),
    ).entry;
    const moved = must(markImported(e, { owned: true, platinumAt: null, software: true }, h.ctx()));
    expect(moved.ops.map((o) => o.field).sort()).toEqual(['flags.owned', 'status']);
    expect(values(moved.entry)).toMatchObject({
      status: 'software',
      startedAt: e.startedAt,
      completedAt: null,
    });
    expect(moved.undo.changes[0]?.before?.status).toBe('on_hold');
    expect(moved.undo.changes[0]?.fields).toContain('status');
    // Ya en Software y con Comprado: nada que cambiar.
    expect(
      markImported(moved.entry, { owned: true, platinumAt: null, software: true }, h.ctx()),
    ).toBeNull();
  });

  it('nada que cambiar, o no está apuntado: null', () => {
    const h = harness();
    const e = must(
      addEntry(undefined, { id: 'steam:10', title: 'A', flags: { owned: true } }, h.addCtx()),
    ).entry;
    expect(markImported(e, { owned: true, platinumAt: null }, h.ctx())).toBeNull();
    expect(markImported(undefined, { owned: true, platinumAt: null }, h.ctx())).toBeNull();
  });
});

describe('applySteamImport: por lotes, con un solo Deshacer', () => {
  it('las altas van una tras otra detrás de lastRank, y el lote siguiente sigue detrás', () => {
    const h = harness();
    const plan = planSteamImport(input({ owned: [game(1), game(2), game(3)] }));
    const first = applySteamImport(plan.items.slice(0, 2), () => undefined, h.ctx(), 'a5');
    const second = applySteamImport(plan.items.slice(2), () => undefined, h.ctx(), first.lastRank);
    const ranks = [...first.entries, ...second.entries].map((e) => e.rank);
    expect(ranks).toEqual([...ranks].sort());
    expect((ranks[0] ?? '') > 'a5').toBe(true);
    expect(new Set(first.ops.map((o) => o.hlc)).size).toBe(1);
  });

  it('lo apuntado entretanto no se pisa: el alta se salta', () => {
    const h = harness();
    const plan = planSteamImport(input({ owned: [game(1), game(2)] }));
    const meanwhile = must(
      addEntry(undefined, { id: 'steam:1', title: 'Mío', status: 'dropped' }, h.addCtx()),
    ).entry;
    const batch = applySteamImport(plan.items, agenda(meanwhile).get, h.ctx(), null);
    expect(batch.skipped).toBe(1);
    expect(batch.entries.map((e) => e.id)).toEqual(['steam:2']);
  });

  it('un Deshacer con todos los cambios lo deja como estaba', () => {
    const h = harness();
    const before = must(
      addEntry(undefined, { id: 'steam:1', title: 'A', status: 'playing' }, h.addCtx()),
    ).entry;
    const a = agenda(before);
    const plan = planSteamImport(
      input({
        owned: [game(1, 10, NOW), game(2), game(3, 10, NOW)],
        platinum: new Map([[3, NOW]]),
        get: a.get,
      }),
    );
    const batch = applySteamImport(plan.items, a.get, h.ctx(), null);
    for (const e of batch.entries) a.all.set(e.id, e);
    expect(a.all.get('steam:1')?.flags.owned).toBe(true);
    const back = must(undo(batch.undo, a.get, h.ctx()));
    for (const e of back.entries) a.all.set(e.id, e);
    expect(values(a.all.get('steam:1'))).toEqual(values(before));
    expect(isLive(a.all.get('steam:2'))).toBe(false);
    expect(isLive(a.all.get('steam:3'))).toBe(false);
  });
});
