// Réplicas de la app de verdad contra la micro-API en proceso (M4): cada una con su IndexedDB
// (`fake-indexeddb`), su Dexie, su agenda (`createAgenda` con su reloj y su nodo), su tarro de
// cookies y el motor de sincronización de la SPA (`src/sync/`), todas sobre la misma `SqliteD1`.
// El navegador es falso: `window` y `document` son `EventTarget`, la red se corta a voluntad y los
// temporizadores del planificador se guardan sin correr (las pruebas sincronizan con `syncNow()`).

import type { Entry } from '@gameagenda/core/entries';
import {
  applyOps,
  createHlcClock,
  type HlcClock,
  type Op,
  randomNode,
} from '@gameagenda/core/sync';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { v7 as uuidv7 } from 'uuid';
import { createAgenda } from '../../src/agenda/agenda.ts';
import type { AgendaStorage } from '../../src/agenda/storage.ts';
import type { AgendaStore } from '../../src/agenda/types.ts';
import type { CopyReminderStore } from '../../src/data/copy-reminder.ts';
import { createDexieAgendaStorage } from '../../src/db/agenda-storage.ts';
import { type GameAgendaDb, openDatabase } from '../../src/db/database.ts';
import { loadLocalState } from '../../src/db/local-state.ts';
import { createInboxSink } from '../../src/links/inbox-capture.ts';
import type { NoticeCenter } from '../../src/notices/notice-center.ts';
import type { FetchLike } from '../../src/sync/api-client.ts';
import { createSyncService, type SyncController, trackLocalWrites } from '../../src/sync/facade.ts';
import type { LockManagerLike, RuntimeTimings } from '../../src/sync/runtime.ts';
import type { SchedulerEnv } from '../../src/sync/scheduler.ts';
import type { Client, Harness } from './harness.ts';
import { sortEntries } from './sync-support.ts';

const DEVICE = '__Host-ga_device';

/** Un temporizador guardado por el planificador (no corre solo). */
export interface FakeTimer {
  readonly id: number;
  readonly ms: number;
  readonly fn: () => void;
}

/** `window`, `document`, la red y los temporizadores de una pestaña, a mano. */
export class FakeEnv implements SchedulerEnv {
  readonly window = new EventTarget();
  readonly document: EventTarget & { visibilityState: DocumentVisibilityState };
  online = true;
  timers: FakeTimer[] = [];
  private nextId = 1;
  readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
    this.document = Object.assign(new EventTarget(), {
      visibilityState: 'visible' as DocumentVisibilityState,
    });
  }

  isOnline = () => this.online;
  random = () => 0.5;

  setTimeout = (fn: () => void, ms: number): unknown => {
    const timer = { id: this.nextId++, ms, fn };
    this.timers.push(timer);
    return timer.id;
  };

  clearTimeout = (handle: unknown): void => {
    this.timers = this.timers.filter((t) => t.id !== handle);
  };

  /** Corre los temporizadores pendientes (los que creen al correr, no). */
  runTimers(): void {
    const due = this.timers;
    this.timers = [];
    for (const t of due) t.fn();
  }

  goOffline(): void {
    this.online = false;
    this.window.dispatchEvent(new Event('offline'));
  }

  goOnline(): void {
    this.online = true;
    this.window.dispatchEvent(new Event('online'));
  }

  setVisible(visible: boolean): void {
    this.document.visibilityState = visible ? 'visible' : 'hidden';
    this.document.dispatchEvent(new Event('visibilitychange'));
  }
}

/**
 * Web Locks entre pestañas del mismo navegador. Con `ifAvailable`, `null` si está cogido; sin él,
 * espera su turno en una cola, por orden de llegada (como `navigator.locks`).
 */
export class FakeLocks implements LockManagerLike {
  /** Por candado cogido, quién espera su turno. */
  private readonly queues = new Map<string, Array<() => void>>();

  async request<T>(
    name: string,
    options: { ifAvailable?: boolean },
    callback: (lock: unknown) => Promise<T>,
  ): Promise<T> {
    const queue = this.queues.get(name);
    if (queue === undefined) this.queues.set(name, []);
    else if (options.ifAvailable === true) return callback(null);
    else await new Promise<void>((resolve) => queue.push(resolve));
    try {
      return await callback({ name });
    } finally {
      // Pasa el candado al siguiente de la cola, sin soltarlo entre medias.
      const next = this.queues.get(name)?.shift();
      if (next === undefined) this.queues.delete(name);
      else next();
    }
  }

  /** ¿Lo tiene alguien? */
  isHeld(name: string): boolean {
    return this.queues.has(name);
  }

  /** Peticiones esperando su turno. */
  waiting(name: string): number {
    return this.queues.get(name)?.length ?? 0;
  }
}

/** Fallos que la red le hace a la siguiente petición a `/sync` (después, normal). */
export type Fault = { status: number; error: string } | 'network' | 'pass';

export interface ReplicaOptions {
  /** Cuánto va adelantado (o atrasado) el reloj de este dispositivo, en ms. */
  readonly skewMs?: number;
  readonly batchSize?: number;
  readonly maxRequests?: number;
  /** Sin agenda en memoria: se actúa sobre el almacén (`act`), más rápido (propiedades). */
  readonly withAgenda?: boolean;
  /** Cuándo guarda la agenda tras cada acción (por defecto, enseguida). */
  readonly afterPaint?: () => Promise<void>;
  readonly locks?: LockManagerLike | null;
  readonly timings?: Partial<RuntimeTimings>;
  /** Para ver el aviso «Sincronización fallida». */
  readonly notices?: NoticeCenter;
  /** Para ver que una sincronización correcta reinicia el aviso de copia. */
  readonly copyReminder?: CopyReminderStore;
  /** Otra pestaña del mismo navegador (misma IndexedDB y mismas cookies). */
  readonly sameBrowserAs?: Replica;
  /**
   * Las primeras N cargas del motor (`import()` del *chunk*) fallan, como en una pestaña vieja tras
   * un despliegue: el *hash* que pide ya no está.
   */
  readonly failRuntimeLoads?: number;
  /**
   * El buzón del Atajo de iOS: con agenda, esta pestaña lo apunta (`createInboxSink`) salvo con
   * `inbox: false`. `catalog` son los nombres del catálogo local (por `appid`).
   */
  readonly inbox?: boolean;
  readonly catalog?: ReadonlyMap<number, string>;
}

let replicas = 0;

/** Un navegador (su IndexedDB y sus cookies) con una pestaña abierta. */
export class Replica {
  readonly harness: Harness;
  readonly client: Client;
  readonly name: string;
  readonly options: ReplicaOptions;
  idb: IDBFactory;
  db!: GameAgendaDb;
  clock!: HlcClock;
  storage!: AgendaStorage;
  /** `null` con `withAgenda: false`. */
  agendaOrNull: AgendaStore | null = null;
  sync!: SyncController;
  env!: FakeEnv;
  /** Sin red: `fetch` falla y `navigator.onLine` es `false`. */
  offline = false;
  readonly faults: Fault[] = [];
  /** Peticiones a `/sync` que han llegado al servidor. */
  syncCalls = 0;
  /** Lo que llevaban esas peticiones. */
  readonly requests: Array<{ cursor: number; purgedSeq: number; ops: number }> = [];
  /**
   * Si está, la respuesta de la siguiente petición a `/sync` (ya procesada por el servidor) espera
   * a esta promesa antes de llegar a la app: una respuesta lenta.
   */
  holdNextSync: Promise<void> | null = null;
  /**
   * Si está, cada petición a la micro-API (con la red puesta) lo espera antes de llegar al
   * servidor: para retener una petición antes de que se procese, o fallarla lanzando.
   */
  beforeRequest: ((path: string) => Promise<void> | void) | null = null;
  /** Lo que el motor manda al registro de errores (IndexedDB): las pruebas esperan que no haya. */
  readonly errors: unknown[] = [];
  /** Veces que la pestaña ha intentado cargar el motor. */
  runtimeLoads = 0;

  private constructor(harness: Harness, options: ReplicaOptions) {
    this.harness = harness;
    this.options = options;
    const twin = options.sameBrowserAs;
    this.client = twin?.client ?? harness.client();
    this.name = twin?.name ?? `ga-replica-${++replicas}`;
    this.idb = twin?.idb ?? new IDBFactory();
  }

  static async open(harness: Harness, options: ReplicaOptions = {}): Promise<Replica> {
    const replica = new Replica(harness, options);
    await replica.openTab();
    return replica;
  }

  get agenda(): AgendaStore {
    if (this.agendaOrNull === null) throw new Error('Esta réplica no tiene agenda');
    return this.agendaOrNull;
  }

  /** La hora de este dispositivo. */
  now = (): number => this.harness.clock.ms + (this.options.skewMs ?? 0);

  private readCookie = (): string =>
    [...this.client.cookies]
      .filter(([name]) => name !== DEVICE)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');

  private fetch: FetchLike = async (input, init) => {
    if (this.offline) throw new TypeError('Failed to fetch');
    const path = input.replace(/^https?:\/\/[^/]+/, '');
    if (this.beforeRequest !== null) await this.beforeRequest(path);
    if (path.endsWith('/sync')) {
      const fault = this.faults.shift();
      if (fault === 'network') throw new TypeError('Failed to fetch');
      if (fault !== undefined && fault !== 'pass') {
        return new Response(JSON.stringify({ error: fault.error }), { status: fault.status });
      }
      this.syncCalls += 1;
      const sent = JSON.parse(String(init.body)) as { cursor: number; purgedSeq: number; ops: [] };
      this.requests.push({ cursor: sent.cursor, purgedSeq: sent.purgedSeq, ops: sent.ops.length });
    }
    const body = typeof init.body === 'string' ? init.body : undefined;
    const response = await this.client.call(init.method ?? 'GET', path, { body });
    if (path.endsWith('/sync') && this.holdNextSync !== null) {
      const hold = this.holdNextSync;
      this.holdNextSync = null;
      await hold;
    }
    return new Response(response.json === null ? null : JSON.stringify(response.json), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  /** Abre la pestaña como `main.tsx`: lee Dexie, crea el reloj, la agenda y la sincronización. */
  async openTab(): Promise<void> {
    this.db = openDatabase({ name: this.name, indexedDB: this.idb, IDBKeyRange });
    const state = await loadLocalState(this.db);
    this.clock = createHlcClock({
      now: this.now,
      node: randomNode(Math.random),
      snapshot: state.clock,
    });
    this.env = new FakeEnv(this.now);
    this.env.online = !this.offline;
    let sync: SyncController | null = null;
    this.storage = trackLocalWrites(createDexieAgendaStorage(this.db, uuidv7), () =>
      sync?.notifyLocalWrite(),
    );
    this.agendaOrNull =
      this.options.withAgenda === false
        ? null
        : createAgenda({
            entries: state.entries,
            clock: this.clock,
            newId: uuidv7,
            storage: this.storage,
            now: () => new Date(this.now()),
            afterPaint: this.options.afterPaint ?? (() => Promise.resolve()),
          });
    sync = createSyncService({
      db: this.db,
      clock: this.clock,
      newOpId: uuidv7,
      readCookie: this.readCookie,
      env: this.env,
      locks: this.options.locks ?? null,
      notices: this.options.notices ?? null,
      copyReminder: this.options.copyReminder ?? null,
      ...(this.agendaOrNull !== null && this.options.inbox !== false
        ? { inbox: this.inboxSink(this.agendaOrNull) }
        : {}),
      fetch: this.fetch,
      ...(this.options.timings ? { timings: this.options.timings } : {}),
      engine: {
        ...(this.options.batchSize ? { batchSize: this.options.batchSize } : {}),
        ...(this.options.maxRequests ? { maxRequests: this.options.maxRequests } : {}),
        yieldToMain: () => Promise.resolve(),
      },
      loadRuntime: () => {
        this.runtimeLoads += 1;
        if (this.runtimeLoads <= (this.options.failRuntimeLoads ?? 0)) {
          return Promise.reject(new TypeError('Failed to fetch dynamically imported module'));
        }
        return import('../../src/sync/runtime.ts');
      },
      whenStartup: () => Promise.resolve(),
      onError: (error) => this.errors.push(error),
    });
    this.sync = sync;
    sync.start();
    await this.settle();
  }

  /** Apunta el buzón como `main.tsx`, con un catálogo local falso (`options.catalog`). */
  private inboxSink(agenda: AgendaStore) {
    const catalog = this.options.catalog ?? new Map<number, string>();
    return createInboxSink({
      agenda,
      search: {
        lookup: async (appids) => {
          const found = appids
            .filter((appid) => catalog.has(appid))
            .map((appid) => ({
              appid,
              name: catalog.get(appid) ?? '',
              nameEs: null,
              year: null,
              flags: 0,
            }));
          return { found, missing: appids.filter((appid) => !catalog.has(appid)) };
        },
      },
      notices: this.options.notices ?? null,
    });
  }

  /** Cierra la pestaña (la IndexedDB y las cookies se quedan). */
  async closeTab(): Promise<void> {
    await this.settle();
    this.sync.dispose();
    this.agendaOrNull?.dispose();
    this.db.close();
  }

  /** Recarga la página. */
  async reload(): Promise<void> {
    await this.closeTab();
    await this.openTab();
  }

  /** Borra solo IndexedDB (DevTools) y recarga: las cookies se conservan (CA4.3). */
  async wipeIndexedDbAndReload(): Promise<void> {
    await this.closeTab();
    this.idb = new IDBFactory();
    await this.openTab();
  }

  /**
   * Borra solo IndexedDB con la pestaña abierta (DevTools): Dexie cierra la base al recibir
   * `versionchange` y la vuelve a crear vacía con la operación siguiente, con un `storagemutated`
   * de todas las tablas. La agenda en memoria y las cookies se quedan.
   */
  async wipeIndexedDbOpen(): Promise<void> {
    await this.settle();
    await new Promise<void>((resolve, reject) => {
      const request = this.idb.deleteDatabase(this.name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  setOffline(offline: boolean): void {
    this.offline = offline;
    if (offline) this.env.goOffline();
    else this.env.goOnline();
  }

  /**
   * Espera a que la agenda haya guardado, a que no haya ronda en marcha y a que la agenda haya
   * releído lo que ha escrito el motor. (Cada `agenda.whenIdle()` espera un `setTimeout(0)`, que en
   * Windows son ≈15 ms: por eso no se repite más.)
   */
  async settle(): Promise<void> {
    await this.agendaOrNull?.whenIdle();
    await this.sync.whenIdle();
    await this.agendaOrNull?.whenIdle();
  }

  /** Como `settle()`, corriendo los temporizadores que salgan (el reintento del Web Lock). */
  async drain(): Promise<void> {
    let done = false;
    const settled = this.settle().then(() => {
      done = true;
    });
    while (!done) {
      this.env.runTimers();
      await new Promise((resolve) => setImmediate(resolve));
    }
    await settled;
  }

  /** Sincroniza ya y espera a que todo se asiente. */
  async syncNow(): Promise<void> {
    await this.agendaOrNull?.whenIdle();
    await this.sync.syncNow();
    await this.settle();
  }

  async activate(label = 'Chrome en Windows'): Promise<string> {
    const { recoveryCode } = await this.sync.activate({ label, minAge: 14 });
    await this.settle();
    return recoveryCode;
  }

  /** Empareja `other` con la agenda de esta réplica. */
  async pair(other: Replica, label = 'Safari en iPhone'): Promise<void> {
    const { code } = await this.sync.createPairingCode();
    await other.sync.redeemPairingCode({ code, label });
    await other.settle();
  }

  /**
   * Una acción local sobre el almacén, sin agenda: fusiona `ops` sobre lo guardado y lo escribe con
   * sus operaciones (y las derivadas) en la `outbox`, como lo haría la agenda.
   */
  async act(ops: readonly Op[]): Promise<void> {
    const before = new Map<string, Entry | undefined>();
    let toLoad = [...new Set(ops.map((o) => o.entryId))];
    for (;;) {
      const rows = await this.db.entries.bulkGet(toLoad);
      toLoad.forEach((id, i) => {
        before.set(id, rows[i]);
      });
      const { entries, derived } = applyOps((id) => before.get(id), ops, uuidv7);
      // Una derivada que va a otra entrada (vinculación): se lee y se vuelve a calcular.
      toLoad = [...entries.keys()].filter((id) => !before.has(id));
      if (toLoad.length > 0) continue;
      await this.storage.write({
        entries: [...entries.values()],
        ops: [...ops, ...derived],
        before,
        clock: () => this.clock.snapshot(),
      });
      return;
    }
  }

  /** Lo guardado en Dexie, lápidas y esqueletos incluidos, por id. */
  async stored(): Promise<Entry[]> {
    return sortEntries(await this.db.entries.toArray());
  }

  /** Lo que tiene la agenda en memoria (lo que pinta la interfaz). */
  memory(): Entry[] {
    return sortEntries(this.agenda.allEntries());
  }

  async outboxSize(): Promise<number> {
    return this.db.outbox.count();
  }

  get(id: string): Entry | undefined {
    return this.agenda.get(id);
  }
}
