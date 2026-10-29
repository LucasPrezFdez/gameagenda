import { describe, expect, it } from 'vitest';
import { type Entry, isLive } from '../src/entries/index.ts';
import {
  applyOps,
  compactOutbox,
  merge,
  type Op,
  opsFromEntry,
  takeBatch,
} from '../src/sync/index.ts';
import { hlc, MANUAL_1, NODE_B, op, uuids, withoutOpId } from './helpers.ts';

const ID = 'steam:730';
const T = 'steam:1145350';

function base(h = hlc(10)): Entry {
  return merge(
    undefined,
    [
      op(ID, 'status', 'want_to_play', h),
      op(ID, 'title', 'Counter-Strike 2', h),
      op(ID, 'flags.platinum', false, h),
      op(ID, 'rank', 'a0', h),
      op(ID, 'deletedAt', null, h),
    ],
    uuids(),
  ).entry;
}

describe('merge: LWW por campo', () => {
  it('una operación de una entrada desconocida crea un esqueleto invisible', () => {
    const { entry, derived } = merge(undefined, [op(ID, 'flags.owned', true, hlc(5))], uuids());
    expect(entry.id).toBe(ID);
    expect(entry.flags.owned).toBe(true);
    expect(entry.hlc).toEqual({ 'flags.owned': hlc(5) });
    expect(entry.view).toBeUndefined();
    expect('view' in entry).toBe(false);
    expect(entry.lastHlc).toBe(hlc(5));
    expect(derived).toEqual([]);
  });

  it('con status y title la entrada pasa a ser visible y tiene view', () => {
    const e = base();
    expect(isLive(e)).toBe(true);
    expect(e.view).toBe('want_to_play');
  });

  it('gana la mayor HLC, en cualquier orden', () => {
    const a = op(ID, 'note', 'vieja', hlc(20));
    const b = op(ID, 'note', 'nueva', hlc(30));
    expect(merge(base(), [a, b], uuids()).entry.note).toBe('nueva');
    expect(merge(base(), [b, a], uuids()).entry.note).toBe('nueva');
    expect(merge(base(), [b, a], uuids()).entry.hlc.note).toBe(hlc(30));
  });

  it('a igual HLC desempata canon(value), en cualquier orden', () => {
    const a = op(ID, 'note', 'a', hlc(20));
    const b = op(ID, 'note', 'b', hlc(20));
    expect(merge(base(), [a, b], uuids()).entry.note).toBe('b');
    expect(merge(base(), [b, a], uuids()).entry.note).toBe('b');
  });

  it('es idempotente', () => {
    const ops = [op(ID, 'note', 'x', hlc(20)), op(ID, 'flags.owned', true, hlc(21))];
    const once = merge(base(), ops, uuids()).entry;
    expect(merge(once, ops, uuids()).entry).toEqual(once);
  });

  it('no muta la entrada previa', () => {
    const prev = base();
    const snapshot = structuredClone(prev);
    merge(
      prev,
      [op(ID, 'flags.owned', true, hlc(20)), op(ID, 'status', 'playing', hlc(20))],
      uuids(),
    );
    expect(prev).toEqual(snapshot);
  });

  it('ignora campos desconocidos y rechaza operaciones de otra entrada', () => {
    const e = merge(
      base(),
      [op(ID, 'view', 'next', hlc(20)), op(ID, 'id', 'x', hlc(20))],
      uuids(),
    ).entry;
    expect(e).toEqual(base());
    expect(() => merge(base(), [op(T, 'note', 'x', hlc(20))], uuids())).toThrow(RangeError);
    expect(() => merge(undefined, [], uuids())).toThrow(RangeError);
  });

  it('lastHlc es la mayor HLC de la entrada', () => {
    const e = merge(base(), [op(ID, 'note', 'x', hlc(40, 0, NODE_B))], uuids()).entry;
    expect(e.lastHlc).toBe(hlc(40, 0, NODE_B));
  });
});

describe('merge: Platinado ⇒ Completado por relojes', () => {
  it('si Platinado es posterior al último cambio de estado, deriva Completado con su HLC', () => {
    const { entry, derived } = merge(base(), [op(ID, 'flags.platinum', true, hlc(20))], uuids());
    expect(entry.status).toBe('completed');
    expect(entry.hlc.status).toBe(hlc(20));
    expect(entry.view).toBe('completed');
    expect(withoutOpId(derived)).toEqual([
      { entryId: ID, field: 'status', value: 'completed', hlc: hlc(20) },
    ]);
  });

  it('si el estado cambió después, se respeta y Platinado se conserva', () => {
    const { entry, derived } = merge(
      base(),
      [op(ID, 'flags.platinum', true, hlc(20)), op(ID, 'status', 'playing', hlc(30))],
      uuids(),
    );
    expect(entry.status).toBe('playing');
    expect(entry.flags.platinum).toBe(true);
    expect(derived).toEqual([]);
  });

  it('«Marcar Platinado» escribe status con la misma HLC: no hay nada que derivar', () => {
    const { entry, derived } = merge(
      base(),
      [op(ID, 'flags.platinum', true, hlc(20)), op(ID, 'status', 'completed', hlc(20))],
      uuids(),
    );
    expect(entry.status).toBe('completed');
    expect(derived).toEqual([]);
  });

  it('con datos incompletos (sin la operación de status) todas las réplicas derivan lo mismo', () => {
    const ops = [op(ID, 'flags.platinum', true, hlc(20))];
    const a = merge(base(), ops, uuids(1));
    const b = merge(base(), ops, uuids(2));
    expect(a.entry).toEqual(b.entry);
    expect(withoutOpId(a.derived)).toEqual(withoutOpId(b.derived));
  });

  it('las fechas no se reparan', () => {
    const { entry } = merge(base(), [op(ID, 'flags.platinum', true, hlc(20))], uuids());
    expect(entry.completedAt).toBeNull();
  });
});

describe('merge: lápidas', () => {
  const removed = () =>
    merge(base(), [op(ID, 'deletedAt', '2026-10-28T09:15:00.000Z', hlc(20))], uuids()).entry;

  it('borrar conserva el resto y quita view', () => {
    const e = removed();
    expect(e.title).toBe('Counter-Strike 2');
    expect(e.status).toBe('want_to_play');
    expect('view' in e).toBe(false);
  });

  it('un cambio concurrente no resucita la entrada; deletedAt = null sí', () => {
    const e = merge(removed(), [op(ID, 'status', 'playing', hlc(30))], uuids()).entry;
    expect(e.status).toBe('playing');
    expect(isLive(e)).toBe(false);
    const back = merge(e, [op(ID, 'deletedAt', null, hlc(31))], uuids()).entry;
    expect(isLive(back)).toBe(true);
    expect(back.view).toBe('playing');
  });
});

describe('merge: manual vinculado', () => {
  const manual = () =>
    merge(
      undefined,
      [
        op(MANUAL_1, 'status', 'playing', hlc(10)),
        op(MANUAL_1, 'title', 'Hades II', hlc(10)),
        op(MANUAL_1, 'note', 'nota', hlc(11)),
      ],
      uuids(),
    ).entry;

  it('al recibir mergedInto reenvía el estado actual de sus campos de usuario', () => {
    const { entry, derived } = merge(
      manual(),
      [
        op(MANUAL_1, 'deletedAt', '2026-10-28T09:15:00.000Z', hlc(20)),
        op(MANUAL_1, 'mergedInto', T, hlc(20)),
      ],
      uuids(),
    );
    expect(entry.mergedInto).toBe(T);
    expect(isLive(entry)).toBe(false);
    expect(withoutOpId(derived)).toEqual([
      { entryId: T, field: 'status', value: 'playing', hlc: hlc(10) },
      { entryId: T, field: 'note', value: 'nota', hlc: hlc(11) },
    ]);
  });

  it('lo que llega después para el manual se reenvía, salvo title, cover, deletedAt y mergedInto', () => {
    const merged = merge(manual(), [op(MANUAL_1, 'mergedInto', T, hlc(20))], uuids()).entry;
    const { derived } = merge(
      merged,
      [
        op(MANUAL_1, 'flags.owned', true, hlc(30)),
        op(MANUAL_1, 'title', 'Otro', hlc(30)),
        op(MANUAL_1, 'cover', null, hlc(30)),
        op(MANUAL_1, 'deletedAt', null, hlc(30)),
      ],
      uuids(),
    );
    expect(withoutOpId(derived)).toEqual([
      { entryId: T, field: 'flags.owned', value: true, hlc: hlc(30) },
    ]);
  });

  it('reenvía también la derivada de Platinado', () => {
    const merged = merge(manual(), [op(MANUAL_1, 'mergedInto', T, hlc(20))], uuids()).entry;
    const { derived } = merge(merged, [op(MANUAL_1, 'flags.platinum', true, hlc(30))], uuids());
    expect(withoutOpId(derived)).toEqual([
      { entryId: MANUAL_1, field: 'status', value: 'completed', hlc: hlc(30) },
      { entryId: T, field: 'flags.platinum', value: true, hlc: hlc(30) },
      { entryId: T, field: 'status', value: 'completed', hlc: hlc(30) },
    ]);
  });

  it('applyOps sigue el reenvío hasta la entrada de Steam', () => {
    const m = manual();
    const { entries, derived } = applyOps(
      (id) => (id === MANUAL_1 ? m : undefined),
      [op(MANUAL_1, 'mergedInto', T, hlc(20)), op(T, 'title', 'Hades II', hlc(20))],
      uuids(),
    );
    const t = entries.get(T);
    expect(t?.status).toBe('playing');
    expect(t?.note).toBe('nota');
    expect(t?.hlc.status).toBe(hlc(10));
    expect(t?.title).toBe('Hades II');
    expect(derived).toHaveLength(2);
  });
});

describe('opsFromEntry', () => {
  it('una operación por campo con HLC; fusionarlas en vacío da la misma entrada', () => {
    const e = merge(base(), [op(ID, 'flags.owned', true, hlc(30))], uuids()).entry;
    const ops = opsFromEntry(e, uuids());
    expect(ops).toHaveLength(Object.keys(e.hlc).length);
    expect(merge(undefined, ops, uuids()).entry).toEqual(e);
  });
});

describe('outbox', () => {
  const a1 = op(ID, 'status', 'playing', hlc(10));
  const a2 = op(ID, 'startedAt', '2026-10-29', hlc(10));
  const b1 = op(ID, 'status', 'completed', hlc(20));
  const c1 = op(T, 'status', 'dropped', hlc(5));

  it('compacta por (entryId, field) quedándose con la que gana', () => {
    const { keep, drop } = compactOutbox([a1, a2, b1, c1]);
    expect(keep).toEqual([a2, b1, c1]);
    expect(drop).toEqual([a1]);
  });

  it('compactar no cambia el resultado de fusionar', () => {
    const all = [a1, a2, b1];
    const { keep } = compactOutbox(all);
    expect(merge(base(), keep, uuids()).entry).toEqual(merge(base(), all, uuids()).entry);
  });

  it('a igualdad total se queda con el menor opId, sin depender del orden', () => {
    const x: Op = { ...a1, opId: '00000000-0000-7000-8000-000000000002' };
    const y: Op = { ...a1, opId: '00000000-0000-7000-8000-000000000001' };
    expect(compactOutbox([x, y]).keep).toEqual([y]);
    expect(compactOutbox([y, x]).keep).toEqual([y]);
  });

  it('un lote nunca parte una acción', () => {
    const ops = [b1, a1, c1, a2];
    expect(takeBatch(ops, 2)).toEqual([c1]);
    expect(takeBatch(ops, 3)).toEqual([c1, a1, a2]);
    expect(takeBatch([a1, a2], 1)).toEqual([a1, a2]);
    expect(takeBatch([], 10)).toEqual([]);
  });
});
