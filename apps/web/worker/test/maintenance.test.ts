// Mantenimiento de D1 (§7.7 y §11.2; ADR-011): *tokens* caducados, agendas sin sincronizar en
// 13 meses, la purga semanal de lápidas y esqueletos, y los tickets y el contador de Steam.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import worker from '../index.ts';
import {
  purgeSteamTickets,
  runMaintenance,
  STEAM_PURGE_CRON,
  STEAM_QUOTA_KEEP_DAYS,
  utcDay,
} from '../maintenance.ts';
import { createAgenda, createHarness, type Harness } from './harness.ts';
import { addOps, hlc, op, Replica, sync } from './sync-support.ts';

const DAY = 86_400_000;
/** Lunes 09-11-2026 a las 03:17 UTC, cuando corre el Cron Trigger. */
const MONDAY = Date.UTC(2026, 10, 9, 3, 17);
const TUESDAY = MONDAY + DAY;
/** Un juego apuntado a mano: sus lápidas sí se purgan (las de Steam, no; ADR-014). */
const MANUAL = 'manual:0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a51';

function count(h: Harness, table: string): number {
  return (h.db.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)[0] as { n: number }).n;
}

describe('a diario', () => {
  it('borra los tokens de emparejamiento caducados y deja los vigentes', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    h.clock.ms = TUESDAY - 20 * 60_000;
    await pc.post('/api/v1/pairing');
    h.clock.ms = TUESDAY - 5 * 60_000;
    await pc.post('/api/v1/pairing');
    await runMaintenance(h.db, TUESDAY);
    expect(h.db.rows('SELECT expires_at FROM pairing_token')).toEqual([
      { expires_at: new Date(TUESDAY + 5 * 60_000).toISOString() },
    ]);
  });

  it('borra en cascada las agendas sin sincronizar en 13 meses', async () => {
    const h = createHarness();
    const old = h.client();
    await createAgenda(old, 'Viejo');
    await sync(old, addOps('steam:1', 'Uno', hlc(h.clock.ms)));
    const recent = h.client();
    await createAgenda(recent, 'Reciente');
    h.db.rows("UPDATE agenda SET last_sync_at = '2025-10-08T00:00:00.000Z' WHERE seq > 0");
    h.db.rows("UPDATE agenda SET last_sync_at = '2025-10-11T00:00:00.000Z' WHERE seq = 0");
    await runMaintenance(h.db, TUESDAY);
    expect(count(h, 'agenda')).toBe(1);
    expect(count(h, 'op')).toBe(0);
    expect(h.db.rows('SELECT label FROM device')).toEqual([{ label: 'Reciente' }]);
  });
});

describe('purga semanal (los lunes)', () => {
  async function scenario() {
    const h = createHarness();
    h.clock.ms = MONDAY;
    const pc = h.client();
    await createAgenda(pc);
    const a = new Replica(pc);
    const old = MONDAY - 100 * DAY;
    a.local(addOps(MANUAL, 'Borrado hace 100 días', hlc(old)));
    a.local(addOps('steam:2', 'Borrado hace 10 días', hlc(old)));
    a.local(addOps('steam:3', 'Borrado y vuelto a apuntar', hlc(old)));
    a.local(addOps('steam:4', 'Vivo', hlc(old)));
    a.local([op('steam:5', 'note', 'esqueleto viejo', hlc(old))]);
    a.local([op('steam:6', 'note', 'esqueleto reciente', hlc(MONDAY - DAY))]);
    a.local([op(MANUAL, 'deletedAt', new Date(old + DAY).toISOString(), hlc(old + DAY))]);
    a.local([
      op('steam:2', 'deletedAt', new Date(MONDAY - 10 * DAY).toISOString(), hlc(MONDAY - 10 * DAY)),
    ]);
    a.local([op('steam:3', 'deletedAt', new Date(old + DAY).toISOString(), hlc(old + DAY))]);
    a.local([op('steam:3', 'deletedAt', null, hlc(old + 2 * DAY))]);
    await a.sync();
    return { h, a };
  }

  function entryIds(h: Harness): string[] {
    return h.db
      .rows<{ entry_id: string }>('SELECT DISTINCT entry_id FROM op ORDER BY entry_id')
      .map((r) => r.entry_id);
  }

  it('se lleva las lápidas de más de 90 días y los esqueletos viejos; purged_seq, a la seq nueva', async () => {
    const { h } = await scenario();
    const [{ seq: before } = { seq: 0 }] = h.db.rows<{ seq: number }>('SELECT seq FROM agenda');
    await runMaintenance(h.db, MONDAY);
    expect(entryIds(h)).toEqual(['steam:2', 'steam:3', 'steam:4', 'steam:6']);
    expect(h.db.rows('SELECT seq, purged_seq FROM agenda')).toEqual([
      { seq: before + 1, purged_seq: before + 1 },
    ]);
  });

  it('una agenda sin nada que purgar no cambia', async () => {
    const { h } = await scenario();
    const other = h.client();
    await createAgenda(other, 'Otra');
    await sync(other, addOps('steam:1', 'Uno', hlc(MONDAY - 100 * DAY)));
    const otherSeq = () =>
      h.db.rows<{ seq: number; purged_seq: number }>(
        "SELECT seq, purged_seq FROM agenda WHERE id IN (SELECT agenda_id FROM device WHERE label = 'Otra')",
      );
    const before = otherSeq();
    await runMaintenance(h.db, MONDAY);
    expect(otherSeq()).toEqual(before);
    expect(before).toEqual([{ seq: 4, purged_seq: 0 }]);
  });

  it('fuera de los lunes no purga nada', async () => {
    const { h } = await scenario();
    await runMaintenance(h.db, TUESDAY);
    expect(entryIds(h)).toHaveLength(6);
    expect(h.db.rows('SELECT purged_seq FROM agenda')).toEqual([{ purged_seq: 0 }]);
  });

  it('toda app que sincronizó antes de la purga recibe reset, también la que estaba al día', async () => {
    const { h, a } = await scenario();
    const [{ seq: synced } = { seq: 0 }] = h.db.rows<{ seq: number }>('SELECT seq FROM agenda');
    expect(a.cursor).toBe(synced);
    await runMaintenance(h.db, MONDAY);
    // Al día: tiene las lápidas que D1 ya no tiene, y el reset hace que las quite.
    const upToDate = await sync(a.client, [], a.cursor, a.purgedSeq);
    expect(upToDate.json).toMatchObject({ reset: true, purgedSeq: synced + 1, cursor: synced + 1 });
    expect(upToDate.json.changes.map((c) => c.entryId)).not.toContain(MANUAL);
    // Una copia que se quedó en la primera página, igual.
    expect((await sync(a.client, [], 2, 0)).json.reset).toBe(true);
    // Tras el reset no se repite: el cursor llega a la seq nueva con el purgedSeq nuevo.
    const after = await sync(a.client, [], upToDate.json.cursor, upToDate.json.purgedSeq);
    expect(after.json).toMatchObject({ reset: false, changes: [] });
    // Ni con el purgedSeq viejo, porque el cursor ya no está por debajo de la purga.
    expect((await sync(a.client, [], upToDate.json.cursor, 0)).json.reset).toBe(false);
    // Una app que nunca ha sincronizado (cursor 0) lo baja todo sin reset.
    expect((await sync(a.client, [], 0, 0)).json.reset).toBe(false);
  });

  it('repetirla no cambia nada', async () => {
    const { h } = await scenario();
    await runMaintenance(h.db, MONDAY);
    const after = h.db.rows('SELECT * FROM op ORDER BY entry_id, field');
    const agenda = h.db.rows('SELECT purged_seq FROM agenda');
    await runMaintenance(h.db, MONDAY);
    expect(h.db.rows('SELECT * FROM op ORDER BY entry_id, field')).toEqual(after);
    expect(h.db.rows('SELECT purged_seq FROM agenda')).toEqual(agenda);
  });
});

describe('las lápidas de Steam (ADR-014)', () => {
  /** Un juego de Steam apuntado y quitado hace `daysAgo` días, y uno de Steam que sigue. */
  async function removed(daysAgo: number) {
    const h = createHarness();
    h.clock.ms = MONDAY;
    const pc = h.client();
    await createAgenda(pc);
    const a = new Replica(pc);
    const old = MONDAY - 200 * DAY;
    const at = MONDAY - daysAgo * DAY;
    a.local(addOps('steam:7', 'Quitado', hlc(old)));
    a.local([op('steam:7', 'note', 'una nota', hlc(old))]);
    a.local([op('steam:7', 'deletedAt', new Date(at).toISOString(), hlc(at))]);
    a.local(addOps('steam:8', 'Vivo', hlc(old)));
    await a.sync();
    return { h, a };
  }

  function fieldsOf(h: Harness, entryId: string): string[] {
    return h.db
      .rows<{ field: string }>('SELECT field FROM op WHERE entry_id = ?1 ORDER BY field', entryId)
      .map((r) => r.field);
  }

  it('a los 90 días no se purgan: se quedan sin contenido, solo con deletedAt', async () => {
    const { h, a } = await removed(100);
    const live = fieldsOf(h, 'steam:8');
    const [{ seq: before } = { seq: 0 }] = h.db.rows<{ seq: number }>('SELECT seq FROM agenda');
    await runMaintenance(h.db, MONDAY);
    expect(fieldsOf(h, 'steam:7')).toEqual(['deletedAt']);
    expect(fieldsOf(h, 'steam:8')).toEqual(live);
    // Como una purga: las apps que sincronizaron antes reciben reset y se quedan igual que D1.
    expect(h.db.rows('SELECT seq, purged_seq FROM agenda')).toEqual([
      { seq: before + 1, purged_seq: before + 1 },
    ]);
    const reset = await sync(a.client, [], a.cursor, a.purgedSeq);
    expect(reset.json.reset).toBe(true);
    const tombstone = reset.json.changes.filter(
      (c: { entryId: string }) => c.entryId === 'steam:7',
    );
    expect(tombstone.map((c: { field: string }) => c.field)).toEqual(['deletedAt']);
  });

  it('una lápida ya reducida no se vuelve a tocar: ni se purga ni fuerza otro reset', async () => {
    const { h } = await removed(100);
    await runMaintenance(h.db, MONDAY);
    const agenda = h.db.rows('SELECT seq, purged_seq FROM agenda');
    await runMaintenance(h.db, MONDAY + 7 * DAY);
    await runMaintenance(h.db, MONDAY + 14 * DAY);
    expect(fieldsOf(h, 'steam:7')).toEqual(['deletedAt']);
    expect(h.db.rows('SELECT seq, purged_seq FROM agenda')).toEqual(agenda);
  });

  it('antes de los 90 días no cambia nada', async () => {
    const { h } = await removed(10);
    const before = h.db.rows('SELECT * FROM op ORDER BY entry_id, field');
    await runMaintenance(h.db, MONDAY);
    expect(h.db.rows('SELECT * FROM op ORDER BY entry_id, field')).toEqual(before);
    expect(h.db.rows('SELECT purged_seq FROM agenda')).toEqual([{ purged_seq: 0 }]);
  });
});

describe('Steam (ADR-012)', () => {
  const CHALLENGE = 'c'.repeat(43);
  const STEAM_ID = '76561197960287930';

  function addTicket(h: Harness, hash: string, expiresAt: number, steamId: string | null = null) {
    h.db.rows(
      `INSERT INTO steam_ticket (ticket_hash, challenge, expires_at, steam_id)
       VALUES ('${hash}', '${CHALLENGE}', '${new Date(expiresAt).toISOString()}', ${steamId === null ? 'NULL' : `'${steamId}'`})`,
    );
  }

  function tickets(h: Harness): string[] {
    return h.db
      .rows<{ ticket_hash: string }>('SELECT ticket_hash FROM steam_ticket ORDER BY ticket_hash')
      .map((r) => r.ticket_hash);
  }

  it('cada 5 min, fuera los tickets caducados (con o sin SteamID64) y nada más', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    h.clock.ms = TUESDAY - 20 * 60_000;
    await pc.post('/api/v1/pairing');
    addTicket(h, 'a-caducado', TUESDAY - 1, STEAM_ID);
    addTicket(h, 'b-justo', TUESDAY);
    addTicket(h, 'c-vigente', TUESDAY + 1, STEAM_ID);
    h.db.rows("INSERT INTO steam_quota (day, calls) VALUES ('2026-10-01', 3)");
    await purgeSteamTickets(h.db, TUESDAY);
    expect(tickets(h)).toEqual(['c-vigente']);
    expect(count(h, 'pairing_token')).toBe(1);
    expect(count(h, 'steam_quota')).toBe(1);
  });

  it('a diario, también los tickets caducados y los días del contador de hace más de una semana', async () => {
    const h = createHarness();
    addTicket(h, 'a-caducado', TUESDAY - 1);
    addTicket(h, 'b-vigente', TUESDAY + 60_000);
    const day = (offset: number) => utcDay(TUESDAY + offset * DAY);
    for (const offset of [-8, -STEAM_QUOTA_KEEP_DAYS, -1, 0]) {
      h.db.rows(`INSERT INTO steam_quota (day, calls) VALUES ('${day(offset)}', 2)`);
    }
    await runMaintenance(h.db, TUESDAY);
    expect(tickets(h)).toEqual(['b-vigente']);
    expect(h.db.rows('SELECT day FROM steam_quota ORDER BY day')).toEqual(
      [-STEAM_QUOTA_KEEP_DAYS, -1, 0].map((offset) => ({ day: day(offset) })),
    );
  });

  it('el SteamID64 solo puede ser de 17 cifras', () => {
    const h = createHarness();
    expect(() => addTicket(h, 'x', TUESDAY, '7656119796028793')).toThrow(/CHECK/);
    expect(() => addTicket(h, 'y', TUESDAY, '7656119796028793a')).toThrow(/CHECK/);
    addTicket(h, 'z', TUESDAY, STEAM_ID);
    expect(tickets(h)).toEqual(['z']);
  });

  it('el Worker reparte los dos Cron Triggers de wrangler.jsonc', async () => {
    const config = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
    const crons = JSON.parse(/"crons":\s*(\[[^\]]*\])/.exec(config)?.[1] ?? '[]') as string[];
    expect(crons).toEqual(['17 3 * * *', STEAM_PURGE_CRON]);

    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    h.clock.ms = TUESDAY - 20 * 60_000;
    await pc.post('/api/v1/pairing');
    addTicket(h, 'a-caducado', TUESDAY - 1);
    const run = async (cron: string) => {
      const pending: Promise<unknown>[] = [];
      worker.scheduled({ cron, scheduledTime: TUESDAY }, h.env, {
        waitUntil: (promise) => pending.push(promise),
      });
      await Promise.all(pending);
    };
    await run(STEAM_PURGE_CRON);
    expect(tickets(h)).toEqual([]);
    expect(count(h, 'pairing_token')).toBe(1);
    await run('17 3 * * *');
    expect(count(h, 'pairing_token')).toBe(0);
  });
});
