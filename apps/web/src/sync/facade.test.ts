// La fachada (chunk inicial): el estado para la interfaz y cuándo se carga el motor. El motor es
// falso aquí; con el de verdad, ver `apps/web/worker/test/sync-client.test.ts`.
import { createHlcClock } from '@gameagenda/core/sync';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { v7 as uuidv7 } from 'uuid';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgendaStorage, WriteBatch } from '../agenda/storage.ts';
import { type GameAgendaDb, META_KEYS, openDatabase } from '../db/database.ts';
import { createSyncService, type SyncController, trackLocalWrites } from './facade.ts';
import type { RuntimeHost, SyncRuntime } from './runtime.ts';
import type { SchedulerEnv } from './scheduler.ts';
import { newRecord } from './state.ts';
import { SyncError } from './types.ts';

const open: Array<{ db: GameAgendaDb; sync: SyncController }> = [];
afterEach(async () => {
  for (const { db, sync } of open.splice(0)) {
    await sync.whenIdle();
    sync.dispose();
    db.close();
  }
});

function fakeEnv(): SchedulerEnv & { win: EventTarget } {
  const win = new EventTarget();
  return {
    win,
    window: win,
    document: Object.assign(new EventTarget(), {
      visibilityState: 'visible' as DocumentVisibilityState,
    }),
    isOnline: () => true,
    now: Date.now,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    random: () => 0.5,
  };
}

/** Un motor falso que apunta lo que le piden. */
function fakeRuntime() {
  const calls: string[] = [];
  let host: RuntimeHost | null = null;
  const runtime: SyncRuntime = {
    resume: () => calls.push('resume'),
    pause: () => calls.push('pause'),
    syncNow: async () => {
      calls.push('syncNow');
    },
    localWrite: () => calls.push('localWrite'),
    idle: async () => undefined,
    async activate() {
      calls.push('activate');
      return { recoveryCode: 'R' };
    },
    redeemPairingCode: async () => undefined,
    redeemRecoveryCode: async () => undefined,
    createPairingCode: async () => ({ code: 'C', expiresAt: 'E' }),
    createRecoveryCode: async () => ({ recoveryCode: 'R' }),
    listDevices: async () => [],
    revokeDevice: async () => ({ self: false }),
    deleteServerAgenda: async () => undefined,
    forget: async () => undefined,
  };
  return {
    calls,
    get host() {
      return host;
    },
    loads: 0,
    load() {
      this.loads += 1;
      return Promise.resolve({
        createRuntime(h: RuntimeHost) {
          host = h;
          return runtime;
        },
      });
    },
  };
}

function setup(options: { cookie?: string; idb?: IDBFactory; name?: string } = {}) {
  const db = openDatabase({
    name: options.name ?? `facade-${open.length}`,
    indexedDB: options.idb ?? new IDBFactory(),
    IDBKeyRange,
  });
  const jar = { cookie: options.cookie ?? '' };
  const runtime = fakeRuntime();
  const env = fakeEnv();
  const fetches: string[] = [];
  const sync = createSyncService({
    db,
    clock: createHlcClock({ now: Date.now, node: 'abcdabcd' }),
    newOpId: uuidv7,
    readCookie: () => jar.cookie,
    env,
    locks: null,
    fetch: async (url) => {
      fetches.push(url);
      return new Response('{}');
    },
    loadRuntime: () => runtime.load(),
    whenStartup: () => Promise.resolve(),
  });
  open.push({ db, sync });
  return { db, sync, jar, runtime, env, fetches };
}

describe('estado y carga del motor', () => {
  it('sin indicio ni estado: apagado, sin cargar el motor ni pedir nada', async () => {
    const { sync, runtime, env, fetches } = setup();
    expect(sync.getSnapshot()).toMatchObject({ ready: false, status: 'off' });
    sync.start();
    await sync.whenIdle();
    expect(sync.getSnapshot()).toEqual({
      ready: true,
      status: 'off',
      activity: 'idle',
      error: null,
      unpairedReason: null,
      deviceId: null,
      pending: 0,
      lastSyncAt: null,
    });
    env.win.dispatchEvent(new Event('focus'));
    sync.notifyLocalWrite();
    await sync.syncNow();
    await sync.whenIdle();
    expect(runtime.loads).toBe(0);
    expect(fetches).toEqual([]);
  });

  it('con indicio y sin estado (IndexedDB borrada): restaurando, y el motor se reanuda', async () => {
    const { sync, runtime } = setup({ cookie: 'x=1; __Host-ga_sync=1' });
    sync.start();
    await sync.whenIdle();
    expect(sync.getSnapshot()).toMatchObject({ status: 'restoring', activity: 'idle' });
    expect(runtime.loads).toBe(1);
    expect(runtime.calls).toEqual(['resume']);
    expect(runtime.host?.getRecord()).toBeNull();
  });

  it('con indicio y estado: emparejado; sin indicio y con estado: desemparejado', async () => {
    const idb = new IDBFactory();
    const first = setup({ cookie: '__Host-ga_sync=1', idb, name: 'shared' });
    await first.db.meta.put({
      key: META_KEYS.syncState,
      value: { ...newRecord('d1', false), lastSyncAt: 42 },
    });
    first.sync.start();
    await first.sync.whenIdle();
    expect(first.sync.getSnapshot()).toMatchObject({
      status: 'paired',
      deviceId: 'd1',
      lastSyncAt: 42,
    });
    // Se borran las cookies del sitio con la app abierta: lo nota al ganar el foco.
    first.jar.cookie = '';
    first.env.win.dispatchEvent(new Event('focus'));
    expect(first.sync.getSnapshot()).toMatchObject({
      status: 'unpaired',
      unpairedReason: 'cookies',
    });
    expect(first.runtime.calls).toEqual(['resume', 'pause']);
  });

  it('desemparejado por el servidor (401)', async () => {
    const { db, sync } = setup();
    await db.meta.put({
      key: META_KEYS.syncState,
      value: { ...newRecord('d1', false), unpairedBy: 'server' },
    });
    sync.start();
    await sync.whenIdle();
    expect(sync.getSnapshot()).toMatchObject({ status: 'unpaired', unpairedReason: 'server' });
    await expect(sync.listDevices()).rejects.toMatchObject({ code: 'unauthorized' });
    await sync.forget();
    expect(sync.getSnapshot()).toMatchObject({ status: 'off' });
    expect(await db.meta.get(META_KEYS.syncState)).toBeUndefined();
  });

  it('otra pestaña activa: esta se entera por meta y carga su motor', async () => {
    const idb = new IDBFactory();
    const tab = setup({ idb, name: 'tabs' });
    tab.sync.start();
    await tab.sync.whenIdle();
    expect(tab.sync.getSnapshot().status).toBe('off');
    // La otra pestaña: cookies del mismo origen y la misma IndexedDB.
    tab.jar.cookie = '__Host-ga_sync=1';
    const other = openDatabase({ name: 'tabs', indexedDB: idb, IDBKeyRange });
    await other.meta.put({ key: META_KEYS.syncState, value: newRecord('d2', false) });
    other.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await tab.sync.whenIdle();
    expect(tab.sync.getSnapshot()).toMatchObject({ status: 'paired', deviceId: 'd2' });
    expect(tab.runtime.calls).toEqual(['resume']);
  });

  it('la instantánea no cambia de referencia si no cambia nada', async () => {
    const { sync } = setup();
    sync.start();
    await sync.whenIdle();
    const before = sync.getSnapshot();
    let calls = 0;
    sync.subscribe(() => {
      calls += 1;
    });
    await sync.forget();
    expect(sync.getSnapshot()).toBe(before);
    expect(calls).toBe(0);
  });

  it('activar carga el motor aunque no esté emparejado', async () => {
    const { sync, runtime } = setup();
    sync.start();
    await sync.whenIdle();
    expect(await sync.activate({ label: 'Chrome en Windows', minAge: 14 })).toEqual({
      recoveryCode: 'R',
    });
    expect(runtime.loads).toBe(1);
    expect(runtime.calls).toEqual(['activate']);
  });

  it('sin IndexedDB no se puede sincronizar', async () => {
    const sync = createSyncService({
      db: null,
      clock: createHlcClock({ now: Date.now, node: 'abcdabcd' }),
      newOpId: uuidv7,
      readCookie: () => '__Host-ga_sync=1',
      env: fakeEnv(),
      whenStartup: () => Promise.resolve(),
    });
    sync.start();
    expect(sync.getSnapshot()).toMatchObject({ ready: true, status: 'off' });
    const error = await sync.activate({ label: 'L', minAge: 14 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncError);
    expect(error).toMatchObject({ code: 'unavailable' });
  });
});

describe('escrituras locales', () => {
  it('trackLocalWrites avisa tras guardar algo con operaciones', async () => {
    const writes: WriteBatch[] = [];
    const storage = {
      write: async (batch: WriteBatch) => {
        writes.push(batch);
        return batch.entries;
      },
    } as unknown as AgendaStorage;
    let notified = 0;
    const tracked = trackLocalWrites(storage, () => {
      notified += 1;
    });
    const empty = {
      entries: [],
      ops: [],
      before: new Map(),
      clock: { ms: 0, counter: 0, offset: 0 },
    };
    await tracked.write(empty);
    expect(notified).toBe(0);
    await tracked.write({
      ...empty,
      ops: [{ opId: 'o', entryId: 'steam:1', field: 'note', value: '', hlc: 'h' }],
    });
    expect(notified).toBe(1);
    expect(writes).toHaveLength(2);
  });

  it('emparejado, una escritura local va al motor y recuenta lo pendiente', async () => {
    const { db, sync, runtime } = setup({ cookie: '__Host-ga_sync=1' });
    await db.meta.put({ key: META_KEYS.syncState, value: newRecord('d1', false) });
    sync.start();
    await sync.whenIdle();
    const hlc = '1793178900000-0000-k3x9p2qa';
    await db.outbox.bulkAdd([
      { opId: 'a', entryId: 'steam:1', field: 'status', value: 'playing', hlc },
      { opId: 'b', entryId: 'steam:1', field: 'note', value: '', hlc },
    ]);
    sync.notifyLocalWrite();
    await sync.whenIdle();
    expect(runtime.calls).toEqual(['resume', 'localWrite']);
    expect(sync.getSnapshot().pending).toBe(1);
  });
});
