// El motor con un servidor falso (las pruebas de punta a punta, contra la micro-API de verdad, van
// en `apps/web/worker/test/sync-client*.test.ts`).
import type { SyncResponse } from '@gameagenda/core/api';
import { type Entry, skeleton } from '@gameagenda/core/entries';
import {
  createHlcClock,
  formatHlc,
  hlcTime,
  merge,
  type Op,
  opsFromEntry,
} from '@gameagenda/core/sync';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { v7 as uuidv7 } from 'uuid';
import { afterEach, describe, expect, it } from 'vitest';
import { type GameAgendaDb, META_KEYS, openDatabase } from '../db/database.ts';
import type { SyncCall } from './api-client.ts';
import { createSyncEngine, type EngineOptions } from './engine.ts';
import { newRecord } from './state.ts';

/** 07-11-2026 12:00 UTC. */
const NOW = Date.UTC(2026, 10, 7, 12);
const MINUTE = 60_000;
const DAY = 86_400_000;
const h = (ms: number, counter = 0, node = 'aaaaaaaa') => formatHlc({ ms, counter, node });
const op = (entryId: string, field: string, value: Op['value'], hlc: string): Op => ({
  opId: uuidv7(),
  entryId,
  field,
  value,
  hlc,
});

const dbs: GameAgendaDb[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function newDb(): GameAgendaDb {
  const db = openDatabase({
    name: `engine-${dbs.length}`,
    indexedDB: new IDBFactory(),
    IDBKeyRange,
  });
  dbs.push(db);
  return db;
}

type Reply = Partial<SyncResponse> | ((request: SyncCall) => Partial<SyncResponse>);

/** Un servidor falso: acepta todo y no manda cambios, salvo lo que diga cada respuesta. */
function fakeServer(replies: Reply[] = []) {
  const requests: SyncCall[] = [];
  return {
    requests,
    transport: {
      async sync(request: SyncCall): Promise<SyncResponse> {
        requests.push(structuredClone(request));
        const reply = replies.shift() ?? {};
        const extra = typeof reply === 'function' ? reply(request) : reply;
        return {
          cursor: request.cursor,
          purgedSeq: request.purgedSeq,
          reset: false,
          more: false,
          serverTime: NOW,
          changes: [],
          accepted: request.ops.map((o) => o.opId),
          rejected: [],
          ...extra,
        };
      },
    },
  };
}

function engineFor(
  db: GameAgendaDb,
  server: ReturnType<typeof fakeServer>,
  more: Partial<EngineOptions> = {},
) {
  const clock = createHlcClock({ now: () => NOW, node: 'cccccccc' });
  const engine = createSyncEngine({
    db,
    transport: server.transport,
    clock,
    newOpId: uuidv7,
    now: () => NOW,
    yieldToMain: () => Promise.resolve(),
    ...more,
  });
  return { engine, clock };
}

function entryOf(ops: Op[]): Entry {
  return merge(undefined, ops, uuidv7).entry;
}

describe('subir la outbox', () => {
  it('compacta, borra lo que sobra y sube por lotes sin partir acciones', async () => {
    const db = newDb();
    const superseded = op('steam:1', 'status', 'playing', h(NOW - 3));
    const winner = op('steam:1', 'status', 'dropped', h(NOW - 2));
    const action = [
      op('steam:2', 'status', 'want_to_play', h(NOW - 1)),
      op('steam:2', 'title', 'Dos', h(NOW - 1)),
      op('steam:2', 'rank', 'a0', h(NOW - 1)),
    ];
    await db.outbox.bulkAdd([superseded, winner, ...action]);
    const server = fakeServer();
    const { engine } = engineFor(db, server, { batchSize: 2 });
    const result = await engine.round();
    expect(server.requests.map((r) => r.ops.map((o) => o.opId))).toEqual([
      [winner.opId],
      action.map((o) => o.opId),
    ]);
    expect(result).toMatchObject({ requests: 2, complete: true, pending: 0 });
    expect(await db.outbox.count()).toBe(0);
  });

  it('quita lo aceptado y lo inválido, pero no lo que cambió mientras tanto', async () => {
    const db = newDb();
    const ok = op('steam:1', 'note', 'a', h(NOW - 5));
    const bad = op('steam:2', 'note', 'b', h(NOW - 4));
    const changing = op('steam:3', 'note', 'c', h(NOW - 3));
    await db.outbox.bulkAdd([ok, bad, changing]);
    const server = fakeServer([
      (request) => {
        // Otra pestaña lo vuelve a sellar durante la petición.
        void db.outbox.put({ ...changing, hlc: h(NOW - 1) });
        const index = request.ops.findIndex((o) => o.opId === bad.opId);
        return {
          accepted: [ok.opId, changing.opId],
          rejected: [{ index, opId: bad.opId, reason: 'invalid' }],
        };
      },
    ]);
    const { engine } = engineFor(db, server, { maxRequests: 1 });
    await engine.round();
    expect((await db.outbox.toArray()).map((o) => [o.opId, o.hlc])).toEqual([
      [changing.opId, h(NOW - 1)],
    ]);
  });

  it('para en el tope de peticiones y dice que falta', async () => {
    const db = newDb();
    await db.outbox.bulkAdd([1, 2, 3].map((i) => op(`steam:${i}`, 'note', 'x', h(NOW - i))));
    const server = fakeServer();
    const { engine } = engineFor(db, server, { batchSize: 1, maxRequests: 2 });
    expect(await engine.round()).toMatchObject({ requests: 2, complete: false, pending: 1 });
  });
});

describe('bajar cambios', () => {
  it('fusiona con merge() sobre lo guardado y las derivadas no van a la outbox', async () => {
    const db = newDb();
    const local = entryOf([
      op('steam:1', 'status', 'playing', h(NOW - 10)),
      op('steam:1', 'title', 'Uno', h(NOW - 10)),
    ]);
    await db.entries.put(local);
    const server = fakeServer([
      {
        cursor: 7,
        changes: [{ entryId: 'steam:1', field: 'flags.platinum', value: true, hlc: h(NOW - 5) }],
      },
    ]);
    const { engine, clock } = engineFor(db, server);
    const result = await engine.round();
    expect(result).toMatchObject({ changed: 1, pending: 0 });
    const stored = await db.entries.get('steam:1');
    expect(stored).toMatchObject({ status: 'completed', flags: { platinum: true } });
    expect(stored?.hlc.status).toBe(h(NOW - 5));
    expect(await db.outbox.count()).toBe(0);
    const meta = await db.meta.bulkGet([META_KEYS.syncCursor, META_KEYS.hlcClock]);
    expect(meta[0]?.value).toEqual({ cursor: 7, purgedSeq: 0, reset: false, maxSeen: h(NOW - 5) });
    expect(meta[1]?.value).toEqual(clock.snapshot());
    // El reloj ya va por delante de lo recibido.
    expect(clock.next() > h(NOW - 5)).toBe(true);
  });

  it('sigue las páginas con el cursor de cada una', async () => {
    const db = newDb();
    const change = (id: number) => ({
      entryId: `steam:${id}`,
      field: 'note' as const,
      value: 'x',
      hlc: h(NOW - 100 + id),
    });
    const server = fakeServer([
      { cursor: 3, more: true, changes: [change(1)] },
      { cursor: 6, more: true, changes: [change(2)] },
      { cursor: 9, more: false, changes: [change(3)] },
    ]);
    const { engine } = engineFor(db, server);
    await engine.round();
    expect(server.requests.map((r) => r.cursor)).toEqual([0, 3, 6]);
    expect(await db.entries.count()).toBe(3);
  });

  it('con reset, al acabar borra lo que el servidor no ha mandado y no está en la outbox', async () => {
    const db = newDb();
    const gone = entryOf([op('steam:1', 'note', 'purgada', h(NOW - DAY))]);
    const kept = entryOf([op('steam:2', 'note', 'en el servidor', h(NOW - DAY))]);
    const pending = op('steam:3', 'note', 'pendiente', h(NOW - 1));
    const local = entryOf([op('steam:3', 'title', 'Vieja', h(NOW - DAY)), pending]);
    await db.entries.bulkPut([gone, kept, local]);
    await db.meta.put({
      key: META_KEYS.syncCursor,
      value: { cursor: 10, purgedSeq: 0, reset: false, maxSeen: '' },
    });
    // El servidor recibe la pendiente en un lote posterior, así que en esta respuesta no está.
    const server = fakeServer([
      {
        cursor: 4,
        purgedSeq: 9,
        reset: true,
        more: true,
        accepted: [],
        changes: [
          { entryId: 'steam:2', field: 'note', value: 'en el servidor', hlc: kept.hlc.note ?? '' },
        ],
      },
      { cursor: 12, purgedSeq: 9, more: false, accepted: [] },
      { cursor: 12, purgedSeq: 9 },
    ]);
    await db.outbox.add(pending);
    const { engine } = engineFor(db, server);
    await engine.round();
    expect(server.requests.map((r) => [r.cursor, r.purgedSeq])).toEqual([
      [10, 0],
      [4, 9],
      [12, 9],
    ]);
    expect(await db.entries.get('steam:1')).toBeUndefined();
    expect(await db.entries.get('steam:2')).toEqual(kept);
    // Lo pendiente se queda solo con lo pendiente: es lo que tendrá el servidor.
    expect(await db.entries.get('steam:3')).toEqual(entryOf([pending]));
    expect((await db.meta.get(META_KEYS.syncCursor))?.value).toMatchObject({
      reset: false,
      cursor: 12,
    });
  });

  it('con el cursor menor que el enviado (D1 vuelto atrás), lo vuelve a subir todo', async () => {
    const db = newDb();
    const e = entryOf([
      op('steam:1', 'status', 'playing', h(NOW - 9)),
      op('steam:1', 'title', 'Uno', h(NOW - 9)),
    ]);
    await db.entries.put(e);
    await db.meta.put({
      key: META_KEYS.syncCursor,
      value: { cursor: 50, purgedSeq: 0, reset: false, maxSeen: '' },
    });
    const server = fakeServer([{ cursor: 20 }]);
    const { engine } = engineFor(db, server);
    await engine.round();
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]?.ops.map((o) => o.field).sort()).toEqual(['status', 'title']);
    expect((await db.meta.get(META_KEYS.syncCursor))?.value).toMatchObject({ cursor: 20 });
  });
});

describe('reloj', () => {
  it('rechazo por reloj: corrige el desfase y vuelve a sellar la outbox y la entrada', async () => {
    const db = newDb();
    // El dispositivo iba 10 min adelantado.
    const future = h(NOW + 10 * MINUTE, 0, 'cccccccc');
    const ops = [op('steam:1', 'status', 'playing', future), op('steam:1', 'title', 'Uno', future)];
    const later = h(NOW + 10 * MINUTE + 1, 0, 'cccccccc');
    const other = op('steam:2', 'note', 'también futura', later);
    await db.entries.bulkPut([entryOf(ops), entryOf([other])]);
    await db.outbox.bulkAdd([...ops, other]);
    const wall = NOW + 10 * MINUTE;
    const server = fakeServer([
      (request) => ({
        accepted: [],
        rejected: request.ops.map((o, index) => ({
          index,
          opId: o.opId,
          reason: 'clock' as const,
        })),
      }),
    ]);
    const clock = createHlcClock({ now: () => wall, node: 'cccccccc' });
    clock.receive(later);
    const engine = createSyncEngine({
      db,
      transport: server.transport,
      clock,
      newOpId: uuidv7,
      now: () => wall,
      yieldToMain: () => Promise.resolve(),
      batchSize: 2,
    });
    await engine.round();
    expect(clock.offset).toBe(-10 * MINUTE);
    // El primer lote solo llevaba la primera acción, pero se vuelve a sellar también la otra.
    expect(server.requests[0]?.ops).toHaveLength(2);
    const [first, second] = server.requests.slice(1).map((r) => r.ops);
    expect([...(first ?? []), ...(second ?? [])].map((o) => o.opId).sort()).toEqual(
      [...ops, other].map((o) => o.opId).sort(),
    );
    for (const e of await db.entries.toArray()) {
      expect(hlcTime(e.lastHlc)).toBeLessThanOrEqual(NOW);
      expect(Object.values(e.hlc).every((x) => x === e.lastHlc)).toBe(true);
    }
    const one = await db.entries.get('steam:1');
    const two = await db.entries.get('steam:2');
    expect((one?.lastHlc ?? '') < (two?.lastHlc ?? '')).toBe(true);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('unirse y purgar', () => {
  it('join sube todas las entradas, lápidas incluidas, y es idempotente al compactar', async () => {
    const db = newDb();
    const live = entryOf([
      op('steam:1', 'status', 'playing', h(NOW - 9)),
      op('steam:1', 'title', 'Uno', h(NOW - 9)),
    ]);
    const tomb = { ...live, id: 'steam:2', deletedAt: new Date(NOW).toISOString() };
    const tombstone = merge(
      undefined,
      opsFromEntry({ ...tomb, hlc: { ...live.hlc, deletedAt: h(NOW - 1) } }, uuidv7),
      uuidv7,
    ).entry;
    await db.entries.bulkPut([live, tombstone]);
    const server = fakeServer();
    const { engine } = engineFor(db, server);
    await engine.join(newRecord('d1', false));
    await engine.join(newRecord('d1', false));
    expect((await db.meta.get(META_KEYS.syncState))?.value).toEqual(newRecord('d1', false));
    await engine.round();
    const sent = server.requests.flatMap((r) => r.ops);
    expect(sent).toHaveLength(Object.keys(live.hlc).length + Object.keys(tombstone.hlc).length);
    expect(sent.some((o) => o.entryId === 'steam:2' && o.field === 'deletedAt')).toBe(true);
  });

  it('purga las lápidas y los esqueletos de más de 90 días que no estén en la outbox', async () => {
    const db = newDb();
    const old = NOW - 100 * DAY;
    const base = [
      op('steam:1', 'status', 'playing', h(old)),
      op('steam:1', 'title', 'Uno', h(old)),
    ];
    const tomb = (id: string, at: number): Entry => ({
      ...entryOf(base.map((o) => ({ ...o, entryId: id }))),
      deletedAt: new Date(at).toISOString(),
    });
    const pendingSkeleton = op('steam:5', 'note', 'pendiente', h(old));
    await db.entries.bulkPut([
      tomb('steam:1', old),
      tomb('steam:2', NOW - DAY),
      entryOf([op('steam:3', 'note', 'esqueleto viejo', h(old))]),
      entryOf(base.map((o) => ({ ...o, entryId: 'steam:4' }))),
      entryOf([pendingSkeleton]),
      skeleton('steam:6'),
    ]);
    await db.outbox.add(pendingSkeleton);
    const { engine } = engineFor(db, fakeServer());
    expect(await engine.purge()).toBe(3);
    expect(((await db.entries.toCollection().primaryKeys()) as string[]).sort()).toEqual([
      'steam:2',
      'steam:4',
      'steam:5',
    ]);
  });
});
