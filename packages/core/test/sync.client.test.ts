// Lo que la app necesita de core para sincronizar (§7.4 y §7.7): el desfase del reloj, volver a
// sellar lo rechazado por reloj, los cambios del servidor como operaciones y la purga local.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addEntry, type Entry, setFlag } from '../src/entries/index.ts';
import {
  applyOps,
  createHlcClock,
  formatHlc,
  isPurgeable,
  isTooFarAhead,
  type JsonValue,
  MAX_DRIFT_MS,
  MIN_OFFSET_CHANGE_MS,
  merge,
  nextOffset,
  offsetFromRoundTrip,
  opsFromChanges,
  PURGE_AFTER_DAYS,
  parseHlc,
  planReseal,
  purgeCutoff,
  resealEntry,
  resealOps,
} from '../src/sync/index.ts';
import { hlc, NODE_A, NODE_B, op, TODAY, uuids } from './helpers.ts';

const NODE = 'k3x9p2qa';
const MINUTE = 60_000;
const DAY = 86_400_000;
/** 07-11-2026 12:00 UTC. */
const NOW = Date.UTC(2026, 10, 7, 12);

describe('desfase del reloj', () => {
  it('se lee en vivo y lo usan las HLC siguientes', () => {
    let wall = NOW;
    const clock = createHlcClock({ now: () => wall, node: NODE });
    expect(clock.offset).toBe(0);
    clock.setOffset(-1500.4);
    expect(clock.offset).toBe(-1500);
    wall += 10_000;
    expect(parseHlc(clock.next())?.ms).toBe(NOW + 10_000 - 1500);
    expect(clock.snapshot()).toMatchObject({ offset: -1500 });
  });

  it('con el reloj más de 5 min por delante, baja la parte física a la hora corregida', () => {
    const clock = createHlcClock({ now: () => NOW, node: NODE });
    // El dispositivo iba 10 min adelantado: sus HLC salían 10 min por delante del servidor.
    clock.setOffset(0);
    clock.receive(formatHlc({ ms: NOW + 10 * MINUTE, counter: 7, node: NODE_A }));
    clock.setOffset(-10 * MINUTE);
    expect(clock.snapshot()).toEqual({ ms: NOW - 10 * MINUTE, counter: 0, offset: -10 * MINUTE });
    const next = clock.next();
    expect(isTooFarAhead(next, NOW - 10 * MINUTE)).toBe(false);
    expect(parseHlc(next)).toEqual({ ms: NOW - 10 * MINUTE, counter: 1, node: NODE });
  });

  it('no la baja si va como mucho 5 min por delante (lo que el servidor acepta)', () => {
    const clock = createHlcClock({ now: () => NOW, node: NODE });
    const ahead = formatHlc({ ms: NOW + MAX_DRIFT_MS, counter: 3, node: NODE_A });
    clock.receive(ahead);
    clock.setOffset(0);
    expect(clock.next() > ahead).toBe(true);
  });

  it('rechaza un desfase que no es un número finito', () => {
    const clock = createHlcClock({ now: () => NOW, node: NODE });
    expect(() => clock.setOffset(Number.NaN)).toThrow(RangeError);
    expect(clock.offset).toBe(0);
  });

  it('una ida y vuelta mide la hora del servidor menos el punto medio', () => {
    expect(offsetFromRoundTrip({ sentAt: 1000, receivedAt: 1400, serverTime: 61_200 })).toBe(
      60_000,
    );
    expect(offsetFromRoundTrip({ sentAt: 1000, receivedAt: 1001, serverTime: 0 })).toBe(-1000);
  });

  it('ignora los cambios que no pasan del ruido de la medida', () => {
    const sample = (offset: number, rtt: number) => ({
      sentAt: NOW,
      receivedAt: NOW + rtt,
      serverTime: NOW + rtt / 2 + offset,
    });
    expect(nextOffset(0, sample(MIN_OFFSET_CHANGE_MS, 100))).toBe(0);
    expect(nextOffset(0, sample(MIN_OFFSET_CHANGE_MS + 1, 100))).toBe(MIN_OFFSET_CHANGE_MS + 1);
    // Con 4 s de ida y vuelta, la medida puede errar 2 s.
    expect(nextOffset(0, sample(1900, 4000))).toBe(0);
    expect(nextOffset(0, sample(-10 * MINUTE, 4000))).toBe(-10 * MINUTE);
    expect(nextOffset(-10 * MINUTE, sample(-10 * MINUTE + 300, 80))).toBe(-10 * MINUTE);
    expect(nextOffset(42, { sentAt: NOW, receivedAt: NOW - 1, serverTime: NOW })).toBe(42);
    expect(nextOffset(42, { sentAt: NOW, receivedAt: Number.NaN, serverTime: NOW })).toBe(42);
  });
});

describe('volver a sellar', () => {
  function entryWith(id: string, fields: Record<string, string>): Entry {
    const ops = Object.entries(fields).map(([field, h]) =>
      op(id, field, defaults[field] ?? 'x', h),
    );
    return merge(undefined, ops, uuids(1)).entry;
  }
  const defaults: Record<string, JsonValue> = {
    status: 'playing',
    title: 'Hades',
    note: 'nota',
    'flags.owned': true,
  };

  it('reparte HLC nuevas en el orden de las viejas', () => {
    let n = 0;
    const plan = planReseal([hlc(9), hlc(5), hlc(9), hlc(7)], () => hlc(100, n++));
    expect([...plan]).toEqual([
      [hlc(5), hlc(100, 0)],
      [hlc(7), hlc(100, 1)],
      [hlc(9), hlc(100, 2)],
    ]);
  });

  it('las operaciones de la acción cambian de HLC y conservan su opId', () => {
    const ops = [op('steam:1', 'status', 'playing', hlc(9)), op('steam:1', 'note', 'n', hlc(5))];
    const plan = new Map([[hlc(9), hlc(3)]]);
    expect(resealOps(ops, plan)).toEqual([{ ...ops[0], hlc: hlc(3) }]);
  });

  it('la entrada cambia la HLC solo donde valía la vieja, con lastHlc recalculado', () => {
    const e = entryWith('steam:1', {
      status: hlc(9),
      title: hlc(2),
      note: hlc(9),
      'flags.owned': hlc(4),
    });
    const plan = new Map([[hlc(9), hlc(6)]]);
    const out = resealEntry(e, plan);
    expect(out?.hlc).toEqual({
      status: hlc(6),
      title: hlc(2),
      note: hlc(6),
      'flags.owned': hlc(4),
    });
    expect(out?.lastHlc).toBe(hlc(6));
    expect(out?.view).toBe(e.view);
    expect(out?.status).toBe('playing');
    // Sin mutar la original.
    expect(e.hlc.status).toBe(hlc(9));
    expect(resealEntry(e, new Map([[hlc(1), hlc(6)]]))).toBeNull();
  });

  it('sin volver a sellar la entrada, las réplicas divergen; con ella, convergen', () => {
    // A apunta con el reloj 10 min adelantado (HLC 900) y el servidor lo rechaza. B escribe el
    // mismo campo con 500 (aceptado). A vuelve a sellar a 300: en el servidor gana B.
    const old = hlc(900, 0, NODE_A);
    const fresh = hlc(300, 0, NODE_A);
    const a = merge(undefined, [op('steam:1', 'note', 'de A', old)], uuids(2)).entry;
    const b = op('steam:1', 'note', 'de B', hlc(500, 0, NODE_B));
    const plan = new Map([[old, fresh]]);
    const server = applyOps(
      () => undefined,
      [b, ...resealOps([op('steam:1', 'note', 'de A', old)], plan)],
      uuids(3),
    ).entries.get('steam:1');
    const stale = merge(a, [b], uuids(4)).entry;
    const resealed = merge(resealEntry(a, plan) ?? a, [b], uuids(5)).entry;
    expect(stale.note).toBe('de A');
    expect(server?.note).toBe('de B');
    expect(resealed.note).toBe(server?.note);
    expect(resealed.hlc).toEqual(server?.hlc);
  });

  it('propiedad: tras volver a sellar, aplicar lo mismo en otro orden da la misma entrada', () => {
    const arb = fc.record({
      fields: fc.uniqueArray(fc.constantFrom('status', 'note', 'title', 'flags.owned'), {
        minLength: 1,
      }),
      old: fc.integer({ min: 50, max: 60 }),
      fresh: fc.integer({ min: 1, max: 49 }),
    });
    fc.assert(
      fc.property(arb, ({ fields, old, fresh }) => {
        const ops = fields.map((f) => op('steam:7', f, defaults[f] ?? null, hlc(old)));
        const plan = new Map([[hlc(old), hlc(fresh)]]);
        const local = resealEntry(merge(undefined, ops, uuids(6)).entry, plan);
        const remote = merge(undefined, resealOps(ops, plan), uuids(7)).entry;
        expect(local).toEqual(remote);
      }),
    );
  });
});

describe('cambios del servidor', () => {
  it('pasan a operaciones con un opId nuevo cada una', () => {
    const next = uuids(8);
    const ops = opsFromChanges(
      [
        { entryId: 'steam:1', field: 'status', value: 'playing', hlc: hlc(1) },
        { entryId: 'steam:2', field: 'flags.owned', value: true, hlc: hlc(2) },
      ],
      next,
    );
    expect(ops.map((o) => o.opId)).toEqual([
      '00000008-0000-7000-8000-000000000000',
      '00000008-0000-7000-8000-000000000001',
    ]);
    expect(ops[1]).toMatchObject({ entryId: 'steam:2', field: 'flags.owned', value: true });
  });
});

describe('purga local', () => {
  const cutoff = purgeCutoff(NOW);
  const ctx = (ms: number, n = 0) => ({ hlc: hlc(ms, n), today: TODAY, newOpId: uuids(9) });

  it('el corte son 90 días antes, como en el servidor', () => {
    expect(PURGE_AFTER_DAYS).toBe(90);
    expect(cutoff.deletedBefore).toBe(new Date(NOW - 90 * DAY).toISOString());
    expect(cutoff.unchangedBefore).toBe(
      formatHlc({ ms: NOW - 90 * DAY, counter: 0, node: '00000000' }),
    );
  });

  it('se lleva las lápidas viejas y los esqueletos sin cambios, no lo vivo ni lo reciente', () => {
    const old = NOW - 100 * DAY;
    const live = addEntry(
      undefined,
      { id: 'steam:1', title: 'Uno' },
      { ...ctx(old), lastRank: null },
    )?.entry as Entry;
    expect(isPurgeable(live, cutoff)).toBe(false);
    const oldTomb = { ...live, deletedAt: new Date(old + DAY).toISOString() };
    expect(isPurgeable(oldTomb, cutoff)).toBe(true);
    const recentTomb = { ...live, deletedAt: new Date(NOW - 10 * DAY).toISOString() };
    expect(isPurgeable(recentTomb, cutoff)).toBe(false);
    const oldSkeleton = merge(undefined, [op('steam:2', 'note', 'x', hlc(old))], uuids(10)).entry;
    expect(isPurgeable(oldSkeleton, cutoff)).toBe(true);
    const touched = merge(
      oldSkeleton,
      [op('steam:2', 'note', 'y', hlc(NOW - DAY))],
      uuids(11),
    ).entry;
    expect(isPurgeable(touched, cutoff)).toBe(false);
    // Vivo y sin tocar en 100 días: no es esqueleto, se queda.
    const flagged = setFlag(live, 'owned', true, ctx(old, 1))?.entry as Entry;
    expect(isPurgeable(flagged, cutoff)).toBe(false);
  });
});
