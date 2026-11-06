// `POST /api/v1/sync` (§7.7; ADR-011): ejemplos. Las propiedades de CA4.1 van en
// `sync.properties.test.ts`.

import { MAX_SYNC_OPS } from '@gameagenda/core/api';
import { describe, expect, it } from 'vitest';
import type { D1PreparedStatement, D1Result } from '../env.ts';
import { SqliteD1 } from './d1-sqlite.ts';
import { type Client, createAgenda, createHarness, type Harness, T0 } from './harness.ts';
import {
  addOps,
  hlc,
  NODE_B,
  op,
  Replica,
  serverEntries,
  storedPlatinumViolations,
  sync,
} from './sync-support.ts';

const MANUAL = 'manual:0190b6e2-7f3a-7c4e-9d2a-1b2c3d4e5f60';
const MINUTE = 60_000;

async function pair(h: Harness): Promise<{ pc: Client; phone: Client }> {
  const pc = h.client();
  await createAgenda(pc);
  const { code } = (await pc.post('/api/v1/pairing')).json;
  const phone = h.client();
  await phone.post('/api/v1/pairing/redeem', { code, label: 'Safari en iPhone' });
  return { pc, phone };
}

/** Una D1 que deja hacer algo justo antes de la escritura de `sync`, como otro dispositivo. */
class HookedD1 extends SqliteD1 {
  beforeWrite: (() => void) | null = null;
  times = 0;

  override async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const first = (statements[0] as unknown as { sql: string } | undefined)?.sql ?? '';
    if (this.beforeWrite !== null && this.times > 0 && first.startsWith('UPDATE agenda SET seq')) {
      this.times--;
      this.beforeWrite();
    }
    return super.batch(statements);
  }
}

describe('subir y bajar', () => {
  it('sube operaciones y el otro dispositivo las baja, con el cursor', async () => {
    const h = createHarness();
    const { pc, phone } = await pair(h);
    const ops = addOps('steam:730', 'Counter-Strike 2', hlc(T0));
    const first = await sync(pc, ops);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({
      cursor: 4,
      purgedSeq: 0,
      reset: false,
      more: false,
      serverTime: T0,
      rejected: [],
    });
    expect(first.json.accepted).toEqual(ops.map((o) => o.opId));
    // Su propio lote también vuelve: aplicarlo otra vez no cambia nada.
    expect(first.json.changes).toHaveLength(4);
    expect(h.db.rows("SELECT value, seq FROM op WHERE field = 'status'")).toEqual([
      { value: '"want_to_play"', seq: expect.any(Number) },
    ]);

    const down = await sync(phone, []);
    expect(down.json.cursor).toBe(4);
    expect(down.json.changes).toContainEqual({
      entryId: 'steam:730',
      field: 'title',
      value: 'Counter-Strike 2',
      hlc: hlc(T0),
    });
    expect((await sync(phone, [], 4)).json.changes).toEqual([]);

    // Repetir el lote es idempotente: se acepta y no gasta secuencias.
    const again = await sync(pc, ops, 4);
    expect(again.json.accepted).toHaveLength(4);
    expect(again.json.changes).toEqual([]);
    expect(h.db.rows('SELECT seq FROM agenda')).toEqual([{ seq: 4 }]);
  });

  it('LWW por campo: lo más antiguo se acepta sin cambiar nada; lo más nuevo gana', async () => {
    const h = createHarness();
    const { pc } = await pair(h);
    await sync(pc, addOps('steam:730', 'CS2', hlc(T0)));
    await sync(pc, [op('steam:730', 'status', 'playing', hlc(T0 + 2000))], 4);
    const old = await sync(
      pc,
      [op('steam:730', 'status', 'on_hold', hlc(T0 + 1000, 0, NODE_B))],
      5,
    );
    expect(old.json.accepted).toHaveLength(1);
    expect(old.json.changes).toEqual([]);
    expect(h.db.rows("SELECT value FROM op WHERE field = 'status'")).toEqual([
      { value: '"playing"' },
    ]);
    const newer = await sync(
      pc,
      [op('steam:730', 'status', 'completed', hlc(T0 + 3000, 0, NODE_B))],
      5,
    );
    expect(newer.json.changes).toEqual([
      { entryId: 'steam:730', field: 'status', value: 'completed', hlc: hlc(T0 + 3000, 0, NODE_B) },
    ]);
  });

  it('Platinado ⇒ Completado: si solo llega la marca, el servidor deriva el estado', async () => {
    const h = createHarness();
    const { pc, phone } = await pair(h);
    await sync(pc, addOps('steam:620', 'Portal 2', hlc(T0)));
    await sync(pc, [op('steam:620', 'flags.platinum', true, hlc(T0 + 1000))], 4);
    expect(h.db.rows("SELECT value, hlc FROM op WHERE field = 'status'")).toEqual([
      { value: '"completed"', hlc: hlc(T0 + 1000) },
    ]);
    expect(storedPlatinumViolations(h.db)).toEqual([]);
    const down = await sync(phone, []);
    expect(down.json.changes).toContainEqual({
      entryId: 'steam:620',
      field: 'status',
      value: 'completed',
      hlc: hlc(T0 + 1000),
    });
  });

  it('reenvía a la entrada de Steam los campos de un manual vinculado, aunque no venga en el lote', async () => {
    const h = createHarness();
    const { pc } = await pair(h);
    await sync(pc, [
      ...addOps(MANUAL, 'Hades', hlc(T0)),
      op(MANUAL, 'note', 'con Zagreo', hlc(T0)),
    ]);
    await sync(pc, addOps('steam:1145360', 'Hades', hlc(T0 + 1000, 0, NODE_B)), 5);
    const before = h.db.queries;
    const link = await sync(pc, [op(MANUAL, 'mergedInto', 'steam:1145360', hlc(T0 + 2000))], 9);
    expect(link.status).toBe(200);
    // Cookie, lectura, lectura del destino y escritura: 4 consultas (≤50 en el plan gratuito).
    expect(h.db.queries - before).toBe(4);
    expect(
      h.db.rows(
        "SELECT field, value, hlc FROM op WHERE entry_id = 'steam:1145360' AND field = 'note'",
      ),
    ).toEqual([{ field: 'note', value: '"con Zagreo"', hlc: hlc(T0) }]);
    const target = serverEntries(h.db).find((e) => e.id === 'steam:1145360');
    expect(target?.status).toBe('want_to_play');
    expect(target?.note).toBe('con Zagreo');
  });
});

describe('rechazos', () => {
  it('descarta lo que no vale con toda su acción y pide volver a sellar lo que va por delante', async () => {
    const h = createHarness();
    const { pc } = await pair(h);
    const good = addOps('steam:10', 'Bueno', hlc(T0));
    const badAction = [
      op('steam:20', 'title', 'Malo', hlc(T0 + 1)),
      op('steam:20', 'status', 'jugando', hlc(T0 + 1)),
    ];
    const extra = { ...op('steam:30', 'title', 'Extra', hlc(T0 + 2)), sobra: true };
    const ahead = op('steam:40', 'title', 'Adelantado', hlc(T0 + 6 * MINUTE));
    const almost = op('steam:50', 'title', 'Casi', hlc(T0 + 4 * MINUTE));
    const ops: unknown[] = [...good, ...badAction, extra, 'basura', ahead, almost];
    const { json } = await sync(pc, ops);
    expect(json.accepted).toEqual([...good.map((o) => o.opId), almost.opId]);
    expect(json.rejected).toEqual([
      { index: 4, opId: badAction[0]?.opId, reason: 'invalid' },
      { index: 5, opId: badAction[1]?.opId, reason: 'invalid' },
      { index: 6, opId: extra.opId, reason: 'invalid' },
      { index: 7, opId: null, reason: 'invalid' },
      { index: 8, opId: ahead.opId, reason: 'clock' },
    ]);
    expect(h.db.rows('SELECT DISTINCT entry_id FROM op ORDER BY entry_id')).toEqual([
      { entry_id: 'steam:10' },
      { entry_id: 'steam:50' },
    ]);
  });

  it('más de 1 000 operaciones o un cursor negativo dan 400; sin cookie, 401', async () => {
    const h = createHarness();
    const { pc } = await pair(h);
    const many = Array.from({ length: MAX_SYNC_OPS + 1 }, (_, i) =>
      op(`steam:${i + 1}`, 'title', 'x', hlc(T0)),
    );
    expect((await sync(pc, many)).status).toBe(400);
    expect((await pc.post('/api/v1/sync', { cursor: -1, purgedSeq: 0, ops: [] })).status).toBe(400);
    expect((await pc.post('/api/v1/sync', { cursor: 0, ops: [] })).status).toBe(400);
    expect((await sync(h.client(), [])).status).toBe(401);
  });

  it('1 000 operaciones de una vez caben en el cuerpo y en una sola escritura', async () => {
    const h = createHarness();
    const { pc } = await pair(h);
    const ops = Array.from({ length: 250 }, (_, i) =>
      addOps(`steam:${i + 1}`, `Juego ${i + 1} ${'ñ'.repeat(200)}`, hlc(T0, i)),
    ).flat();
    expect(ops).toHaveLength(MAX_SYNC_OPS);
    const before = h.db.queries;
    const { status, json } = await sync(pc, ops);
    expect(status).toBe(200);
    expect(json.accepted).toHaveLength(MAX_SYNC_OPS);
    expect(json.more).toBe(false);
    expect(h.db.queries - before).toBe(3);
    expect(h.db.rows('SELECT COUNT(*) AS n FROM op')).toEqual([{ n: MAX_SYNC_OPS }]);
  });
});

describe('páginas, reset y cursor', () => {
  it('pagina los cambios y la réplica acaba con todo', async () => {
    const h = createHarness({}, { pageSize: 3 });
    const { pc, phone } = await pair(h);
    const a = new Replica(pc);
    a.local(addOps('steam:1', 'Uno', hlc(T0)));
    a.local(addOps('steam:2', 'Dos', hlc(T0 + 1)));
    await a.sync();
    const first = await sync(phone, []);
    expect(first.json.more).toBe(true);
    expect(first.json.changes).toHaveLength(3);
    expect(first.json.cursor).toBe(3);
    const b = new Replica(phone);
    await b.sync();
    expect(b.calls).toBe(3);
    expect(b.entries()).toEqual(a.entries());
    expect(b.cursor).toBe(8);
  });

  it('reset: con el cursor por debajo de una purga que no ha visto, baja todo desde 0', async () => {
    const h = createHarness({}, { pageSize: 5 });
    const { pc } = await pair(h);
    await sync(pc, addOps('steam:1', 'Uno', hlc(T0)));
    await sync(pc, addOps('steam:2', 'Dos', hlc(T0 + 1)), 4);
    await sync(pc, addOps('steam:3', 'Tres', hlc(T0 + 2)), 8);
    // Como si la purga se hubiera llevado una entrada cuya mayor `seq` era 6.
    h.db.rows('UPDATE agenda SET purged_seq = 6');

    const behind = await sync(pc, [], 5, 0);
    expect(behind.json).toMatchObject({ reset: true, more: true, purgedSeq: 6, cursor: 5 });
    expect(behind.json.changes).toHaveLength(5);
    // La página siguiente, con el `purgedSeq` nuevo, ya no es otro reset (el cursor 5 < 6).
    const next = await sync(pc, [], behind.json.cursor, behind.json.purgedSeq);
    expect(next.json).toMatchObject({ reset: false, more: true, cursor: 10 });

    expect((await sync(pc, [], 6, 0)).json.reset).toBe(false);
    expect((await sync(pc, [], 0, 0)).json.reset).toBe(false);
    expect((await sync(pc, [], 3, 6)).json.reset).toBe(false);
  });

  it('con el cursor por delante del servidor (D1 vuelto atrás), baja todo y el cursor baja', async () => {
    const h = createHarness();
    const { pc } = await pair(h);
    await sync(pc, addOps('steam:1', 'Uno', hlc(T0)));
    const { json } = await sync(pc, [], 99);
    expect(json).toMatchObject({ reset: false, more: false, cursor: 4 });
    expect(json.changes).toHaveLength(4);
  });
});

describe('cookie y retención', () => {
  it('renueva la cookie, last_seen_at y last_sync_at como mucho una vez al día', async () => {
    const h = createHarness();
    const { pc } = await pair(h);
    const sameDay = await pc.post('/api/v1/sync', { cursor: 0, purgedSeq: 0, ops: [] });
    expect(sameDay.setCookies).toEqual([]);

    h.clock.ms += 24 * 60 * MINUTE;
    const nextDay = await pc.post('/api/v1/sync', { cursor: 0, purgedSeq: 0, ops: [] });
    expect(nextDay.setCookies).toHaveLength(2);
    expect(nextDay.setCookies[0]).toContain('Max-Age=34560000');
    const at = '2026-11-07T12:00:00.000Z';
    expect(h.db.rows("SELECT last_seen_at FROM device WHERE label = 'Chrome en Windows'")).toEqual([
      { last_seen_at: at },
    ]);
    expect(h.db.rows('SELECT last_sync_at FROM agenda')).toEqual([{ last_sync_at: at }]);

    h.clock.ms += 60 * MINUTE;
    const later = await sync(pc, addOps('steam:1', 'Uno', hlc(h.clock.ms)));
    expect(later.status).toBe(200);
    expect(h.db.rows('SELECT last_sync_at FROM agenda')).toEqual([
      { last_sync_at: '2026-11-07T13:00:00.000Z' },
    ]);
  });
});

describe('concurrencia', () => {
  it('si otro dispositivo escribe entre la lectura y la escritura, lo repite', async () => {
    const db = new HookedD1();
    const h = createHarness({}, { db });
    const { pc } = await pair(h);
    db.times = 1;
    db.beforeWrite = () => db.sqlite.exec('UPDATE agenda SET seq = seq + 1');
    const { status, json } = await sync(pc, addOps('steam:1', 'Uno', hlc(T0)));
    expect(status).toBe(200);
    expect(json.cursor).toBe(5);
    expect(h.db.rows('SELECT seq FROM op ORDER BY seq')).toEqual([
      { seq: 2 },
      { seq: 3 },
      { seq: 4 },
      { seq: 5 },
    ]);
  });

  it('si no deja de chocar, 503 busy y no escribe nada', async () => {
    const db = new HookedD1();
    const h = createHarness({}, { db });
    const { pc } = await pair(h);
    db.times = Number.POSITIVE_INFINITY;
    db.beforeWrite = () => db.sqlite.exec('UPDATE agenda SET seq = seq + 1');
    const response = await sync(pc, addOps('steam:1', 'Uno', hlc(T0)));
    expect(response.status).toBe(503);
    expect(response.json).toEqual({ error: 'busy' });
    expect(h.db.rows('SELECT * FROM op')).toEqual([]);
  });

  it('si la agenda se borra a la vez, 401 y fuera las cookies', async () => {
    const db = new HookedD1();
    const h = createHarness({}, { db });
    const { pc } = await pair(h);
    db.times = 1;
    db.beforeWrite = () => db.sqlite.exec('DELETE FROM agenda');
    const response = await pc.post('/api/v1/sync', {
      cursor: 0,
      purgedSeq: 0,
      ops: addOps('steam:1', 'Uno', hlc(T0)),
    });
    expect(response.status).toBe(401);
    expect(pc.cookies.size).toBe(0);
  });
});
