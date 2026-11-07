// El motor con un servidor falso (las pruebas de punta a punta, contra la micro-API de verdad, van
// en `apps/web/worker/test/sync-client*.test.ts`).
import type { SyncResponse } from '@gameagenda/core/api';
import { type Entry, isLive, skeleton } from '@gameagenda/core/entries';
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
const EPOCH = 'a1b2c3d4e5f60718';
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

/** Una base emparejada (con `meta.syncState`, sin él el motor no escribe nada). */
async function newDb(paired = true): Promise<GameAgendaDb> {
  const db = openDatabase({
    name: `engine-${dbs.length}`,
    indexedDB: new IDBFactory(),
    IDBKeyRange,
  });
  dbs.push(db);
  if (paired) await db.meta.put({ key: META_KEYS.syncState, value: newRecord('d1', false) });
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
          epoch: EPOCH,
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

/** «Apuntar» un juego: estado y título con la misma HLC. */
function added(id: string, title: string, hlc: string): Entry {
  return entryOf([op(id, 'status', 'want_to_play', hlc), op(id, 'title', title, hlc)]);
}

/** Lo guardado en `meta.syncCursor`. */
async function cursorOf(db: GameAgendaDb): Promise<unknown> {
  return (await db.meta.get(META_KEYS.syncCursor))?.value;
}

/** Cuenta las lecturas enteras de la `outbox` (`toArray`). */
function countOutboxReads(db: GameAgendaDb): { reads: number } {
  const counter = { reads: 0 };
  const read = db.outbox.toArray.bind(db.outbox);
  db.outbox.toArray = (() => {
    counter.reads += 1;
    return read();
  }) as typeof db.outbox.toArray;
  return counter;
}

describe('subir la outbox', () => {
  it('compacta, borra lo que sobra y sube por lotes sin partir acciones', async () => {
    const db = await newDb();
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
    expect(result).toMatchObject({ requests: 2, complete: true, pending: 0, aborted: false });
    expect(await db.outbox.count()).toBe(0);
  });

  it('quita lo aceptado y lo inválido, pero no lo que cambió mientras tanto', async () => {
    const db = await newDb();
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
    const db = await newDb();
    await db.outbox.bulkAdd([1, 2, 3].map((i) => op(`steam:${i}`, 'note', 'x', h(NOW - i))));
    const server = fakeServer();
    const { engine } = engineFor(db, server, { batchSize: 1, maxRequests: 2 });
    expect(await engine.round()).toMatchObject({ requests: 2, complete: false, pending: 1 });
  });

  it('lee y compacta la outbox una vez por ronda, por muchos lotes que suba', async () => {
    const db = await newDb();
    // 40 juegos de 15 operaciones, como los deja `join`, con HLC sin relación con los id.
    const ops = Array.from({ length: 40 }, (_, i) =>
      Array.from({ length: 15 }, (__, f) =>
        op(`steam:${i + 1}`, `flags.f${f}`, true, h(NOW - 1000 + ((i * 7) % 40))),
      ),
    ).flat();
    await db.outbox.bulkAdd(ops);
    const counter = countOutboxReads(db);
    const server = fakeServer();
    const { engine } = engineFor(db, server, { batchSize: 50 });
    const result = await engine.round();
    // Lotes de 3 acciones (45 operaciones): 14 peticiones.
    expect(result).toMatchObject({ requests: 14, complete: true, pending: 0 });
    expect(counter.reads).toBe(1);
    // En orden de HLC y sin repetir ni perder nada.
    const sent = server.requests.flatMap((r) => r.ops);
    expect(sent.map((o) => o.opId).sort()).toEqual(ops.map((o) => o.opId).sort());
    expect(sent.map((o) => o.hlc)).toEqual([...sent.map((o) => o.hlc)].sort());
  });

  it('vuelve a leer la outbox si la agenda escribe a mitad de ronda, y sube lo nuevo', async () => {
    const db = await newDb();
    await db.outbox.bulkAdd([1, 2, 3].map((i) => op(`steam:${i}`, 'note', 'x', h(NOW - 10 + i))));
    const late = op('steam:9', 'note', 'escrita durante la ronda', h(NOW));
    const counter = countOutboxReads(db);
    const server = fakeServer([
      (request) => {
        void db.outbox.add(late);
        return { accepted: request.ops.map((o) => o.opId) };
      },
    ]);
    const { engine } = engineFor(db, server, { batchSize: 1 });
    expect(await engine.round()).toMatchObject({ complete: true, pending: 0 });
    expect(server.requests.flatMap((r) => r.ops).map((o) => o.entryId)).toEqual([
      'steam:1',
      'steam:2',
      'steam:3',
      'steam:9',
    ]);
    expect(counter.reads).toBe(2);
  });
});

describe('bajar cambios', () => {
  it('fusiona con merge() sobre lo guardado y las derivadas no van a la outbox', async () => {
    const db = await newDb();
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
    expect(meta[0]?.value).toEqual({
      cursor: 7,
      purgedSeq: 0,
      reset: false,
      maxSeen: h(NOW - 5),
      epoch: EPOCH,
    });
    expect(meta[1]?.value).toEqual(clock.snapshot());
    // El reloj ya va por delante de lo recibido.
    expect(clock.next() > h(NOW - 5)).toBe(true);
  });

  it('sigue las páginas con el cursor de cada una', async () => {
    const db = await newDb();
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

  it('con el cursor menor que el enviado (D1 vuelto atrás), lo vuelve a subir todo', async () => {
    const db = await newDb();
    const e = entryOf([
      op('steam:1', 'status', 'playing', h(NOW - 9)),
      op('steam:1', 'title', 'Uno', h(NOW - 9)),
    ]);
    await db.entries.put(e);
    await db.meta.put({
      key: META_KEYS.syncCursor,
      value: { cursor: 50, purgedSeq: 0, reset: false, maxSeen: '', epoch: EPOCH },
    });
    const server = fakeServer([{ cursor: 20 }]);
    const { engine } = engineFor(db, server);
    await engine.round();
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]?.ops.map((o) => o.field).sort()).toEqual(['status', 'title']);
    expect(await cursorOf(db)).toMatchObject({ cursor: 20 });
  });

  it('el servidor no acepta el lote de un D1 vuelto atrás: sigue en la outbox y sube con todo', async () => {
    const db = await newDb();
    await db.entries.put(added('steam:1', 'Uno', h(NOW - 9)));
    const pending = op('steam:2', 'note', 'pendiente', h(NOW - 1));
    await db.entries.put(entryOf([pending]));
    await db.outbox.add(pending);
    await db.meta.put({
      key: META_KEYS.syncCursor,
      value: { cursor: 50, purgedSeq: 0, reset: false, maxSeen: '', epoch: EPOCH },
    });
    const server = fakeServer([{ cursor: 20, accepted: [] }]);
    const { engine } = engineFor(db, server);
    expect(await engine.round()).toMatchObject({ complete: true, pending: 0 });
    expect(server.requests[0]?.ops.map((o) => o.opId)).toEqual([pending.opId]);
    const second = server.requests[1]?.ops ?? [];
    expect(second.map((o) => `${o.entryId} ${o.field}`).sort()).toEqual([
      'steam:1 status',
      'steam:1 title',
      'steam:2 note',
    ]);
  });
});

describe('época de la agenda', () => {
  async function withCursor(epoch: string | undefined) {
    const db = await newDb();
    await db.entries.put(added('steam:1', 'Uno', h(NOW - 9)));
    const value = { cursor: 50, purgedSeq: 3, reset: false, maxSeen: '' };
    await db.meta.put({
      key: META_KEYS.syncCursor,
      value: epoch === undefined ? value : { ...value, epoch },
    });
    return db;
  }

  it('la primera respuesta la guarda, sin volver a subir nada', async () => {
    const db = await withCursor(undefined);
    const server = fakeServer([{ cursor: 60 }]);
    const { engine } = engineFor(db, server);
    expect(await engine.round()).toMatchObject({ requests: 1, complete: true });
    expect(await cursorOf(db)).toMatchObject({ cursor: 60, epoch: EPOCH });
  });

  it('otra época: lo vuelve a subir todo y vuelve a bajar desde 0, sin reset', async () => {
    const db = await withCursor('0000000000000000');
    // El cursor del restore pasa al de la app: sin la época, nadie lo notaría.
    const server = fakeServer([
      {
        cursor: 60,
        reset: true,
        more: true,
        changes: [{ entryId: 'steam:7', field: 'note', value: 'de otro', hlc: h(NOW - 5) }],
      },
      { cursor: 70, more: false },
    ]);
    const { engine } = engineFor(db, server);
    expect(await engine.round()).toMatchObject({ complete: true, pending: 0 });
    expect(server.requests.map((r) => r.cursor)).toEqual([50, 0]);
    expect(server.requests[1]?.ops.map((o) => `${o.entryId} ${o.field}`).sort()).toEqual([
      'steam:1 status',
      'steam:1 title',
      'steam:7 note',
    ]);
    // Lo de la página se fusiona y nada se borra (no es un reset).
    expect(((await db.entries.toCollection().primaryKeys()) as string[]).sort()).toEqual([
      'steam:1',
      'steam:7',
    ]);
    expect(await cursorOf(db)).toMatchObject({ cursor: 70, reset: false, epoch: EPOCH });
  });

  it('otra época sin nada local: en la misma ronda vuelve a bajar desde 0', async () => {
    const db = await newDb();
    await db.meta.put({
      key: META_KEYS.syncCursor,
      value: { cursor: 50, purgedSeq: 0, reset: false, maxSeen: '', epoch: '0000000000000000' },
    });
    const server = fakeServer([
      { cursor: 60 },
      {
        cursor: 60,
        changes: [{ entryId: 'steam:1', field: 'note', value: 'x', hlc: h(NOW - 5) }],
      },
    ]);
    const { engine } = engineFor(db, server);
    expect(await engine.round()).toMatchObject({ requests: 2, complete: true });
    expect(server.requests.map((r) => r.cursor)).toEqual([50, 0]);
    expect(await db.entries.count()).toBe(1);
  });
});

describe('reset', () => {
  it('con reset, al acabar borra lo que el servidor no ha mandado y no está en la outbox', async () => {
    const db = await newDb();
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
    // Mientras dura el reset, las peticiones solo bajan; lo pendiente sube al acabar.
    expect(server.requests.map((r) => r.ops.length)).toEqual([1, 0, 1]);
    expect(await db.entries.get('steam:1')).toBeUndefined();
    expect(await db.entries.get('steam:2')).toEqual(kept);
    // Lo pendiente se queda solo con lo pendiente: es lo que tendrá el servidor.
    expect(await db.entries.get('steam:3')).toEqual(entryOf([pending]));
    expect(await cursorOf(db)).toMatchObject({ reset: false, cursor: 12 });
  });

  it('un reset cortado no toca ninguna entrada hasta su última página', async () => {
    const db = await newDb();
    const one = added('steam:1', 'Uno', h(NOW - DAY));
    const two = added('steam:2', 'Dos', h(NOW - DAY));
    await db.entries.bulkPut([one, two]);
    await db.meta.put({
      key: META_KEYS.syncCursor,
      value: { cursor: 10, purgedSeq: 0, reset: false, maxSeen: '' },
    });
    // La primera página solo trae el estado de steam:1 (su título vendría en otra).
    const firstPage: Reply = {
      cursor: 3,
      purgedSeq: 9,
      reset: true,
      more: true,
      changes: [{ entryId: 'steam:1', field: 'status', value: 'want_to_play', hlc: h(NOW - DAY) }],
    };
    const server = fakeServer([firstPage]);
    const failing = {
      sync: async (request: SyncCall) => {
        if (server.requests.length > 0) throw new Error('red');
        return server.transport.sync(request);
      },
    };
    const engine = createSyncEngine({
      db,
      transport: failing,
      clock: createHlcClock({ now: () => NOW, node: 'cccccccc' }),
      newOpId: uuidv7,
      now: () => NOW,
      yieldToMain: () => Promise.resolve(),
    });
    await expect(engine.round()).rejects.toThrow('red');
    expect(await db.entries.get('steam:1')).toEqual(one);
    expect(await db.entries.get('steam:2')).toEqual(two);
    expect(await cursorOf(db)).toMatchObject({ cursor: 0, purgedSeq: 9, reset: true });
  });

  it('un reset de más páginas que el tope de peticiones acaba en una sola ronda', async () => {
    const db = await newDb();
    const purged = added('steam:99', 'Purgada en el servidor', h(NOW - DAY));
    await db.entries.put(purged);
    await db.meta.put({
      key: META_KEYS.syncCursor,
      value: { cursor: 3, purgedSeq: 0, reset: false, maxSeen: '' },
    });
    const page = (n: number): Reply => ({
      cursor: n * 10,
      purgedSeq: 9,
      reset: n === 1,
      more: n < 5,
      changes: [{ entryId: `steam:${n}`, field: 'note', value: 'x', hlc: h(NOW - DAY + n) }],
    });
    const server = fakeServer([1, 2, 3, 4, 5].map(page));
    const { engine } = engineFor(db, server, { maxRequests: 3 });
    expect(await engine.round()).toMatchObject({ requests: 5, complete: true, aborted: false });
    expect(server.requests.map((r) => r.cursor)).toEqual([3, 10, 20, 30, 40]);
    expect(await db.entries.get('steam:99')).toBeUndefined();
    expect(await db.entries.count()).toBe(5);
    expect(await cursorOf(db)).toMatchObject({ cursor: 50, reset: false });
  });

  it('un reset que no avanza sí cuenta para el tope', async () => {
    const db = await newDb();
    await db.meta.put({
      key: META_KEYS.syncCursor,
      value: { cursor: 3, purgedSeq: 0, reset: false, maxSeen: '' },
    });
    // Un servidor que vuelve a empezar el reset en cada página.
    const again: Reply = { cursor: 10, purgedSeq: 9, reset: true, more: true };
    const server = fakeServer([again, again, again, again]);
    const { engine } = engineFor(db, server, { maxRequests: 3 });
    expect(await engine.round()).toMatchObject({ requests: 3, complete: false });
  });
});

describe('sin meta.syncState no escribe nada', () => {
  it('si lo borran mientras va la petición, no aplica la respuesta y para', async () => {
    const db = await newDb();
    const pending = op('steam:1', 'note', 'pendiente', h(NOW - 1));
    await db.entries.put(entryOf([pending]));
    await db.outbox.add(pending);
    const server = fakeServer([
      () => {
        // «Borrar todos mis datos» en otra pestaña (o desemparejar) mientras tanto.
        void db.meta.delete(META_KEYS.syncState);
        return {
          cursor: 8,
          more: true,
          changes: [{ entryId: 'steam:2', field: 'note', value: 'remota', hlc: h(NOW - 2) }],
        };
      },
    ]);
    const { engine } = engineFor(db, server);
    expect(await engine.round()).toMatchObject({ requests: 1, complete: false, aborted: true });
    expect(await db.entries.get('steam:2')).toBeUndefined();
    expect(await db.outbox.count()).toBe(1);
    expect(await db.meta.get(META_KEYS.syncCursor)).toBeUndefined();
    expect(await db.meta.get(META_KEYS.hlcClock)).toBeUndefined();
  });

  it('sin él, la ronda no manda ninguna petición', async () => {
    const db = await newDb(false);
    await db.outbox.add(op('steam:1', 'note', 'x', h(NOW - 1)));
    const server = fakeServer();
    const { engine } = engineFor(db, server);
    expect(await engine.round()).toMatchObject({ requests: 0, aborted: true });
    expect(server.requests).toEqual([]);
  });
});

describe('reloj', () => {
  it('rechazo por reloj: corrige el desfase y vuelve a sellar la outbox y la entrada', async () => {
    const db = await newDb();
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

  it('si el desfase baja el reloj, vuelve a ir por delante de lo legítimo de la agenda', async () => {
    const db = await newDb();
    // 6 min adelantado: una entrada de hace 3 min (aceptada, ya subida) y una futura en la outbox.
    const wall = NOW + 6 * MINUTE;
    const recent = added('steam:10', 'Diez', h(NOW + 3 * MINUTE, 0, 'cccccccc'));
    const future = op('steam:11', 'note', 'futura', h(wall, 0, 'cccccccc'));
    await db.entries.bulkPut([recent, entryOf([future])]);
    await db.outbox.add(future);
    const clock = createHlcClock({ now: () => wall, node: 'cccccccc' });
    clock.receive(future.hlc);
    const server = fakeServer([{ serverTime: NOW, accepted: [], more: true }]);
    const engine = createSyncEngine({
      db,
      transport: server.transport,
      clock,
      newOpId: uuidv7,
      now: () => wall,
      yieldToMain: () => Promise.resolve(),
      maxRequests: 1,
    });
    await engine.round();
    expect(clock.offset).toBe(-6 * MINUTE);
    // La parte física ha bajado, pero no por detrás de steam:10.
    expect(clock.next() > recent.lastHlc).toBe(true);
    expect(clock.next() < future.hlc).toBe(true);
  });
});

describe('unirse', () => {
  it('join sube todas las entradas, lápidas incluidas, y es idempotente al compactar', async () => {
    const db = await newDb(false);
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

  it('lo que D1 purgaría no sube su contenido, ni lo que ya tenía en la outbox, y en local queda igual', async () => {
    const db = await newDb(false);
    const old = NOW - 100 * DAY;
    const capture = [
      op('steam:1', 'status', 'playing', h(old)),
      op('steam:1', 'title', 'Uno', h(old)),
      op('steam:1', 'note', 'nota privada', h(old)),
    ];
    const removed = op('steam:1', 'deletedAt', new Date(old + 1).toISOString(), h(old + 1));
    const oldSkeleton = op('steam:3', 'note', 'esqueleto viejo', h(old));
    const recentTomb = [
      op('steam:4', 'status', 'playing', h(old)),
      op('steam:4', 'title', 'Cuatro', h(old)),
      op('steam:4', 'deletedAt', new Date(NOW - DAY).toISOString(), h(NOW - DAY)),
    ];
    await db.entries.bulkPut([
      entryOf([...capture, removed]),
      added('steam:2', 'Viva', h(old)),
      entryOf([oldSkeleton]),
      entryOf(recentTomb),
      skeleton('steam:5'),
    ]);
    // La agenda lo apuntaba todo en la outbox desde M1.
    await db.outbox.bulkAdd([...capture, removed, oldSkeleton]);
    const server = fakeServer();
    const { engine } = engineFor(db, server);
    await engine.join(newRecord('d1', false));
    await engine.round();
    const sent = server.requests.flatMap((r) => r.ops).map((o) => `${o.entryId} ${o.field}`);
    expect(sent.filter((s) => s.startsWith('steam:1 '))).toEqual(['steam:1 deletedAt']);
    expect(sent.filter((s) => s.startsWith('steam:3 ') || s.startsWith('steam:5 '))).toEqual([]);
    expect(sent.filter((s) => s.startsWith('steam:4 ')).sort()).toEqual([
      'steam:4 deletedAt',
      'steam:4 status',
      'steam:4 title',
    ]);
    expect(await db.entries.get('steam:1')).toEqual(entryOf([removed]));
    expect(await db.entries.get('steam:3')).toBeUndefined();
    expect(isLive(await db.entries.get('steam:2'))).toBe(true);
  });

  it('una lápida de vinculación purgable sube deletedAt y mergedInto', async () => {
    const db = await newDb(false);
    const old = NOW - 120 * DAY;
    const manual = 'manual:0190b6e2-7f3a-7c4e-9d2a-1b2c3d4e5f60';
    const link = h(old + 1);
    await db.entries.put(
      entryOf([
        op(manual, 'status', 'playing', h(old)),
        op(manual, 'title', 'Hades', h(old)),
        op(manual, 'note', 'con Zagreo', h(old)),
        op(manual, 'deletedAt', new Date(old + 1).toISOString(), link),
        op(manual, 'mergedInto', 'steam:1145350', link),
      ]),
    );
    const server = fakeServer();
    const { engine } = engineFor(db, server);
    await engine.join(newRecord('d1', false));
    await engine.round();
    const sent = server.requests.flatMap((r) => r.ops);
    expect(sent.map((o) => [o.field, o.value, o.hlc]).sort()).toEqual([
      ['deletedAt', new Date(old + 1).toISOString(), link],
      ['mergedInto', 'steam:1145350', link],
    ]);
  });
});
