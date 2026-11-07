// Fachada de la sincronización (M4), en el *chunk* inicial: sin Zod y sin red. Lee el indicio
// `__Host-ga_sync=1` y `meta.syncState`, guarda el estado para la interfaz
// (`subscribe`/`getSnapshot`) y carga el motor (`runtime.ts`) con `import()` solo si este navegador
// está emparejado (tras el primer pintado y en un rato ocioso: §9.5, regla 6) o cuando la interfaz
// pide activar, emparejar o recuperar. Quien no sincroniza no hace ninguna petición a `/api` ni
// descarga Zod.
//
// Varias pestañas: se entera de que otra ha activado, emparejado o desemparejado por
// `storagemutated` de `meta.syncState`, y del indicio al ganar el foco o volver a la vista.
import type { HlcClock } from '@gameagenda/core/sync';
import type { AgendaStorage } from '../agenda/storage.ts';
import type { CopyReminderStore } from '../data/copy-reminder.ts';
import { onTableChange } from '../db/changes.ts';
import { type GameAgendaDb, META_KEYS } from '../db/database.ts';
import type { NoticeCenter } from '../notices/notice-center.ts';
import type { FetchLike } from './api-client.ts';
import { installSyncTestHooks, syncTestOptions } from './e2e-hooks.ts';
import type { EngineOptions } from './engine.ts';
import type { LockManagerLike, RuntimeHost, RuntimeTimings, SyncRuntime } from './runtime.ts';
import type { SchedulerEnv } from './scheduler.ts';
import { countPendingEntries, hasSyncHint, parseSyncRecord, type SyncRecord } from './state.ts';
import {
  type SyncActivity,
  SyncError,
  type SyncErrorCode,
  type SyncService,
  type SyncState,
  type SyncStatus,
} from './types.ts';

type RuntimeModule = Pick<typeof import('./runtime.ts'), 'createRuntime'>;

export interface SyncServiceOptions {
  /** `null`: sin IndexedDB (la agenda vive en memoria): la sincronización no está disponible. */
  readonly db: GameAgendaDb | null;
  /** El MISMO reloj que la agenda de la pestaña. */
  readonly clock: HlcClock;
  /** uuidv7. */
  readonly newOpId: () => string;
  readonly notices?: NoticeCenter | null;
  readonly copyReminder?: CopyReminderStore | null;
  /** `document.cookie` por defecto. */
  readonly readCookie?: () => string;
  /** El navegador por defecto (`window`, `document`, `navigator.onLine`, temporizadores). */
  readonly env?: SchedulerEnv;
  /** `navigator.locks` por defecto. */
  readonly locks?: LockManagerLike | null;
  readonly fetch?: FetchLike;
  readonly timings?: Partial<RuntimeTimings>;
  readonly engine?: Pick<EngineOptions, 'batchSize' | 'maxRequests' | 'yieldToMain'>;
  /** Carga el motor (por defecto, `import('./runtime.ts')`). */
  readonly loadRuntime?: () => Promise<RuntimeModule>;
  /** Cuándo se lee el estado y se carga el motor al arrancar: tras el primer pintado, en un rato ocioso. */
  readonly whenStartup?: () => Promise<void>;
  readonly onError?: (error: unknown) => void;
}

/** Lo que usa `main.tsx` además de `SyncService`. */
export interface SyncController extends SyncService {
  /** Lee el estado guardado y, si está emparejado, carga el motor (ver `whenStartup`). */
  start(): void;
  /** Se resuelve cuando no hay lectura, carga, ronda ni restauración en marcha (pruebas). */
  whenIdle(): Promise<void>;
  /** Rondas correctas de esta pestaña (para los E2E). */
  readonly successes: number;
}

/** Tras el primer pintado y en un rato ocioso (o enseguida si la página está oculta). */
export function afterPaintAndIdle(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      if (typeof requestIdleCallback === 'function')
        requestIdleCallback(() => resolve(), { timeout: 3000 });
      else setTimeout(resolve, 0);
    };
    if (typeof requestAnimationFrame !== 'function') {
      go();
      return;
    }
    // Sin fotogramas (pestaña oculta), no espera a ninguno.
    const fallback = setTimeout(go, 1000);
    requestAnimationFrame(() =>
      setTimeout(() => {
        clearTimeout(fallback);
        go();
      }, 0),
    );
  });
}

function browserEnv(): SchedulerEnv {
  return {
    window,
    document,
    isOnline: () => navigator.onLine !== false,
    now: Date.now,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    random: Math.random,
  };
}

function browserLocks(): LockManagerLike | null {
  const locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;
  return locks ?? null;
}

/** El almacén de la agenda, avisando tras cada escritura que deja operaciones en la `outbox`. */
export function trackLocalWrites(storage: AgendaStorage, onWrite: () => void): AgendaStorage {
  return {
    ...storage,
    async write(batch) {
      const written = await storage.write(batch);
      if (batch.ops.length > 0) onWrite();
      return written;
    },
  };
}

function sameState(a: SyncState, b: SyncState): boolean {
  return (
    a.ready === b.ready &&
    a.status === b.status &&
    a.activity === b.activity &&
    a.error === b.error &&
    a.unpairedReason === b.unpairedReason &&
    a.deviceId === b.deviceId &&
    a.pending === b.pending &&
    a.lastSyncAt === b.lastSyncAt
  );
}

const isActive = (status: SyncStatus) => status === 'paired' || status === 'restoring';

export function createSyncService(options: SyncServiceOptions): SyncController {
  const { db } = options;
  const onError = options.onError ?? ((error: unknown) => console.error(error));
  const readCookie = options.readCookie ?? (() => document.cookie);
  const readHint = () => hasSyncHint(readCookie());
  const e2e = import.meta.env.MODE === 'e2e' ? syncTestOptions() : {};
  const timings = { ...e2e.timings, ...options.timings };

  let ready = false;
  let hint = db === null ? false : readHint();
  let record: SyncRecord | null = null;
  let activity: SyncActivity = 'idle';
  let error: SyncErrorCode | null = null;
  let pending = 0;
  let successes = 0;
  let snapshot = compute();
  const listeners = new Set<() => void>();
  const removers: Array<() => void> = [];

  let runtime: SyncRuntime | null = null;
  let loading: Promise<SyncRuntime> | null = null;
  let work: Promise<unknown> = Promise.resolve();
  /** El motor está reanudado (o se reanudará al cargar). */
  let engaged = false;
  /** La última carga del motor falló estando enganchado: la actividad lo dice (`error`). */
  let loadFailed = false;

  function compute(): SyncState {
    let status: SyncStatus;
    let unpairedReason: SyncState['unpairedReason'] = null;
    if (!ready) status = hint ? 'paired' : 'off';
    else if (record?.unpairedBy === 'server') {
      status = 'unpaired';
      unpairedReason = 'server';
    } else if (!hint) {
      status = record === null ? 'off' : 'unpaired';
      if (record !== null) unpairedReason = 'cookies';
    } else status = record === null || record.restore ? 'restoring' : 'paired';
    const active = isActive(status);
    return {
      ready,
      status,
      activity: active ? activity : 'idle',
      error: active ? error : null,
      unpairedReason,
      deviceId: record?.deviceId ?? null,
      pending: status === 'off' ? 0 : pending,
      lastSyncAt: record?.lastSyncAt ?? null,
    };
  }

  function track<T>(promise: Promise<T>): Promise<T> {
    work = Promise.allSettled([work, promise]);
    return promise;
  }

  /** Lo que no es un `SyncError` (ese ya lo ha apuntado `ensureRuntime`), al registro de errores. */
  function logUnexpected(cause: unknown): void {
    if (!(cause instanceof SyncError)) onError(cause);
  }

  /**
   * Carga el motor (una vez) y, si está enganchado, lo reanuda: también cuando lo carga otra
   * operación tras fallar la carga de `reconcile` («Sincronizar ahora»).
   */
  function ensureRuntime(): Promise<SyncRuntime> {
    if (db === null) return Promise.reject(new SyncError('unavailable'));
    loading ??= (options.loadRuntime ?? (() => import('./runtime.ts')))().then(
      (mod) => {
        const rt = mod.createRuntime(host(db));
        runtime = rt;
        if (loadFailed) {
          loadFailed = false;
          activity = 'idle';
          error = null;
          update();
        }
        if (engaged) rt.resume();
        return rt;
      },
      (cause: unknown) => {
        loading = null;
        onError(cause);
        // Sin motor no hay rondas (una pestaña vieja tras un despliegue: su *chunk* ya no está).
        // La interfaz lo dice, y «Sincronizar ahora» lo vuelve a cargar. Sin reintentos solos: con
        // un 404 fallaría siempre. (`engaged` no cambia: `update()` no vuelve a llamar aquí.)
        if (engaged) {
          loadFailed = true;
          activity = 'error';
          error = 'network';
          update();
        }
        throw new SyncError('network');
      },
    );
    return loading;
  }

  /**
   * Con el estado nuevo, el motor escucha (emparejado o restaurando) o deja de hacerlo. Solo en
   * los cambios: el motor ya sigue solo mientras tanto.
   */
  function reconcile(): void {
    if (!ready || db === null) return;
    const active = isActive(snapshot.status);
    if (active === engaged) return;
    engaged = active;
    if (!active) {
      runtime?.pause();
      return;
    }
    // Ya cargado, se reanuda; si no, al cargar (`ensureRuntime`).
    if (runtime !== null) runtime.resume();
    else void track(ensureRuntime().catch(logUnexpected));
  }

  function update(): void {
    const next = compute();
    if (!sameState(next, snapshot)) {
      snapshot = next;
      for (const listener of listeners) listener();
    }
    reconcile();
  }

  function host(database: GameAgendaDb): RuntimeHost {
    return {
      db: database,
      clock: options.clock,
      newOpId: options.newOpId,
      env: options.env ?? browserEnv(),
      locks: options.locks === undefined ? browserLocks() : options.locks,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      timings,
      ...(options.engine ? { engine: options.engine } : {}),
      notices: options.notices ?? null,
      copyReminder: options.copyReminder ?? null,
      readHint,
      getRecord: () => record,
      setRecord(next) {
        record = next;
        hint = readHint();
        update();
      },
      setActivity(nextActivity, nextError) {
        activity = nextActivity;
        error = nextError;
        update();
      },
      setPending(n) {
        pending = n;
        update();
      },
      onSuccess() {
        successes += 1;
      },
      onError,
    };
  }

  async function readRecord(): Promise<void> {
    if (db === null) return;
    const row = await db.meta.get(META_KEYS.syncState);
    const had = record !== null;
    record = parseSyncRecord(row?.value);
    hint = readHint();
    if (record !== null || hint) pending = await countPendingEntries(db);
    ready = true;
    update();
    // Sin estado y con el indicio, con el motor en marcha: han borrado IndexedDB con la app
    // abierta (CA4.3). La ronda lo restaura; que sea ya, sin esperar a otro disparador.
    if (had && record === null && hint && engaged) void track(service.syncNow());
  }

  function refreshHint(): void {
    if (!ready || db === null) return;
    const next = readHint();
    if (next === hint) return;
    hint = next;
    update();
  }

  function requireActive(): void {
    if (db === null) throw new SyncError('unavailable');
    if (!isActive(snapshot.status)) throw new SyncError('unauthorized');
  }

  const service: SyncController = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get successes() {
      return successes;
    },

    start() {
      if (db === null) {
        ready = true;
        update();
        return;
      }
      const env = options.env ?? browserEnv();
      const onVisible = () => {
        if (env.document.visibilityState === 'visible') refreshHint();
      };
      env.window.addEventListener('focus', refreshHint);
      env.document.addEventListener('visibilitychange', onVisible);
      removers.push(
        () => env.window.removeEventListener('focus', refreshHint),
        () => env.document.removeEventListener('visibilitychange', onVisible),
        onTableChange(db, 'meta', (change) => {
          if ('ids' in change && !change.ids.includes(META_KEYS.syncState)) return;
          void track(readRecord().catch(onError));
        }),
      );
      void track((options.whenStartup ?? afterPaintAndIdle)().then(readRecord).catch(onError));
      if (import.meta.env.MODE === 'e2e') {
        installSyncTestHooks({
          get state() {
            return snapshot;
          },
          get successes() {
            return successes;
          },
          syncNow: () => service.syncNow(),
          idle: () => service.whenIdle(),
        });
      }
    },

    async whenIdle() {
      for (let i = 0; i < 20; i++) {
        const current = work;
        await current;
        await runtime?.idle();
        if (current === work) return;
      }
    },

    async activate(input) {
      return (await ensureRuntime()).activate(input);
    },
    async redeemPairingCode(input) {
      await (await ensureRuntime()).redeemPairingCode(input);
    },
    async redeemRecoveryCode(input) {
      await (await ensureRuntime()).redeemRecoveryCode(input);
    },
    async createPairingCode() {
      requireActive();
      return (await ensureRuntime()).createPairingCode();
    },
    async createRecoveryCode() {
      requireActive();
      return (await ensureRuntime()).createRecoveryCode();
    },
    async listDevices() {
      requireActive();
      return (await ensureRuntime()).listDevices();
    },
    async revokeDevice(id) {
      requireActive();
      return (await ensureRuntime()).revokeDevice(id);
    },
    async deleteServerAgenda() {
      if (db === null || snapshot.status === 'off') return;
      await (await ensureRuntime()).deleteServerAgenda();
    },
    async syncNow() {
      if (db === null || !isActive(snapshot.status)) return;
      try {
        await (await ensureRuntime()).syncNow();
      } catch (cause) {
        logUnexpected(cause);
      }
    },
    async forget() {
      if (db === null || record === null) return;
      await db.meta.bulkDelete([META_KEYS.syncState, META_KEYS.syncCursor]);
      record = null;
      update();
    },
    notifyLocalWrite() {
      if (db === null || snapshot.status === 'off') return;
      runtime?.localWrite();
      void track(
        countPendingEntries(db)
          .then((n) => {
            pending = n;
            update();
          })
          .catch(onError),
      );
    },
    dispose() {
      for (const remove of removers.splice(0)) remove();
      runtime?.pause();
      listeners.clear();
    },
  };
  return service;
}
