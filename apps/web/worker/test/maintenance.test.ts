// Mantenimiento de D1 (§7.7 y §11.2; ADR-011): *tokens* caducados, agendas sin sincronizar en
// 13 meses y la purga semanal de lápidas y esqueletos.

import { describe, expect, it } from 'vitest';
import { runMaintenance } from '../maintenance.ts';
import { createAgenda, createHarness, type Harness } from './harness.ts';
import { addOps, hlc, op, Replica, sync } from './sync-support.ts';

const DAY = 86_400_000;
/** Lunes 09-11-2026 a las 03:17 UTC, cuando corre el Cron Trigger. */
const MONDAY = Date.UTC(2026, 10, 9, 3, 17);
const TUESDAY = MONDAY + DAY;

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
    a.local(addOps('steam:1', 'Borrado hace 100 días', hlc(old)));
    a.local(addOps('steam:2', 'Borrado hace 10 días', hlc(old)));
    a.local(addOps('steam:3', 'Borrado y vuelto a apuntar', hlc(old)));
    a.local(addOps('steam:4', 'Vivo', hlc(old)));
    a.local([op('steam:5', 'note', 'esqueleto viejo', hlc(old))]);
    a.local([op('steam:6', 'note', 'esqueleto reciente', hlc(MONDAY - DAY))]);
    a.local([op('steam:1', 'deletedAt', new Date(old + DAY).toISOString(), hlc(old + DAY))]);
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

  it('se lleva las lápidas de más de 90 días y los esqueletos viejos, y sube purged_seq', async () => {
    const { h } = await scenario();
    const [{ seq: before } = { seq: 0 }] = h.db.rows<{ seq: number }>('SELECT seq FROM agenda');
    const [{ top } = { top: 0 }] = h.db.rows<{ top: number }>(
      "SELECT MAX(seq) AS top FROM op WHERE entry_id IN ('steam:1', 'steam:5')",
    );
    await runMaintenance(h.db, MONDAY);
    expect(entryIds(h)).toEqual(['steam:2', 'steam:3', 'steam:4', 'steam:6']);
    expect(h.db.rows('SELECT seq, purged_seq FROM agenda')).toEqual([
      { seq: before + 1, purged_seq: top },
    ]);
  });

  it('fuera de los lunes no purga nada', async () => {
    const { h } = await scenario();
    await runMaintenance(h.db, TUESDAY);
    expect(entryIds(h)).toHaveLength(6);
    expect(h.db.rows('SELECT purged_seq FROM agenda')).toEqual([{ purged_seq: 0 }]);
  });

  it('una app que no vio la purga recibe reset; la que ya estaba al día, no', async () => {
    const { h, a } = await scenario();
    const [{ seq: synced } = { seq: 0 }] = h.db.rows<{ seq: number }>('SELECT seq FROM agenda');
    expect(a.cursor).toBe(synced);
    await runMaintenance(h.db, MONDAY);
    // La réplica estaba al día: ya tiene las lápidas y no le hace falta reset.
    const upToDate = await sync(a.client, [], a.cursor, a.purgedSeq);
    expect(upToDate.json.reset).toBe(false);
    // Una copia que se quedó en la primera página no vio la lápida de steam:1.
    const behind = await sync(a.client, [], 2, 0);
    expect(behind.json.reset).toBe(true);
    expect(behind.json.changes.map((c) => c.entryId)).not.toContain('steam:1');
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
