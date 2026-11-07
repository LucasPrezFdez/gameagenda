// El ciclo de vida del cliente de la sincronización (M4; §5.3, §7.7 y §11.4; ADR-011), con las
// réplicas de la app contra la micro-API en proceso: lo que pasa con una ronda en vuelo al
// desemparejar o al borrar todos los datos (también en otra pestaña, con y sin Web Locks), un 401
// al borrar, IndexedDB borrada con la app abierta y un fallo al cargar el motor. Cada caso es la
// reproducción de un hallazgo de la revisión del 07-11-2026.

import { isLive } from '@gameagenda/core/entries';
import { afterEach, describe, expect, it } from 'vitest';
import { META_KEYS } from '../../src/db/database.ts';
import { SYNC_LOCK } from '../../src/sync/runtime.ts';
import { parseSyncRecord } from '../../src/sync/state.ts';
import { SyncError } from '../../src/sync/types.ts';
import { createHarness, type Harness, T0 } from './harness.ts';
import { FakeLocks, Replica, type ReplicaOptions } from './sync-client-support.ts';
import { serverEntries } from './sync-support.ts';

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
async function pairOf(h: Harness, options: ReplicaOptions = {}) {
  const a = await replica(h, options);
  const b = await replica(h, options);
  await a.activate();
  await a.pair(b);
  return { a, b };
}

/** Espera a que se cumpla, cediendo el turno; si no llega, falla (en vez de colgarse). */
async function until(what: string, condition: () => boolean): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`until: ${what}`);
}

/** Una puerta: `wait()` no sigue hasta `open()`. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, wait: () => opened };
}

/**
 * Retiene la siguiente petición a una ruta que acaba en `suffix` ANTES de que llegue al servidor
 * (las demás pasan). `arrived` dice que ya está retenida.
 */
function holdNextRequest(r: Replica, suffix: string) {
  const door = gate();
  let arrived = false;
  r.beforeRequest = async (path) => {
    if (arrived || !path.endsWith(suffix)) return;
    arrived = true;
    await door.wait();
  };
  return {
    release: door.open,
    get arrived() {
      return arrived;
    },
  };
}

/** Retiene la respuesta de la siguiente petición a `/sync`, ya procesada por el servidor. */
function holdNextResponse(r: Replica) {
  const door = gate();
  r.holdNextSync = door.wait();
  return {
    release: door.open,
    get arrived() {
      return r.holdNextSync === null;
    },
  };
}

async function metaKeys(r: Replica): Promise<string[]> {
  return (await r.db.meta.toCollection().primaryKeys()) as string[];
}

/** Lo vivo guardado en Dexie, por id. */
async function liveTitles(r: Replica): Promise<string[]> {
  return (await r.stored()).filter(isLive).map((e) => e.title ?? '');
}

/** La única agenda de D1. */
function onlyAgenda(h: Harness): string {
  const rows = h.db.rows<{ id: string }>('SELECT id FROM agenda');
  if (rows.length !== 1) throw new Error(`hay ${rows.length} agendas`);
  return (rows[0] as { id: string }).id;
}

/** Dos pestañas de un navegador emparejado y un móvil que ha apuntado `steam:42`. */
async function twoTabsAndPhone(h: Harness, locks: FakeLocks | null) {
  const a = await replica(h, { locks });
  const tab = await replica(h, { locks, sameBrowserAs: a });
  const phone = await replica(h);
  await a.activate();
  await Promise.all([a.drain(), tab.drain()]);
  await a.pair(phone);
  a.agenda.capture({ id: 'steam:1', title: 'Uno' });
  await a.syncNow();
  await tab.syncNow();
  phone.agenda.capture({ id: 'steam:42', title: 'Del móvil' });
  await phone.syncNow();
  return { a, tab, phone };
}

/** Lo que pide CA4.7 tras «Borrar todos mis datos»: nada en D1 ni en local, y apagado. */
async function expectAllDeleted(h: Harness, a: Replica, tab: Replica): Promise<void> {
  expect(h.db.rows('SELECT id FROM agenda')).toEqual([]);
  expect(await a.db.entries.count()).toBe(0);
  expect(await a.db.outbox.count()).toBe(0);
  expect(await metaKeys(a)).toEqual([]);
  for (const r of [a, tab]) {
    expect(r.sync.getSnapshot()).toMatchObject({ status: 'off', unpairedReason: null });
    expect(r.memory()).toEqual([]);
  }
}

describe('«Borrar todos mis datos» con una ronda de otra pestaña en vuelo (ciclo-de-vida#0 y seguridad-privacidad#5)', () => {
  it('con Web Locks, el borrado espera a que acabe la ronda de la otra pestaña, y no vuelve nada', async () => {
    const h = createHarness();
    const locks = new FakeLocks();
    const { a, tab } = await twoTabsAndPhone(h, locks);

    // La otra pestaña sincroniza, y la respuesta, que trae steam:42, tarda (el 200 tardío).
    const held = holdNextResponse(tab);
    const round = tab.sync.syncNow();
    await until('respuesta retenida', () => held.arrived);
    const deleting = a.sync.deleteServerAgenda();
    // Espera su turno en el candado: aún no ha borrado nada en el servidor.
    await until('borrado en la cola del candado', () => locks.waiting(SYNC_LOCK) === 1);
    expect(h.db.rows('SELECT id FROM agenda')).toHaveLength(1);
    held.release();
    await round;
    await deleting;
    await a.agenda.deleteAll();
    await Promise.all([a.drain(), tab.drain()]);
    await expectAllDeleted(h, a, tab);
  });

  it.each([
    ['el 200 tardío (la respuesta, con steam:42, llega después)', 'response'],
    ['el 401 tardío (la petición llega al servidor después)', 'request'],
  ] as const)(
    'sin Web Locks, %s de la otra pestaña no vuelve a escribir nada',
    async (_, where) => {
      const h = createHarness();
      const { a, tab } = await twoTabsAndPhone(h, null);
      const successes = tab.sync.successes;

      const held = where === 'response' ? holdNextResponse(tab) : holdNextRequest(tab, '/sync');
      const round = tab.sync.syncNow();
      await until('sincronización retenida', () => held.arrived);
      await a.sync.deleteServerAgenda();
      await a.agenda.deleteAll();
      held.release();
      await round;
      await Promise.all([a.drain(), tab.drain()]);
      await expectAllDeleted(h, a, tab);
      // Ni cuenta como ronda buena (nada de `meta.syncState`, aviso de copia ni contador).
      expect(tab.sync.successes).toBe(successes);
      expect(tab.get('steam:42')).toBeUndefined();
    },
  );

  it('el segundo intento del Web Lock no hace la ronda si mientras tanto se ha desemparejado', async () => {
    const h = createHarness();
    const locks = new FakeLocks();
    const a = await replica(h, { locks });
    await a.activate();
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    await a.settle();
    // Otra pestaña tiene el candado: la ronda espera para reintentar una vez.
    const busy = gate();
    const other = locks.request(SYNC_LOCK, {}, () => busy.wait());
    const round = a.sync.syncNow();
    await until('reintento del candado', () => a.env.timers.some((t) => t.ms === 1500));
    // Mientras, se borran las cookies del sitio: desemparejado por cookies, con el motor parado.
    a.client.cookies.clear();
    a.env.window.dispatchEvent(new Event('focus'));
    expect(a.sync.getSnapshot()).toMatchObject({ status: 'unpaired', unpairedReason: 'cookies' });
    busy.open();
    await other;
    const calls = a.syncCalls;
    a.env.runTimers();
    await round;
    await a.drain();
    // Sin ronda: no ha pedido nada, ni el 401 lo ha cambiado a «desemparejado por el servidor».
    expect(a.syncCalls).toBe(calls);
    expect(a.sync.getSnapshot()).toMatchObject({ status: 'unpaired', unpairedReason: 'cookies' });
  });
});

describe('desemparejar este dispositivo (ciclo-de-vida#1)', () => {
  it('con una ronda en vuelo, el 401 tardío no lo deja «desemparejado por el servidor»', async () => {
    const h = createHarness();
    const { a, b } = await pairOf(h);
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    await a.syncNow();
    await b.syncNow();
    const me = b.sync.getSnapshot().deviceId ?? '';
    b.agenda.capture({ id: 'steam:2', title: 'Dos' });
    await b.settle();
    // La ronda de b sale, y su petición llega al servidor después de desemparejarse.
    const held = holdNextRequest(b, '/sync');
    const round = b.sync.syncNow();
    await until('petición retenida', () => held.arrived);
    expect(await b.sync.revokeDevice(me)).toEqual({ self: true });
    expect(b.sync.getSnapshot()).toMatchObject({ status: 'off' });
    held.release();
    await round;
    await b.drain();
    expect(b.sync.getSnapshot()).toMatchObject({ status: 'off', unpairedReason: null });
    expect(await b.db.meta.get(META_KEYS.syncState)).toBeUndefined();
    // La agenda local se queda como está, también lo que no llegó a subir.
    expect(b.get('steam:2')?.title).toBe('Dos');
    expect(b.get('steam:1')?.title).toBe('Uno');
  });

  it('sin rondas nuevas durante la llamada; si falla, sigue sincronizando', async () => {
    const h = createHarness();
    const { b } = await pairOf(h);
    const me = b.sync.getSnapshot().deviceId ?? '';
    b.agenda.capture({ id: 'steam:2', title: 'Dos' });
    await b.settle();
    expect(b.env.timers.map((t) => t.ms)).toEqual([2000]);
    let timersDuringCall: number[] | null = null;
    b.beforeRequest = (path) => {
      if (!path.endsWith('/revoke')) return;
      timersDuringCall = b.env.timers.map((t) => t.ms);
      throw new TypeError('Failed to fetch');
    };
    const error = await b.sync.revokeDevice(me).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'network' });
    // Mientras iba la llamada no había espera de 2 s pendiente: el planificador estaba parado.
    expect(timersDuringCall).toEqual([]);
    b.beforeRequest = null;
    await b.drain();
    // Al fallar vuelve a arrancar (y sincroniza): sigue emparejado y sube lo pendiente.
    expect(b.sync.getSnapshot()).toMatchObject({ status: 'paired', activity: 'idle', pending: 0 });
    expect(await b.outboxSize()).toBe(0);
  });
});

describe('borrar la agenda del servidor con un 401 (ciclo-de-vida#2, seguridad-privacidad#0 e interfaz-a11y#4)', () => {
  it('un dispositivo revocado no la da por borrada: no borra nada y queda desemparejado por el servidor', async () => {
    const h = createHarness();
    const { a, b } = await pairOf(h);
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    await a.syncNow();
    await b.syncNow();
    const phone = (await a.sync.listDevices()).find((d) => !d.current);
    expect(await a.sync.revokeDevice(phone?.id ?? '')).toEqual({ self: false });
    // b no lo sabe aún: no ha hecho ninguna ronda desde entonces.
    expect(b.sync.getSnapshot()).toMatchObject({ status: 'paired' });

    const error = await b.sync.deleteServerAgenda().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncError);
    expect(error).toMatchObject({ code: 'unauthorized' });
    expect(b.sync.getSnapshot()).toMatchObject({ status: 'unpaired', unpairedReason: 'server' });
    expect(parseSyncRecord((await b.db.meta.get(META_KEYS.syncState))?.value)).toMatchObject({
      unpairedBy: 'server',
      lastError: 'unauthorized',
    });
    // La agenda sigue en D1, y la de b en local.
    expect(h.db.rows('SELECT id FROM agenda')).toHaveLength(1);
    expect(serverEntries(h.db).map((e) => e.id)).toEqual(['steam:1']);
    expect(b.get('steam:1')?.title).toBe('Uno');
    await a.syncNow();
    expect(a.sync.getSnapshot()).toMatchObject({ status: 'paired', activity: 'idle' });
  });

  it('si la agenda ya no existe, tampoco dice que la ha borrado', async () => {
    const h = createHarness();
    const { a, b } = await pairOf(h);
    await a.sync.deleteServerAgenda();
    expect(a.sync.getSnapshot()).toMatchObject({ status: 'off' });
    await expect(b.sync.deleteServerAgenda()).rejects.toMatchObject({ code: 'unauthorized' });
    expect(b.sync.getSnapshot()).toMatchObject({ status: 'unpaired', unpairedReason: 'server' });
  });
});

describe('IndexedDB borrada con la app abierta (ciclo-de-vida#3 y workerd-real#0)', () => {
  it('la siguiente ronda la restaura y vuelve a «emparejado», con meta.syncState', async () => {
    const h = createHarness();
    const a = await replica(h);
    await a.activate();
    a.agenda.capture({ id: 'steam:1', title: 'Uno' });
    a.agenda.capture({ id: 'steam:2', title: 'Dos' });
    await a.syncNow();

    await a.wipeIndexedDbOpen();
    // La primera operación vuelve a abrir la base, vacía: Dexie avisa de que ha cambiado todo.
    a.agenda.capture({ id: 'steam:3', title: 'Tres' });
    await a.settle();
    expect(a.sync.getSnapshot()).toMatchObject({
      status: 'paired',
      activity: 'idle',
      lastSyncAt: T0,
      pending: 0,
    });
    const record = parseSyncRecord((await a.db.meta.get(META_KEYS.syncState))?.value);
    expect(record).toMatchObject({ restore: false, lastSyncAt: T0, unpairedBy: null });
    expect(await liveTitles(a)).toEqual(['Uno', 'Dos', 'Tres']);
    expect(await a.outboxSize()).toBe(0);
    expect(serverEntries(h.db, onlyAgenda(h))).toEqual(await a.stored());
    expect(a.memory()).toEqual(await a.stored());

    // Las rondas siguientes siguen bien, y al recargar no vuelve a restaurar (no lo sube todo).
    a.agenda.update('steam:3', { note: 'Después' });
    await a.syncNow();
    expect(a.sync.getSnapshot()).toMatchObject({ status: 'paired', pending: 0 });
    const calls = a.requests.length;
    await a.reload();
    expect(a.sync.getSnapshot()).toMatchObject({ status: 'paired', activity: 'idle' });
    expect(a.requests.length).toBeGreaterThan(calls);
    expect(a.requests.slice(calls).map((r) => r.ops)).toEqual(a.requests.slice(calls).map(() => 0));
    expect(a.get('steam:3')?.note).toBe('Después');
  });
});

describe('fallo al cargar el motor (ciclo-de-vida#4)', () => {
  it('la interfaz lo dice, no se reintenta en bucle, y «Sincronizar ahora» lo vuelve a cargar', async () => {
    const h = createHarness();
    const a = await replica(h);
    await a.activate();
    // Una pestaña vieja tras un despliegue: el chunk del motor que pide ya no está.
    const tab = await replica(h, { sameBrowserAs: a, failRuntimeLoads: 1 });
    expect(tab.sync.getSnapshot()).toMatchObject({
      status: 'paired',
      activity: 'error',
      error: 'network',
    });
    expect(tab.errors).toHaveLength(1);
    tab.errors.length = 0;
    // Ni el foco ni las escrituras lo vuelven a intentar solos.
    tab.env.window.dispatchEvent(new Event('focus'));
    tab.agenda.capture({ id: 'steam:7', title: 'Siete' });
    await tab.drain();
    expect(tab.runtimeLoads).toBe(1);
    expect(tab.sync.getSnapshot()).toMatchObject({ activity: 'error', error: 'network' });

    await tab.syncNow();
    expect(tab.runtimeLoads).toBe(2);
    expect(tab.sync.getSnapshot()).toMatchObject({
      status: 'paired',
      activity: 'idle',
      error: null,
      pending: 0,
    });
    // Lo apuntado sin motor ha subido, y ya sincroniza sola (2 s después de escribir).
    expect(serverEntries(h.db).map((e) => e.id)).toEqual(['steam:7']);
    tab.agenda.update('steam:7', { note: 'Sola' });
    await tab.settle();
    tab.env.runTimers();
    await tab.settle();
    expect(serverEntries(h.db)[0]?.note).toBe('Sola');
  });
});
