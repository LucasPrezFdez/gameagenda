import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type ActionResult,
  addEntry,
  addEntryExact,
  type Entry,
  editEntry,
  isLive,
  moveEntry,
  removeEntry,
  STATUSES,
  setFlag,
  setStatus,
  toggleFlag,
  undo,
} from '../src/entries/index.ts';
import { harness, values } from './actions-harness.ts';
import { TODAY } from './helpers.ts';

const ID = 'steam:1145350';
const TITLE = 'Hades II';

function must(r: ActionResult | null): ActionResult {
  if (r === null) throw new Error('la acción no ha hecho nada');
  return r;
}

function sameHlc(r: ActionResult): void {
  const hlcs = new Set(r.ops.map((o) => o.hlc));
  expect(hlcs.size).toBe(1);
}

describe('apuntar', () => {
  it('en Quiero jugar, al final, con los valores por defecto y la fecha de hoy', () => {
    const { addCtx } = harness();
    const r = must(addEntry(undefined, { id: ID, title: TITLE }, addCtx('a5')));
    expect(r.entry).toMatchObject({
      id: ID,
      status: 'want_to_play',
      flags: { platinum: false, owned: false, next: false },
      note: '',
      platform: null,
      addedAt: TODAY,
      startedAt: null,
      completedAt: null,
      platinumAt: null,
      ownedAt: null,
      title: TITLE,
      cover: null,
      deletedAt: null,
      mergedInto: null,
      view: 'want_to_play',
    });
    expect(r.entry.rank > 'a5').toBe(true);
    expect(r.entries).toEqual([r.entry]);
    sameHlc(r);
    expect(r.ops.every((o) => o.entryId === ID)).toBe(true);
    expect(new Set(r.ops.map((o) => o.opId)).size).toBe(r.ops.length);
    expect(r.entry.lastHlc).toBe(r.ops[0]?.hlc);
  });

  it('en una lista vacía la primera clave es a0', () => {
    const { addCtx } = harness();
    expect(must(addEntry(undefined, { id: ID, title: TITLE }, addCtx(null))).entry.rank).toBe('a0');
  });

  it('un juego ya apuntado nunca se duplica', () => {
    const { addCtx } = harness();
    const e = must(addEntry(undefined, { id: ID, title: TITLE }, addCtx())).entry;
    expect(addEntry(e, { id: ID, title: TITLE }, addCtx())).toBeNull();
  });

  it('con otro estado aplica las fechas automáticas', () => {
    const { addCtx } = harness();
    const playing = must(
      addEntry(undefined, { id: ID, title: TITLE, status: 'playing' }, addCtx()),
    );
    expect(playing.entry).toMatchObject({ status: 'playing', startedAt: TODAY, completedAt: null });
    const done = must(addEntry(undefined, { id: ID, title: TITLE, status: 'completed' }, addCtx()));
    expect(done.entry).toMatchObject({ startedAt: null, completedAt: TODAY });
    const hold = must(addEntry(undefined, { id: ID, title: TITLE, status: 'on_hold' }, addCtx()));
    expect(hold.entry).toMatchObject({ startedAt: null, completedAt: null });
  });

  it('con Platinado entra en Completado con completedAt y platinumAt', () => {
    const { addCtx } = harness();
    const r = must(
      addEntry(
        undefined,
        { id: ID, title: TITLE, status: 'playing', flags: { platinum: true } },
        addCtx(),
      ),
    );
    expect(r.entry).toMatchObject({
      status: 'completed',
      flags: { platinum: true },
      completedAt: TODAY,
      platinumAt: TODAY,
    });
    sameHlc(r);
  });

  it('con Comprado no inventa ownedAt; con Próximo va a «A continuación»', () => {
    const { addCtx } = harness();
    const r = must(
      addEntry(undefined, { id: ID, title: TITLE, flags: { owned: true, next: true } }, addCtx()),
    );
    expect(r.entry.ownedAt).toBeNull();
    expect(r.entry.view).toBe('next');
  });

  it('volver a apuntar una lápida empieza de cero', () => {
    const { ctx, addCtx } = harness();
    let e = must(
      addEntry(
        undefined,
        {
          id: ID,
          title: TITLE,
          flags: { platinum: true, owned: true, mi_marca: true },
          note: 'nota',
          platform: 'ps5',
        },
        addCtx(),
      ),
    ).entry;
    e = must(editEntry(e, { ownedAt: '2020' }, ctx())).entry;
    e = must(removeEntry(e, ctx())).entry;
    const again = must(addEntry(e, { id: ID, title: TITLE }, addCtx('b00', '2026-11-02'))).entry;
    expect(values(again)).toEqual({
      ...values(e),
      status: 'want_to_play',
      flags: {},
      rank: 'b01',
      note: '',
      platform: null,
      addedAt: '2026-11-02',
      completedAt: null,
      platinumAt: null,
      ownedAt: null,
      deletedAt: null,
      view: 'want_to_play',
    });
    expect(again.flags.mi_marca).toBe(false);
  });

  it('valida la entrada y exige una HLC posterior', () => {
    const { addCtx, ctx } = harness();
    expect(() => addEntry(undefined, { id: 'x', title: TITLE }, addCtx())).toThrow(TypeError);
    expect(() => addEntry(undefined, { id: ID, title: '  ' }, addCtx())).toThrow(TypeError);
    expect(() =>
      addEntry(undefined, { id: ID, title: TITLE, note: 'x'.repeat(2001) }, addCtx()),
    ).toThrow(RangeError);
    expect(() =>
      addEntry(undefined, { id: ID, title: TITLE, platform: 'wii' as never }, addCtx()),
    ).toThrow(TypeError);
    expect(() =>
      addEntry(undefined, { id: ID, title: TITLE, flags: { 'Mal-Nombre': true } }, addCtx()),
    ).toThrow(TypeError);
    expect(() =>
      addEntry(undefined, { id: ID, title: TITLE }, { ...addCtx(), today: '2026-10' }),
    ).toThrow(TypeError);
    const old = ctx();
    const e = must(addEntry(undefined, { id: ID, title: TITLE }, addCtx())).entry;
    expect(() => setStatus(e, 'playing', old)).toThrow(RangeError);
  });

  it('addEntryExact escribe los valores tal cual, sin reglas automáticas', () => {
    const { ctx } = harness();
    const r = must(
      addEntryExact(
        undefined,
        {
          id: ID,
          title: TITLE,
          cover: null,
          status: 'playing',
          flags: { platinum: true },
          rank: 'a3',
          note: '',
          platform: 'pc',
          addedAt: '2019',
          startedAt: null,
          completedAt: null,
          platinumAt: null,
          ownedAt: null,
        },
        ctx(),
      ),
    );
    expect(r.entry).toMatchObject({ status: 'playing', flags: { platinum: true }, rank: 'a3' });
    expect(r.entry.startedAt).toBeNull();
    expect(r.ops.some((o) => o.field === 'status' && o.value === 'completed')).toBe(false);
  });
});

function fresh(): { h: ReturnType<typeof harness>; e: Entry } {
  const h = harness();
  return { h, e: must(addEntry(undefined, { id: ID, title: TITLE }, h.addCtx())).entry };
}

describe('cambiar estado', () => {
  it('startedAt se fija la primera vez que pasa a Jugando y no se sobrescribe', () => {
    const { h, e } = fresh();
    const a = must(setStatus(e, 'playing', h.ctx('2026-10-01'))).entry;
    expect(a.startedAt).toBe('2026-10-01');
    const b = must(setStatus(a, 'on_hold', h.ctx('2026-10-02'))).entry;
    const c = must(setStatus(b, 'playing', h.ctx('2026-10-03'))).entry;
    expect(c.startedAt).toBe('2026-10-01');
  });

  it('completedAt se fija la primera vez que pasa a Completado y no se sobrescribe', () => {
    const { h, e } = fresh();
    const a = must(setStatus(e, 'completed', h.ctx('2026-10-01'))).entry;
    expect(a.completedAt).toBe('2026-10-01');
    expect(a.startedAt).toBeNull();
    const b = must(setStatus(a, 'playing', h.ctx('2026-10-02'))).entry;
    const c = must(setStatus(b, 'completed', h.ctx('2026-10-03'))).entry;
    expect(c.completedAt).toBe('2026-10-01');
  });

  it('se permiten todas las transiciones', () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const { h, e } = fresh();
        const start = from === e.status ? e : must(setStatus(e, from, h.ctx())).entry;
        const r = setStatus(start, to, h.ctx());
        if (from === to) expect(r).toBeNull();
        else expect(must(r).entry.status).toBe(to);
      }
    }
  });

  it('no actúa sobre lápidas', () => {
    const { h, e } = fresh();
    const gone = must(removeEntry(e, h.ctx())).entry;
    expect(setStatus(gone, 'playing', h.ctx())).toBeNull();
    expect(setStatus(undefined, 'playing', h.ctx())).toBeNull();
  });

  it('cambiar el estado después (rejugar) no quita Platinado', () => {
    const { h, e } = fresh();
    const plat = must(setFlag(e, 'platinum', true, h.ctx())).entry;
    const replay = must(setStatus(plat, 'playing', h.ctx())).entry;
    expect(replay).toMatchObject({ status: 'playing', flags: { platinum: true } });
  });
});

describe('marcas', () => {
  it('marcar Platinado pasa a Completado y fija completedAt y platinumAt, con una sola HLC', () => {
    const { h, e } = fresh();
    const playing = must(setStatus(e, 'playing', h.ctx('2026-10-01'))).entry;
    const r = must(setFlag(playing, 'platinum', true, h.ctx('2026-10-05')));
    expect(r.entry).toMatchObject({
      status: 'completed',
      flags: { platinum: true },
      completedAt: '2026-10-05',
      platinumAt: '2026-10-05',
      startedAt: '2026-10-01',
    });
    sameHlc(r);
    expect(r.ops.map((o) => o.field).sort()).toEqual(
      ['completedAt', 'flags.platinum', 'platinumAt', 'status'].sort(),
    );
  });

  it('marcar Platinado escribe status aunque ya fuera Completado y no pisa completedAt', () => {
    const { h, e } = fresh();
    const done = must(setStatus(e, 'completed', h.ctx('2026-10-01'))).entry;
    const r = must(setFlag(done, 'platinum', true, h.ctx('2026-10-05')));
    expect(r.ops.some((o) => o.field === 'status' && o.value === 'completed')).toBe(true);
    expect(r.entry.completedAt).toBe('2026-10-01');
  });

  it('quitar Platinado vacía platinumAt y no cambia el estado', () => {
    const { h, e } = fresh();
    const plat = must(setFlag(e, 'platinum', true, h.ctx())).entry;
    const off = must(setFlag(plat, 'platinum', false, h.ctx())).entry;
    expect(off).toMatchObject({
      status: 'completed',
      platinumAt: null,
      flags: { platinum: false },
    });
    expect(off.completedAt).toBe(TODAY);
  });

  it('Comprado no afecta al estado ni inventa ownedAt', () => {
    const { h, e } = fresh();
    const r = must(toggleFlag(e, 'owned', h.ctx()));
    expect(r.entry).toMatchObject({
      status: 'want_to_play',
      ownedAt: null,
      flags: { owned: true },
    });
    expect(r.ops).toHaveLength(1);
  });

  it('Próximo fija en «A continuación» solo en Quiero jugar y En pausa', () => {
    const { h, e } = fresh();
    const next = must(toggleFlag(e, 'next', h.ctx())).entry;
    expect(next.view).toBe('next');
    expect(must(setStatus(next, 'on_hold', h.ctx())).entry.view).toBe('next');
    const playing = must(setStatus(next, 'playing', h.ctx())).entry;
    expect(playing.view).toBe('playing');
    expect(playing.flags.next).toBe(true);
  });

  it('alternar dos veces vuelve al principio; repetir el mismo valor no hace nada', () => {
    const { h, e } = fresh();
    const on = must(toggleFlag(e, 'owned', h.ctx())).entry;
    const off = must(toggleFlag(on, 'owned', h.ctx())).entry;
    expect(off.flags.owned).toBe(false);
    expect(setFlag(off, 'owned', false, h.ctx())).toBeNull();
    expect(() => setFlag(off, 'Owned', true, h.ctx())).toThrow(TypeError);
  });
});

describe('editar en la ficha', () => {
  it('escribe solo lo que cambia', () => {
    const { h, e } = fresh();
    const r = must(
      editEntry(
        e,
        { note: 'Con el DLC', platform: 'steam_deck', ownedAt: '2025-12', addedAt: e.addedAt },
        h.ctx(),
      ),
    );
    expect(r.entry).toMatchObject({
      note: 'Con el DLC',
      platform: 'steam_deck',
      ownedAt: '2025-12',
    });
    expect(r.ops.map((o) => o.field)).toEqual(['note', 'platform', 'ownedAt']);
    expect(editEntry(r.entry, { note: 'Con el DLC' }, h.ctx())).toBeNull();
  });

  it('valida nota y fechas', () => {
    const { h, e } = fresh();
    expect(() => editEntry(e, { startedAt: '2019-02-29' }, h.ctx())).toThrow(TypeError);
    expect(() => editEntry(e, { note: 'x'.repeat(2001) }, h.ctx())).toThrow(RangeError);
    expect(must(editEntry(e, { startedAt: '2019' }, h.ctx())).entry.startedAt).toBe('2019');
  });
});

describe('orden manual', () => {
  it('mover crea una clave entre los vecinos', () => {
    const { h, e } = fresh();
    const r = must(moveEntry(e, 'a1', 'a2', h.ctx()));
    expect(r.entry.rank > 'a1' && r.entry.rank < 'a2').toBe(true);
    expect(r.ops.map((o) => o.field)).toEqual(['rank']);
    expect(moveEntry(r.entry, 'a1', 'a2', h.ctx())).toBeNull();
  });
});

describe('quitar', () => {
  it('deja una lápida con el instante de la HLC y conserva el resto', () => {
    const { h, e } = fresh();
    const c = h.ctx();
    const r = must(removeEntry(e, c));
    expect(r.entry.deletedAt).toBe(new Date(Number(c.hlc.slice(0, 13))).toISOString());
    expect(r.ops.map((o) => o.field)).toEqual(['deletedAt']);
    expect(isLive(r.entry)).toBe(false);
    expect('view' in r.entry).toBe(false);
    expect(values(r.entry)).toMatchObject({ title: TITLE, status: 'want_to_play' });
    expect(removeEntry(r.entry, h.ctx())).toBeNull();
  });
});

describe('deshacer', () => {
  it('deshacer un alta la quita', () => {
    const h = harness();
    const r = must(addEntry(undefined, { id: ID, title: TITLE }, h.addCtx()));
    const u = must(undo(r.undo, () => r.entry, h.ctx()));
    expect(isLive(u.entry)).toBe(false);
    expect(u.ops.map((o) => o.field)).toEqual(['deletedAt']);
  });

  it('deshacer un «Quitar» escribe solo deletedAt = null y la recupera tal como estaba', () => {
    const { h, e } = fresh();
    const r = must(removeEntry(e, h.ctx()));
    const u = must(undo(r.undo, () => r.entry, h.ctx()));
    expect(u.ops.map((o) => [o.field, o.value])).toEqual([['deletedAt', null]]);
    expect(values(u.entry)).toEqual(values(e));
  });

  it('un solo Deshacer revierte Platinado y su Completado', () => {
    const { h, e } = fresh();
    const playing = must(setStatus(e, 'playing', h.ctx())).entry;
    const r = must(setFlag(playing, 'platinum', true, h.ctx()));
    const u = must(undo(r.undo, () => r.entry, h.ctx()));
    expect(values(u.entry)).toEqual(values(playing));
    sameHlc(u);
  });

  it('deshacer «quitar Platinado» tras rejugar no lo pasa a Completado', () => {
    const { h, e } = fresh();
    const plat = must(setFlag(e, 'platinum', true, h.ctx())).entry;
    const replay = must(setStatus(plat, 'playing', h.ctx())).entry;
    const r = must(setFlag(replay, 'platinum', false, h.ctx()));
    const u = must(undo(r.undo, () => r.entry, h.ctx()));
    expect(values(u.entry)).toEqual(values(replay));
    expect(u.ops.some((o) => o.entryId === ID && o.field === 'status')).toBe(true);
  });

  it('deshacer volver a apuntar una lápida la deja como estaba', () => {
    const { h, e } = fresh();
    const plat = must(setFlag(e, 'platinum', true, h.ctx())).entry;
    const gone = must(removeEntry(plat, h.ctx())).entry;
    const r = must(addEntry(gone, { id: ID, title: TITLE }, h.addCtx()));
    const u = must(undo(r.undo, () => r.entry, h.ctx()));
    expect(values(u.entry)).toEqual(values(gone));
  });

  it('varios niveles, en orden inverso, y rehacer con el undo del undo', () => {
    const { h, e } = fresh();
    const a = must(setStatus(e, 'playing', h.ctx()));
    const b = must(toggleFlag(a.entry, 'owned', h.ctx()));
    const ub = must(undo(b.undo, () => b.entry, h.ctx()));
    expect(values(ub.entry)).toEqual(values(a.entry));
    const ua = must(undo(a.undo, () => ub.entry, h.ctx()));
    expect(values(ua.entry)).toEqual(values(e));
    const redo = must(undo(ua.undo, () => ua.entry, h.ctx()));
    expect(values(redo.entry)).toEqual(values(ub.entry));
  });

  it('si ya no hay nada que deshacer devuelve null', () => {
    const { h, e } = fresh();
    const r = must(toggleFlag(e, 'owned', h.ctx()));
    const back = must(toggleFlag(r.entry, 'owned', h.ctx()));
    expect(undo(r.undo, () => back.entry, h.ctx())).toBeNull();
  });
});

describe('propiedad: Deshacer devuelve el estado exacto', () => {
  type Act =
    | { kind: 'status'; status: (typeof STATUSES)[number] }
    | { kind: 'flag'; flag: 'platinum' | 'owned' | 'next' }
    | { kind: 'edit'; note: string; startedAt: string | null }
    | { kind: 'move'; above: string | null; below: string | null }
    | { kind: 'remove' }
    | { kind: 'add'; status: (typeof STATUSES)[number]; platinum: boolean };

  const act: fc.Arbitrary<Act> = fc.oneof(
    fc.record({ kind: fc.constant('status' as const), status: fc.constantFrom(...STATUSES) }),
    fc.record({
      kind: fc.constant('flag' as const),
      flag: fc.constantFrom('platinum' as const, 'owned' as const, 'next' as const),
    }),
    fc.record({
      kind: fc.constant('edit' as const),
      note: fc.constantFrom('', 'a', 'b'),
      startedAt: fc.constantFrom(null, '2019', '2020-02-29'),
    }),
    fc.record({
      kind: fc.constant('move' as const),
      above: fc.constantFrom(null, 'a1'),
      below: fc.constantFrom(null, 'a3'),
    }),
    fc.constant({ kind: 'remove' as const }),
    fc.record({
      kind: fc.constant('add' as const),
      status: fc.constantFrom(...STATUSES),
      platinum: fc.boolean(),
    }),
  );

  function run(h: ReturnType<typeof harness>, e: Entry | undefined, a: Act): ActionResult | null {
    switch (a.kind) {
      case 'status':
        return setStatus(e, a.status, h.ctx());
      case 'flag':
        return toggleFlag(e, a.flag, h.ctx());
      case 'edit':
        return editEntry(e, { note: a.note, startedAt: a.startedAt }, h.ctx());
      case 'move':
        return moveEntry(e, a.above, a.below, h.ctx());
      case 'remove':
        return removeEntry(e, h.ctx());
      case 'add':
        return addEntry(
          e,
          { id: ID, title: TITLE, status: a.status, flags: { platinum: a.platinum } },
          h.addCtx('a5'),
        );
    }
  }

  it('tras cualquier historia, deshacer la última acción restaura los valores', () => {
    fc.assert(
      fc.property(fc.array(act, { maxLength: 12 }), act, (history, last) => {
        const h = harness();
        let e: Entry | undefined;
        for (const a of history) e = run(h, e, a)?.entry ?? e;
        const r = run(h, e, last);
        if (r === null) return;
        const u = undo(r.undo, () => r.entry, h.ctx());
        if (e === undefined) {
          // Antes no estaba apuntada: deshacer la deja fuera de la lista.
          expect(u === null ? false : isLive(u.entry)).toBe(false);
        } else {
          expect(values(u?.entry)).toEqual(values(e));
        }
      }),
      { numRuns: 1000 },
    );
  });
});
