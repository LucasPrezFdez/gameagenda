// El cliente de la sincronización de la SPA (`src/sync/`) contra la micro-API en proceso (M4;
// §5.3 y §7.7; CA4.2 y CA4.3): réplicas con su IndexedDB, su agenda y sus cookies sobre la misma
// D1. Lo que CA4.2 pide con dos navegadores se prueba aquí con dos réplicas; el E2E lo repetirá.

import { isLive } from '@gameagenda/core/entries';
import { hlcTime, MAX_DRIFT_MS } from '@gameagenda/core/sync';
import { afterEach, describe, expect, it } from 'vitest';
import { createCopyReminderStore } from '../../src/data/copy-reminder.ts';
import { createNoticeCenter } from '../../src/notices/notice-center.ts';
import { runMaintenance } from '../maintenance.ts';
import { createHarness, type Harness, T0 } from './harness.ts';
import { FakeLocks, Replica, type ReplicaOptions } from './sync-client-support.ts';
import { agendaOf, serverEntries } from './sync-support.ts';

const MINUTE = 60_000;
const DAY = 86_400_000;
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

describe('activar y emparejar', () => {
  it('lo apuntado en una réplica llega a la otra, y eso cuenta como copia (RNF-08)', async () => {
    const h = createHarness();
    const copyReminder = createCopyReminderStore({
      lastCopy: null,
      since: T0 - 40 * DAY,
      snoozedUntil: null,
    });
    const { a, b } = await pairOf(h, { copyReminder }, {});
    expect(a.sync.getSnapshot()).toMatchObject({ status: 'paired', activity: 'idle', pending: 0 });
    a.agenda.capture({ id: 'steam:730', title: 'Counter-Strike 2' });
    await a.syncNow();
    await b.syncNow();
    expect(b.get('steam:730')?.title).toBe('Counter-Strike 2');
    await expectConverged(h, a, b);
    expect(a.sync.getSnapshot().lastSyncAt).toBe(T0);
    expect(copyReminder.getSnapshot()?.lastCopy).toBe(T0);
  });

  it('activar con entradas previas las sube, y emparejar con las suyas las fusiona', async () => {
    const h = createHarness();
    const a = await replica(h);
    const b = await replica(h);
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    a.agenda.capture({ id: 'steam:2', title: 'Dos' });
    h.clock.ms += 1000;
    b.agenda.capture({ id: 'steam:2', title: 'Dos' }, { status: 'playing' });
    b.agenda.capture({ id: 'steam:3', title: 'Tres' });
    b.agenda.capture({ id: 'steam:4', title: 'Cuatro' });
    b.agenda.remove('steam:4');
    await a.settle();
    await b.settle();
    expect(a.sync.getSnapshot().status).toBe('off');
    await a.activate();
    expect(a.sync.getSnapshot()).toMatchObject({ status: 'paired', pending: 0 });
    await a.pair(b);
    await a.syncNow();
    const visible = a.agenda.getSnapshot().map((e) => [e.id, e.status]);
    expect(visible.sort()).toEqual([
      ['steam:1', 'want_to_play'],
      ['steam:2', 'playing'],
      ['steam:3', 'want_to_play'],
    ]);
    // La lápida también se sube: steam:4 sigue borrado en las dos.
    expect(a.get('steam:4')?.deletedAt).not.toBeNull();
    await expectConverged(h, a, b);
  });

  it('quien no sincroniza no hace ninguna petición', async () => {
    const h = createHarness();
    const a = await replica(h);
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    await a.syncNow();
    a.env.window.dispatchEvent(new Event('focus'));
    a.env.goOnline();
    a.env.setVisible(false);
    a.env.setVisible(true);
    await a.settle();
    expect(a.syncCalls).toBe(0);
    expect(a.client.cookies.size).toBe(0);
    expect(a.sync.getSnapshot()).toMatchObject({ ready: true, status: 'off', pending: 0 });
  });
});

describe('CA4.2: dos dispositivos sin red', () => {
  it('lo apuntado sin red se sube al volver la red', async () => {
    const h = createHarness();
    const { a, b } = await pairOf(h);
    const calls = a.syncCalls;
    a.setOffline(true);
    a.agenda.capture({ id: 'steam:620', title: 'Portal 2' });
    await a.syncNow();
    expect(a.syncCalls).toBe(calls);
    expect(a.sync.getSnapshot()).toMatchObject({ activity: 'offline', pending: 1 });
    // `online` dispara la sincronización sola.
    a.setOffline(false);
    await a.settle();
    expect(a.sync.getSnapshot()).toMatchObject({ activity: 'idle', error: null, pending: 0 });
    await b.syncNow();
    expect(b.get('steam:620')?.title).toBe('Portal 2');
    await expectConverged(h, a, b);
  });

  it('las ediciones de campos distintos del mismo juego sobreviven', async () => {
    const h = createHarness();
    const { a, b } = await pairOf(h);
    a.agenda.capture({ id: 'steam:1145350', title: 'Hades II' });
    await a.syncNow();
    await b.syncNow();
    a.setOffline(true);
    b.setOffline(true);
    h.clock.ms += 1000;
    a.agenda.setStatus('steam:1145350', 'playing');
    h.clock.ms += 1000;
    b.agenda.setFlag('steam:1145350', 'owned', true);
    b.agenda.update('steam:1145350', { note: 'En oferta' });
    a.setOffline(false);
    await a.settle();
    b.setOffline(false);
    await b.settle();
    await a.syncNow();
    for (const r of [a, b]) {
      expect(r.get('steam:1145350')).toMatchObject({
        status: 'playing',
        flags: { owned: true },
        note: 'En oferta',
      });
    }
    await expectConverged(h, a, b);
  });

  it('en el mismo campo gana la HLC más reciente, sincronicen en el orden que sea', async () => {
    const h = createHarness();
    const { a, b } = await pairOf(h);
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    await a.syncNow();
    await b.syncNow();
    a.setOffline(true);
    b.setOffline(true);
    a.agenda.update('steam:1', { note: 'De A, antes' });
    b.agenda.update('steam:1', { platform: 'pc' });
    h.clock.ms += 1000;
    b.agenda.update('steam:1', { note: 'De B, después' });
    a.agenda.update('steam:1', { platform: 'ps5' });
    // B sube primero: su nota gana igual; la plataforma, la de A (más reciente).
    b.setOffline(false);
    await b.settle();
    a.setOffline(false);
    await a.settle();
    await b.syncNow();
    for (const r of [a, b]) {
      expect(r.get('steam:1')).toMatchObject({ note: 'De B, después', platform: 'ps5' });
    }
    await expectConverged(h, a, b);
  });

  it('el mismo juego apuntado en los dos queda en una sola entrada', async () => {
    const h = createHarness();
    const { a, b } = await pairOf(h);
    a.setOffline(true);
    b.setOffline(true);
    a.agenda.capture({ id: 'steam:730', title: 'Counter-Strike 2' });
    h.clock.ms += 1000;
    b.agenda.capture({ id: 'steam:730', title: 'Counter-Strike 2' }, { status: 'playing' });
    a.setOffline(false);
    await a.settle();
    b.setOffline(false);
    await b.settle();
    await a.syncNow();
    for (const r of [a, b]) {
      expect(r.agenda.getSnapshot().filter((e) => e.id === 'steam:730')).toHaveLength(1);
      expect(r.get('steam:730')?.status).toBe('playing');
    }
    await expectConverged(h, a, b);
  });
});

describe('cambios que se cruzan con la agenda', () => {
  it('una escritura pendiente de la agenda y un cambio remoto de la misma entrada se fusionan', async () => {
    const h = createHarness();
    let hold: Promise<void> | null = null;
    const { a, b } = await pairOf(h, { afterPaint: () => hold ?? Promise.resolve() }, {});
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    await a.syncNow();
    await b.syncNow();
    h.clock.ms += 1000;
    b.agenda.update('steam:1', { note: 'Desde el móvil' });
    await b.syncNow();

    // A cambia el estado: se pinta al instante, pero el guardado espera.
    let release = () => {};
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.clock.ms += 1000;
    a.agenda.setStatus('steam:1', 'playing');
    // Mientras, llega la nota de B y se guarda.
    await a.sync.syncNow();
    await a.sync.whenIdle();
    expect((await a.db.entries.get('steam:1'))?.note).toBe('Desde el móvil');
    expect(a.get('steam:1')?.status).toBe('playing');
    hold = null;
    release();
    await a.settle();
    expect(a.get('steam:1')).toMatchObject({ status: 'playing', note: 'Desde el móvil' });
    await a.syncNow();
    await b.syncNow();
    await expectConverged(h, a, b);
  });

  it('dos pestañas del mismo navegador: se enteran del emparejamiento y no sincronizan a la vez', async () => {
    const h = createHarness();
    const locks = new FakeLocks();
    const a = await replica(h, { locks });
    const tab = await replica(h, { locks, sameBrowserAs: a });
    expect(tab.sync.getSnapshot()).toMatchObject({ status: 'off' });
    await a.activate();
    // La otra pestaña se entera por `meta.syncState` y carga su motor.
    await Promise.all([a.drain(), tab.drain()]);
    expect(tab.sync.getSnapshot()).toMatchObject({ status: 'paired' });

    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    await Promise.all([a.drain(), tab.drain()]);
    const callsA = a.syncCalls;
    const callsTab = tab.syncCalls;
    const fromA = a.sync.syncNow();
    const fromTab = tab.sync.syncNow();
    await fromA;
    await a.sync.whenIdle();
    // La pestaña sin candado espera para reintentar una vez: puede que la otra leyera la outbox
    // antes de su escritura.
    expect(tab.env.timers.map((t) => t.ms)).toEqual([1500]);
    expect(tab.syncCalls).toBe(callsTab);
    tab.env.runTimers();
    await fromTab;
    await tab.drain();
    expect(a.syncCalls - callsA).toBe(1);
    expect(tab.requests.at(-1)).toMatchObject({ ops: 0 });
    expect(await a.outboxSize()).toBe(0);
    expect(tab.get('steam:1')?.title).toBe('Uno');
  });
});

describe('§7.7: cursor, purga y D1 vuelto atrás', () => {
  /** Lunes 09-11-2026 a las 03:17 UTC, cuando corre el Cron Trigger. */
  const MONDAY = Date.UTC(2026, 10, 9, 3, 17);

  it('tras la purga de un lunes, la réplica atrasada recibe reset y no resucita lo purgado', async () => {
    const h = createHarness();
    h.clock.ms = MONDAY - 100 * DAY;
    const { a, b } = await pairOf(h);
    a.agenda.capture({ id: 'steam:1', title: 'Se queda' });
    a.agenda.capture({ id: 'steam:2', title: 'Borrado hace 100 días' });
    await a.syncNow();
    await b.syncNow();
    expect(isLive(b.get('steam:2'))).toBe(true);
    b.setOffline(true);
    h.clock.ms += MINUTE;
    a.agenda.remove('steam:2');
    await a.syncNow();
    // B, sin red, cambia otra entrada: lo pendiente se sube y se conserva.
    b.agenda.update('steam:1', { note: 'Sin red' });

    h.clock.ms = MONDAY;
    await runMaintenance(h.db, MONDAY);
    expect(serverEntries(h.db, agendaIdOf(h, a)).map((e) => e.id)).toEqual(['steam:1']);
    b.setOffline(false);
    await b.settle();
    expect(b.get('steam:2')).toBeUndefined();
    expect(b.get('steam:1')?.note).toBe('Sin red');
    // A purga en local su lápida, con el mismo criterio que el servidor.
    await a.syncNow();
    expect(a.get('steam:2')).toBeUndefined();
    await expectConverged(h, a, b);
  });

  it('en un reset, lo que estaba pendiente de una entrada purgada queda como lo tendrá el servidor', async () => {
    const h = createHarness();
    h.clock.ms = MONDAY - 100 * DAY;
    const { a, b } = await pairOf(h);
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    a.agenda.capture({ id: 'steam:2', title: 'Dos' });
    await a.syncNow();
    await b.syncNow();
    b.setOffline(true);
    h.clock.ms += MINUTE;
    a.agenda.remove('steam:2');
    await a.syncNow();
    // B, sin red casi 100 días, edita la que A ha borrado.
    h.clock.ms = MONDAY - DAY;
    b.agenda.update('steam:2', { note: 'Editada sin red' });
    h.clock.ms = MONDAY;
    await runMaintenance(h.db, MONDAY);
    b.setOffline(false);
    await b.settle();
    // En el servidor solo queda la nota: un esqueleto, invisible. En B, igual: no resucita.
    const server = serverEntries(h.db, agendaIdOf(h, a)).find((e) => e.id === 'steam:2');
    expect(server?.hlc).toEqual({ note: expect.any(String) });
    expect(await b.db.entries.get('steam:2')).toEqual(server);
    expect(b.agenda.getSnapshot().map((e) => e.id)).toEqual(['steam:1']);
    await a.syncNow();
    expect(a.agenda.getSnapshot().map((e) => e.id)).toEqual(['steam:1']);
  });

  it('una ronda de reset interrumpida vuelve a empezar desde 0', async () => {
    const h = createHarness({}, { pageSize: 2 });
    h.clock.ms = MONDAY - 100 * DAY;
    const { a, b } = await pairOf(h);
    for (let i = 1; i <= 3; i++) a.agenda.capture({ id: `steam:${i}`, title: `Juego ${i}` });
    await a.syncNow();
    await b.syncNow();
    h.clock.ms += MINUTE;
    a.agenda.remove('steam:3');
    await a.syncNow();
    h.clock.ms = MONDAY;
    await runMaintenance(h.db, MONDAY);
    // La primera página (con reset) llega; la segunda se pierde por la red.
    b.faults.push('pass', 'network');
    await b.syncNow();
    expect(b.sync.getSnapshot()).toMatchObject({ activity: 'error', error: 'network' });
    expect((await b.db.meta.get('syncCursor'))?.value).toMatchObject({ reset: true, cursor: 0 });
    expect(b.get('steam:3')?.title).toBe('Juego 3');
    // La ronda siguiente vuelve a bajar desde 0 y, al acabar, borra lo purgado.
    b.requests.length = 0;
    await b.syncNow();
    expect(b.requests[0]).toMatchObject({ cursor: 0 });
    expect(b.requests.length).toBeGreaterThan(2);
    expect(b.get('steam:3')).toBeUndefined();
    expect((await b.db.meta.get('syncCursor'))?.value).toMatchObject({ reset: false });
    await a.syncNow();
    await expectConverged(h, a, b);
  });

  it('con el cursor por delante del servidor (D1 vuelto atrás), vuelve a subirlo todo', async () => {
    const h = createHarness();
    const { a, b } = await pairOf(h);
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    await a.syncNow();
    const [{ seq: before } = { seq: 0 }] = h.db.rows<{ seq: number }>('SELECT seq FROM agenda');
    h.clock.ms += 1000;
    a.agenda.capture({ id: 'steam:2', title: 'Dos' });
    a.agenda.setFlag('steam:1', 'owned', true);
    await a.syncNow();
    await b.syncNow();
    // Time Travel: D1 vuelve a como estaba antes de lo segundo.
    h.db.rows('DELETE FROM op WHERE seq > ?', before);
    h.db.rows('UPDATE agenda SET seq = ?', before);
    expect(serverEntries(h.db).map((e) => e.id)).toEqual(['steam:1']);
    await a.syncNow();
    expect(serverEntries(h.db).map((e) => e.id)).toEqual(['steam:1', 'steam:2']);
    await b.syncNow();
    await expectConverged(h, a, b);
  });
});

describe('§7.4: el reloj', () => {
  it('con el reloj 10 min adelantado, lo rechazado por reloj se vuelve a sellar y converge', async () => {
    const h = createHarness();
    const a = await replica(h);
    await a.activate();
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    await a.syncNow();
    // B va 10 min adelantado y, antes de emparejarse, apunta y anota sin red.
    const b = await replica(h, { skewMs: 10 * MINUTE });
    b.agenda.capture({ id: 'steam:1', title: 'Uno' });
    b.agenda.update('steam:1', { note: 'De B' });
    b.agenda.capture({ id: 'steam:2', title: 'Dos' });
    await b.settle();
    expect(hlcTime(b.get('steam:2')?.lastHlc ?? '')).toBe(T0 + 10 * MINUTE);
    h.clock.ms = T0 + 3 * MINUTE;
    a.agenda.update('steam:1', { note: 'De A' });
    await a.syncNow();
    // Al emparejarse, el servidor rechaza sus HLC (más de 5 min por delante): B corrige su
    // desfase, las vuelve a sellar por delante de lo que ha visto y las sube.
    await a.pair(b);
    expect(b.clock.offset).toBe(-10 * MINUTE);
    for (const e of await b.stored()) {
      expect(hlcTime(e.lastHlc)).toBeLessThanOrEqual(h.clock.ms + MAX_DRIFT_MS);
    }
    expect(b.get('steam:1')?.note).toBe('De B');
    await a.syncNow();
    expect(a.get('steam:1')?.note).toBe('De B');
    // A escribe después (en hora real) la misma nota: gana en el servidor y en B, que ya no tiene
    // la HLC futura.
    h.clock.ms = T0 + 4 * MINUTE;
    a.agenda.update('steam:1', { note: 'De A, después' });
    await a.syncNow();
    await b.syncNow();
    expect(b.get('steam:1')?.note).toBe('De A, después');
    // Lo siguiente de B ya sale en hora: no lo rechaza nadie.
    b.agenda.setStatus('steam:2', 'playing');
    await b.syncNow();
    await a.syncNow();
    expect(a.get('steam:2')?.status).toBe('playing');
    await expectConverged(h, a, b);
  });
});

describe('errores', () => {
  it('un 401 deja el dispositivo desemparejado por el servidor, sin tocar la agenda', async () => {
    const h = createHarness();
    const { a, b, recovery } = await pairOf(h);
    const devices = await a.sync.listDevices();
    const phone = devices.find((d) => !d.current);
    expect(phone).toBeDefined();
    expect(await a.sync.revokeDevice(phone?.id ?? '')).toEqual({ self: false });
    b.agenda.capture({ id: 'steam:9', title: 'Pendiente' });
    await b.settle();
    const pending = await b.outboxSize();
    await b.syncNow();
    expect(b.sync.getSnapshot()).toMatchObject({ status: 'unpaired', unpairedReason: 'server' });
    expect(await b.outboxSize()).toBe(pending);
    expect(b.get('steam:9')?.title).toBe('Pendiente');
    expect(b.client.cookies.size).toBe(0);
    // Tras recargar, sigue igual; con el código de recuperación vuelve y sube lo pendiente.
    await b.reload();
    expect(b.sync.getSnapshot()).toMatchObject({ status: 'unpaired', unpairedReason: 'server' });
    await b.sync.redeemRecoveryCode({ code: recovery.toLowerCase(), label: 'Safari en iPhone' });
    await b.settle();
    expect(b.sync.getSnapshot()).toMatchObject({ status: 'paired', pending: 0 });
    await a.syncNow();
    expect(a.get('steam:9')?.title).toBe('Pendiente');
    await expectConverged(h, a, b);
  });

  it('503 busy se reintenta con espera; sync_disabled no, hasta el siguiente disparador', async () => {
    const h = createHarness();
    const notices = createNoticeCenter();
    const { a } = await pairOf(h, { notices });
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    await a.settle();
    a.env.timers = [];
    a.faults.push({ status: 503, error: 'busy' });
    await a.syncNow();
    expect(a.sync.getSnapshot()).toMatchObject({ activity: 'error', error: 'busy', pending: 1 });
    expect(a.env.timers.map((t) => t.ms)).toEqual([5000]);
    a.env.runTimers();
    await a.settle();
    expect(a.sync.getSnapshot()).toMatchObject({ activity: 'idle', error: null, pending: 0 });

    h.env.SYNC_ENABLED = '0';
    a.agenda.update('steam:1', { note: 'Con la API apagada' });
    await a.settle();
    a.env.timers = [];
    await a.syncNow();
    expect(a.sync.getSnapshot()).toMatchObject({ activity: 'disabled', error: 'sync_disabled' });
    expect(a.env.timers).toEqual([]);
    expect(notices.getSnapshot()).toBeNull();
    h.env.SYNC_ENABLED = '1';
    await a.syncNow();
    expect(a.sync.getSnapshot()).toMatchObject({ activity: 'idle', pending: 0 });
  });

  it('el aviso «Sincronización fallida» sale tras 3 fallos seguidos, una vez hasta el siguiente éxito', async () => {
    const h = createHarness();
    const notices = createNoticeCenter();
    const { a } = await pairOf(h, { notices });
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    a.agenda.capture({ id: 'steam:2', title: 'Dos' });
    await a.settle();
    for (let i = 0; i < 2; i++) {
      a.faults.push({ status: 500, error: 'internal' });
      await a.syncNow();
    }
    expect(notices.getSnapshot()).toBeNull();
    a.faults.push({ status: 500, error: 'internal' });
    await a.syncNow();
    const notice = notices.getSnapshot();
    expect(notice?.message).toBe(
      'No hemos podido sincronizar 2 cambios. Lo seguiremos intentando.',
    );
    expect(notice?.actions.map((x) => x.label)).toEqual(['Reintentar ahora']);
    notices.dismiss(notice?.id ?? 0);
    a.faults.push({ status: 500, error: 'internal' });
    await a.syncNow();
    expect(notices.getSnapshot()).toBeNull();
    // «Reintentar ahora» sincroniza.
    notice?.actions[0]?.run();
    await a.settle();
    expect(a.sync.getSnapshot()).toMatchObject({ activity: 'idle', pending: 0 });
    // Sin red no cuenta como fallo.
    a.setOffline(true);
    for (let i = 0; i < 4; i++) await a.syncNow();
    expect(notices.getSnapshot()).toBeNull();
  });
});

describe('CA4.3: restaurar', () => {
  it('borrar solo IndexedDB y recargar restaura la agenda, porque el indicio sigue', async () => {
    const h = createHarness();
    const { a, b } = await pairOf(h);
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    a.agenda.capture({ id: 'steam:2', title: 'Dos' });
    a.agenda.setFlag('steam:2', 'platinum', true);
    await a.syncNow();
    const before = await a.stored();
    await a.wipeIndexedDbAndReload();
    expect(a.sync.getSnapshot()).toMatchObject({ status: 'paired', activity: 'idle' });
    expect(await a.stored()).toEqual(before);
    expect(a.memory()).toEqual(before);
    // Tras restaurar no sabe su id de dispositivo hasta pedir la lista.
    expect(a.sync.getSnapshot().deviceId).toBeNull();
    await b.syncNow();
    await expectConverged(h, b, a);
    const devices = await a.sync.listDevices();
    expect(a.sync.getSnapshot().deviceId).toBe(devices.find((d) => d.current)?.id);
  });

  it('con el indicio y sin estado, el estado es «restaurando» hasta la primera ronda buena', async () => {
    const h = createHarness();
    const { a } = await pairOf(h);
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    await a.syncNow();
    a.offline = true;
    await a.wipeIndexedDbAndReload();
    expect(a.sync.getSnapshot()).toMatchObject({ status: 'restoring', activity: 'offline' });
    a.setOffline(false);
    await a.settle();
    expect(a.sync.getSnapshot()).toMatchObject({ status: 'paired', activity: 'idle' });
    expect(a.get('steam:1')?.title).toBe('Uno');
  });

  it('sin cookies ni IndexedDB, el código de recuperación devuelve la agenda', async () => {
    const h = createHarness();
    const { a, b, recovery } = await pairOf(h);
    b.agenda.capture({ id: 'steam:5', title: 'Cinco' });
    await b.syncNow();
    a.client.cookies.clear();
    await a.wipeIndexedDbAndReload();
    expect(a.sync.getSnapshot()).toMatchObject({ status: 'off' });
    await a.sync.redeemRecoveryCode({ code: recovery, label: 'Chrome en Windows' });
    await a.settle();
    expect(a.get('steam:5')?.title).toBe('Cinco');
    await expectConverged(h, a, b);
  });

  it('sin cookies pero con IndexedDB: desemparejado por cookies borradas', async () => {
    const h = createHarness();
    const { a } = await pairOf(h);
    a.client.cookies.clear();
    await a.reload();
    expect(a.sync.getSnapshot()).toMatchObject({ status: 'unpaired', unpairedReason: 'cookies' });
    await a.sync.forget();
    expect(a.sync.getSnapshot()).toMatchObject({ status: 'off' });
  });
});

describe('desemparejar y borrar', () => {
  it('desemparejar este dispositivo conserva la agenda local y lo deja apagado', async () => {
    const h = createHarness();
    const { a, b } = await pairOf(h);
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    await a.syncNow();
    await b.syncNow();
    const me = b.sync.getSnapshot().deviceId ?? '';
    expect(await b.sync.revokeDevice(me)).toEqual({ self: true });
    expect(b.sync.getSnapshot()).toMatchObject({ status: 'off' });
    expect(b.get('steam:1')?.title).toBe('Uno');
    const calls = b.syncCalls;
    await b.syncNow();
    expect(b.syncCalls).toBe(calls);
  });

  it('borrar la agenda del servidor la vacía en D1 y apaga la sincronización (CA4.7)', async () => {
    const h = createHarness();
    const { a, b } = await pairOf(h);
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    await a.syncNow();
    await a.sync.deleteServerAgenda();
    await a.agenda.deleteAll();
    await a.settle();
    expect(a.sync.getSnapshot()).toMatchObject({ status: 'off' });
    expect(h.db.rows('SELECT * FROM agenda')).toEqual([]);
    expect(h.db.rows('SELECT * FROM op')).toEqual([]);
    expect(await a.stored()).toEqual([]);
    // El otro dispositivo se entera en su siguiente sincronización.
    await b.syncNow();
    expect(b.sync.getSnapshot()).toMatchObject({ status: 'unpaired', unpairedReason: 'server' });
  });
});
