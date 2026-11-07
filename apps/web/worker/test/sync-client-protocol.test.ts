// El protocolo de la sincronización de punta a punta (§7.4 y §7.7; ADR-011), con las réplicas de
// la app contra la micro-API en proceso y el mantenimiento de D1 de verdad: los `reset` sin
// estados a medias, la purga que solo hace D1, el D1 vuelto atrás (también con la época), el motor
// que no escribe tras borrar los datos, lo que sube al unirse a una agenda y el reloj. Cada caso
// es la reproducción de un hallazgo de la revisión del 07-11-2026.

import { isLive } from '@gameagenda/core/entries';
import { afterEach, describe, expect, it } from 'vitest';
import { META_KEYS } from '../../src/db/database.ts';
import { parseSyncCursor } from '../../src/sync/state.ts';
import { runMaintenance } from '../maintenance.ts';
import { createHarness, type Harness } from './harness.ts';
import { Replica, type ReplicaOptions } from './sync-client-support.ts';
import { agendaOf, serverEntries } from './sync-support.ts';

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Lunes 09-11-2026 a las 03:17 UTC, cuando corre el Cron Trigger. */
const MONDAY = Date.UTC(2026, 10, 9, 3, 17);
const MANUAL = 'manual:0190b6e2-7f3a-7c4e-9d2a-1b2c3d4e5f60';
const open: Replica[] = [];

async function replica(h: Harness, options: ReplicaOptions = {}): Promise<Replica> {
  const r = await Replica.open(h, options);
  open.push(r);
  return r;
}

afterEach(async () => {
  for (const r of open.splice(0)) {
    expect(r.errors).toEqual([]);
    await r.closeTab();
  }
});

/** Dos réplicas emparejadas en una agenda nueva. */
async function pairOf(h: Harness, options: ReplicaOptions = {}, optionsB = options) {
  const a = await replica(h, options);
  const b = await replica(h, optionsB);
  const recovery = await a.activate();
  await a.pair(b);
  return { a, b, recovery };
}

function agendaIdOf(h: Harness, r: Replica): string {
  const deviceId = r.sync.getSnapshot().deviceId;
  if (deviceId === null) throw new Error('sin deviceId');
  return agendaOf(h.db, deviceId);
}

/** Todas iguales entre sí, con D1 y con lo que pinta cada agenda. */
async function expectConverged(h: Harness, ...replicas: Replica[]): Promise<void> {
  const [first] = replicas;
  if (first === undefined) throw new Error('sin réplicas');
  const reference = await first.stored();
  expect(serverEntries(h.db, agendaIdOf(h, first))).toEqual(reference);
  for (const r of replicas) {
    expect(await r.stored()).toEqual(reference);
    if (r.agendaOrNull !== null) expect(r.memory()).toEqual(reference);
    expect(await r.outboxSize()).toBe(0);
  }
}

function serverSeq(h: Harness): number {
  const [row] = h.db.rows<{ seq: number }>('SELECT seq FROM agenda');
  if (row === undefined) throw new Error('sin agenda');
  return row.seq;
}

async function cursorOf(r: Replica) {
  return parseSyncCursor((await r.db.meta.get(META_KEYS.syncCursor))?.value);
}

/** Sincroniza hasta tenerlo todo (con un tope de peticiones bajo hacen falta varias rondas). */
async function catchUp(h: Harness, r: Replica): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await r.syncNow();
    const cursor = await cursorOf(r);
    const done = cursor !== null && !cursor.reset && cursor.cursor === serverSeq(h);
    if (done && (await r.outboxSize()) === 0) return;
  }
  throw new Error('catchUp: no se pone al día');
}

/** Lo de `id` en D1, reconstruido. */
function onServer(h: Harness, r: Replica, id: string) {
  return serverEntries(h.db, agendaIdOf(h, r)).find((e) => e.id === id);
}

/** Espera a que la respuesta retenida de `/sync` (`holdNextSync`) ya esté en camino. */
async function untilHeld(r: Replica): Promise<void> {
  while (r.holdNextSync !== null) await new Promise((resolve) => setImmediate(resolve));
}

describe('reset sin estados a medias (protocolo#0 y rendimiento-pruebas#1)', () => {
  it('un reset cortado con páginas pequeñas no oculta ni recorta ninguna entrada viva', async () => {
    const h = createHarness({}, { pageSize: 5 });
    h.clock.ms = MONDAY - 100 * DAY;
    const { a, b } = await pairOf(h);
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    a.agenda.update('steam:1', { note: 'Nota importante' });
    a.agenda.capture({ id: 'steam:2', title: 'Dos' });
    await a.syncNow();
    await b.syncNow();
    const before = await b.stored();
    h.clock.ms += MINUTE;
    a.agenda.remove('steam:2');
    await a.syncNow();
    h.clock.ms = MONDAY;
    await runMaintenance(h.db, MONDAY);

    // La primera página del reset llega; la segunda se pierde por la red.
    b.faults.push('pass', 'network');
    await b.syncNow();
    expect(b.sync.getSnapshot()).toMatchObject({ activity: 'error', error: 'network' });
    expect(await cursorOf(b)).toMatchObject({ reset: true, cursor: 0 });
    // Ni en Dexie ni en memoria cambia nada: steam:1 sigue entera y a la vista.
    expect(await b.stored()).toEqual(before);
    expect(b.memory()).toEqual(before);
    expect(b.agenda.getSnapshot().map((e) => e.id)).toEqual(['steam:1', 'steam:2']);
    // Volver a apuntarla no es posible (ni pisaría la nota): ya está en la lista.
    expect(b.agenda.capture({ id: 'steam:1', title: 'Uno' }).effect.kind).toBe('alreadyInList');

    // La ronda siguiente hace el reset entero y, al acabar, quita lo purgado.
    await b.syncNow();
    expect(b.get('steam:1')).toMatchObject({ title: 'Uno', note: 'Nota importante' });
    expect(b.get('steam:2')).toBeUndefined();
    await a.syncNow();
    await expectConverged(h, a, b);
  });

  it('un reset de más páginas que el tope de peticiones acaba en una sola ronda', async () => {
    const h = createHarness({}, { pageSize: 2 });
    h.clock.ms = MONDAY - 100 * DAY;
    const a = await replica(h);
    const b = await replica(h, { maxRequests: 3 });
    await a.activate();
    for (let i = 1; i <= 3; i++) a.agenda.capture({ id: `steam:${i}`, title: `Juego ${i}` });
    await a.syncNow();
    await a.pair(b);
    await catchUp(h, b);
    h.clock.ms += MINUTE;
    a.agenda.remove('steam:3');
    await a.syncNow();
    h.clock.ms = MONDAY;
    await runMaintenance(h.db, MONDAY);

    b.requests.length = 0;
    await b.syncNow();
    // 30 filas en páginas de 2: 15 peticiones con un tope de 3, en una ronda.
    expect(b.requests).toHaveLength(15);
    expect(b.requests.every((r) => r.ops === 0)).toBe(true);
    expect(await cursorOf(b)).toMatchObject({ reset: false, cursor: serverSeq(h) });
    expect(b.get('steam:3')).toBeUndefined();
    await catchUp(h, a);
    await expectConverged(h, a, b);
  });
});

describe('solo purga D1 (protocolo#1)', () => {
  /** A apunta steam:5; B, sin red, lo apunta después (antes que el borrado); A lo quita. */
  async function base(h: Harness) {
    h.clock.ms = MONDAY - 95 * DAY;
    const { a, b } = await pairOf(h);
    b.setOffline(true);
    a.agenda.capture({ id: 'steam:5', title: 'Cinco' });
    await a.syncNow();
    h.clock.ms += MINUTE;
    b.agenda.capture({ id: 'steam:5', title: 'Cinco' }, { status: 'playing' });
    h.clock.ms += MINUTE;
    a.agenda.remove('steam:5');
    await a.syncNow();
    return { a, b };
  }

  it('A sincroniza pasados 90 días y antes del lunes: no purga, y el alta vieja de B no la deja distinta', async () => {
    const h = createHarness();
    const { a, b } = await base(h);
    // Antes, aquí A purgaba en local su lápida…
    h.clock.ms = MONDAY - 2 * DAY;
    await a.syncNow();
    expect(isLive(a.get('steam:5'))).toBe(false);
    // …y el alta de B, anterior al borrado, la resucitaba solo en A.
    b.setOffline(false);
    await b.settle();
    await a.syncNow();
    expect(isLive(onServer(h, a, 'steam:5'))).toBe(false);
    for (const r of [a, b]) expect(isLive(r.get('steam:5'))).toBe(false);
    await expectConverged(h, a, b);

    // El lunes D1 la purga, y las dos réplicas la quitan con el reset.
    h.clock.ms = MONDAY;
    await runMaintenance(h.db, MONDAY);
    await a.syncNow();
    await b.syncNow();
    for (const r of [a, b]) expect(r.get('steam:5')).toBeUndefined();
    expect(onServer(h, a, 'steam:5')).toBeUndefined();
    await expectConverged(h, a, b);
  });

  it('A no se abre hasta después de la purga: también recibe reset y queda igual que D1', async () => {
    const h = createHarness();
    const { a, b } = await base(h);
    h.clock.ms = MONDAY;
    await runMaintenance(h.db, MONDAY);
    // B vuelve: reset, y su alta (pendiente) sube: en el servidor queda a la vista.
    b.setOffline(false);
    await b.settle();
    expect(isLive(onServer(h, a, 'steam:5'))).toBe(true);
    // Antes A no recibía reset (su cursor ya cubría la purga) y su lápida tapaba el alta de B.
    await a.syncNow();
    for (const r of [a, b]) {
      expect(r.get('steam:5')).toMatchObject({ status: 'playing', deletedAt: null });
    }
    await expectConverged(h, a, b);
  });
});

describe('D1 vuelto atrás (protocolo#2)', () => {
  it('tras un restore, un lote con operaciones no tapa que el cursor va por delante', async () => {
    const h = createHarness();
    const a = await replica(h);
    await a.activate();
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    await a.syncNow();
    const restorePoint = serverSeq(h);
    h.clock.ms += 1000;
    a.agenda.capture({ id: 'steam:2', title: 'Dos' });
    await a.syncNow();
    const cursor = serverSeq(h);
    // Time Travel, sin cambiar la época (el runbook no se ha seguido).
    h.db.rows('DELETE FROM op WHERE seq > ?', restorePoint);
    h.db.rows('UPDATE agenda SET seq = ?', restorePoint);
    h.clock.ms += 1000;
    a.agenda.capture({ id: 'steam:3', title: 'Tres' });
    a.agenda.capture({ id: 'steam:4', title: 'Cuatro' });
    await a.settle();
    const pending = await a.outboxSize();
    a.requests.length = 0;
    await a.syncNow();
    // La primera petición lleva el lote y un cursor por delante: el servidor no lo escribe.
    expect(a.requests[0]).toEqual({ cursor, purgedSeq: 0, ops: pending });
    expect(serverEntries(h.db).map((e) => e.id)).toEqual([
      'steam:1',
      'steam:2',
      'steam:3',
      'steam:4',
    ]);
    await expectConverged(h, a);
  });

  it('con varios dispositivos, la época nueva hace que cada uno lo vuelva a subir todo', async () => {
    const h = createHarness();
    const { a, b } = await pairOf(h);
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    await a.syncNow();
    await b.syncNow();
    const restorePoint = serverSeq(h);
    h.clock.ms += 1000;
    a.agenda.capture({ id: 'steam:2', title: 'Solo en A' });
    await a.syncNow();
    const cursorA = serverSeq(h);
    // Time Travel y el runbook: la época cambia.
    h.db.rows('DELETE FROM op WHERE seq > ?', restorePoint);
    h.db.rows('UPDATE agenda SET seq = ?', restorePoint);
    h.db.rows('UPDATE agenda SET epoch = lower(hex(randomblob(8)))');
    // B se entera primero y lo sube todo, con lo nuevo: la seq pasa el cursor de A.
    h.clock.ms += 1000;
    for (let i = 3; i <= 5; i++) b.agenda.capture({ id: `steam:${i}`, title: `Juego ${i}` });
    await b.syncNow();
    expect(serverSeq(h)).toBeGreaterThan(cursorA);
    // Sin la época, A se saltaría las filas por debajo de su cursor y no volvería a subir steam:2.
    await a.syncNow();
    expect(serverEntries(h.db).map((e) => e.id)).toEqual([
      'steam:1',
      'steam:2',
      'steam:3',
      'steam:4',
      'steam:5',
    ]);
    await b.syncNow();
    await expectConverged(h, a, b);
  });
});

describe('sin meta.syncState el motor no escribe (seguridad-privacidad#5 y ciclo-de-vida#0)', () => {
  it('«Borrar todos mis datos» con una respuesta de /sync en camino en otra pestaña: no vuelve nada', async () => {
    const h = createHarness();
    // Sin Web Locks (con ellos, el borrado espera a que acabe la ronda: ver
    // `sync-client-lifecycle.test.ts`): aquí lo que lo para es el motor.
    const a = await replica(h);
    const tab = await replica(h, { sameBrowserAs: a });
    const phone = await replica(h);
    await a.activate();
    await Promise.all([a.drain(), tab.drain()]);
    await a.pair(phone);
    phone.agenda.capture({ id: 'steam:42', title: 'Del móvil' });
    await phone.syncNow();

    // La otra pestaña pide /sync, y la respuesta, que trae steam:42, tarda.
    let release = () => {};
    tab.holdNextSync = new Promise<void>((resolve) => {
      release = resolve;
    });
    const round = tab.sync.syncNow();
    await untilHeld(tab);
    await a.sync.deleteServerAgenda();
    await a.agenda.deleteAll();
    release();
    await round;
    await tab.drain();
    await a.settle();
    expect(await a.db.entries.count()).toBe(0);
    expect(await a.db.outbox.count()).toBe(0);
    const meta = (await a.db.meta.toCollection().primaryKeys()) as string[];
    expect(meta).not.toContain(META_KEYS.syncCursor);
    expect(meta).not.toContain(META_KEYS.hlcClock);
    expect(tab.get('steam:42')).toBeUndefined();
    expect(a.get('steam:42')).toBeUndefined();
  });
});

describe('unirse a una agenda (seguridad-privacidad#3)', () => {
  it('activar no sube el contenido de una lápida de más de 90 días', async () => {
    const h = createHarness();
    const a = await replica(h);
    a.agenda.capture({ id: 'steam:7', title: 'Siete' });
    a.agenda.update('steam:7', { note: 'nota privada' });
    a.agenda.remove('steam:7');
    a.agenda.capture({ id: 'steam:8', title: 'Ocho' });
    await a.settle();
    h.clock.ms += 120 * DAY;
    await a.activate();
    await a.syncNow();
    expect(h.db.rows("SELECT field FROM op WHERE entry_id = 'steam:7'")).toEqual([
      { field: 'deletedAt' },
    ]);
    expect(JSON.stringify(h.db.rows('SELECT value FROM op'))).not.toContain('nota privada');
    expect(isLive(a.get('steam:7'))).toBe(false);
    expect(a.get('steam:8')?.title).toBe('Ocho');
    await expectConverged(h, a);
  });

  it('una lápida de vinculación de más de 90 días sigue reenviando lo que otro dispositivo tiene en el manual', async () => {
    const h = createHarness();
    const { a, b, recovery } = await pairOf(h);
    a.agenda.capture({ id: MANUAL, title: 'Hades' });
    await a.syncNow();
    await b.syncNow();
    // A deja de sincronizar y vincula el manual con la entrada de Steam.
    const me = a.sync.getSnapshot().deviceId ?? '';
    expect(await a.sync.revokeDevice(me)).toEqual({ self: true });
    h.clock.ms += MINUTE;
    a.agenda.link(MANUAL, { id: 'steam:1145350', title: 'Hades' });
    await a.settle();
    // 120 días después, B (que sigue con el manual a la vista) lo anota.
    h.clock.ms += 120 * DAY;
    b.agenda.update(MANUAL, { note: 'De B' });
    await b.syncNow();
    // A vuelve con el código de recuperación: su lápida sube sin contenido, pero con mergedInto.
    await a.sync.redeemRecoveryCode({ code: recovery, label: 'Chrome en Windows' });
    await a.settle();
    await a.syncNow();
    await b.syncNow();
    expect(onServer(h, b, 'steam:1145350')?.note).toBe('De B');
    for (const r of [a, b]) {
      expect(r.get('steam:1145350')?.note).toBe('De B');
      expect(isLive(r.get(MANUAL))).toBe(false);
    }
    await expectConverged(h, a, b);
  });
});

describe('el reloj (protocolo#3 y protocolo#4)', () => {
  it('meta.hlcClock guarda el reloj de cuando se escribe, no el de la acción', async () => {
    const h = createHarness();
    const a = await replica(h);
    await a.activate();
    let hold: Promise<void> | null = null;
    const b = await replica(h, {
      skewMs: 6 * MINUTE,
      afterPaint: () => hold ?? Promise.resolve(),
    });
    let release = () => {};
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    // La acción, con el desfase 0; su guardado espera.
    b.agenda.capture({ id: 'steam:1', title: 'Uno' });
    // Mientras, B se empareja y su primera ronda corrige el desfase.
    const { code } = await a.sync.createPairingCode();
    await b.sync.redeemPairingCode({ code, label: 'Safari en iPhone' });
    await b.sync.whenIdle();
    expect(b.clock.offset).toBe(-6 * MINUTE);
    hold = null;
    release();
    await b.agenda.whenIdle();
    expect((await b.db.meta.get(META_KEYS.hlcClock))?.value).toMatchObject({
      offset: -6 * MINUTE,
    });
    await b.syncNow();
    await a.syncNow();
    await expectConverged(h, a, b);
  });

  it('tras bajar el reloj a mitad de ronda, refrescar el catálogo no falla', async () => {
    const h = createHarness({}, { pageSize: 5 });
    const a = await replica(h);
    await a.activate();
    for (let i = 1; i <= 3; i++) a.agenda.capture({ id: `steam:${i}`, title: `Juego ${i}` });
    await a.syncNow();
    // B va 6 min adelantado: apunta steam:10 y, 3 min después, steam:11.
    const b = await replica(h, { skewMs: 6 * MINUTE });
    b.agenda.capture({ id: 'steam:10', title: 'Diez' });
    h.clock.ms += 3 * MINUTE;
    b.agenda.capture({ id: 'steam:11', title: 'Once' });
    await b.settle();
    // Se empareja: la primera respuesta baja el reloj y la segunda petición falla por red.
    b.faults.push('pass', 'network');
    const { code } = await a.sync.createPairingCode();
    await b.sync.redeemPairingCode({ code, label: 'Safari en iPhone' });
    await b.settle();
    expect(b.sync.getSnapshot()).toMatchObject({ activity: 'error', error: 'network' });
    expect(b.clock.offset).toBe(-6 * MINUTE);
    // steam:10 (3 min por delante) se aceptó, pero sus filas aún no han bajado.
    expect(() =>
      b.agenda.refreshFromCatalog([{ id: 'steam:10', title: 'Diez (nuevo)' }]),
    ).not.toThrow();
    expect(b.get('steam:10')?.title).toBe('Diez (nuevo)');
    await b.syncNow();
    await a.syncNow();
    await expectConverged(h, a, b);
  });
});
