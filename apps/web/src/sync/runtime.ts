// El motor de la sincronización tal como lo carga la fachada (`facade.ts`) con `import()`: el
// cliente HTTP (con Zod), la ronda (`engine.ts`), el planificador (`scheduler.ts`), el Web Lock,
// el aviso «Sincronización fallida» (§9.6), el aviso de copia (RNF-08: una ronda correcta lo
// reinicia), la purga local diaria (§7.7) y las operaciones de Ajustes. Va en un *chunk* diferido:
// quien no sincroniza no lo descarga.
import { parseCode } from '@gameagenda/core/api';
import type { HlcClock } from '@gameagenda/core/sync';
import type { CopyReminderStore } from '../data/copy-reminder.ts';
import { type GameAgendaDb, META_KEYS } from '../db/database.ts';
import { es } from '../i18n/es.ts';
import type { NoticeCenter } from '../notices/notice-center.ts';
import { createApiClient, type FetchLike, type SyncApi } from './api-client.ts';
import { createSyncEngine, type EngineOptions, type RoundResult } from './engine.ts';
import {
  createScheduler,
  DEFAULT_TIMINGS,
  type RoundOutcome,
  type SchedulerEnv,
  type SchedulerTimings,
  type SyncTrigger,
} from './scheduler.ts';
import { countPendingEntries, newRecord, type SyncRecord } from './state.ts';
import {
  type ActivateInput,
  type DeviceInfo,
  type RedeemInput,
  type SyncActivity,
  SyncError,
  type SyncErrorCode,
} from './types.ts';

/** Nombre del Web Lock: una ronda a la vez entre todas las pestañas del origen. */
export const SYNC_LOCK = 'gameagenda-sync';
/** El aviso «Sincronización fallida» sale tras estos fallos seguidos (unos 15 s reintentando). */
export const NOTICE_AFTER_FAILURES = 3;
/** Purga local, como mucho una vez al día. */
const PURGE_EVERY_MS = 86_400_000;
/** El aviso de copia se reinicia como mucho cada hora (cada reinicio escribe `meta`). */
const COPY_EVERY_MS = 3_600_000;
/** Errores tras los que se reintenta con espera exponencial. */
const RETRYABLE: ReadonlySet<SyncErrorCode> = new Set([
  'rate_limited',
  'busy',
  'internal',
  'network',
  'bad_response',
  'storage',
]);

/** Lo que se usa de `navigator.locks`. */
export interface LockManagerLike {
  request<T>(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown) => Promise<T>,
  ): Promise<T>;
}

export interface RuntimeTimings extends SchedulerTimings {
  /** Si otra pestaña tiene el Web Lock, se reintenta una vez pasado esto. */
  readonly lockRetryMs: number;
}

export const DEFAULT_RUNTIME_TIMINGS: RuntimeTimings = { ...DEFAULT_TIMINGS, lockRetryMs: 1500 };

export interface RuntimeHost {
  readonly db: GameAgendaDb;
  /** El MISMO reloj que la agenda de la pestaña. */
  readonly clock: HlcClock;
  readonly newOpId: () => string;
  readonly env: SchedulerEnv;
  /** `navigator.locks`, o `null` si el navegador no lo tiene (entonces, sin candado). */
  readonly locks: LockManagerLike | null;
  /** Por defecto, `fetch` del navegador. */
  readonly fetch?: FetchLike;
  readonly timings?: Partial<RuntimeTimings>;
  /** Tamaño de lote y demás (pruebas). */
  readonly engine?: Pick<EngineOptions, 'batchSize' | 'maxRequests' | 'yieldToMain'>;
  readonly notices: NoticeCenter | null;
  readonly copyReminder: CopyReminderStore | null;
  readHint(): boolean;
  getRecord(): SyncRecord | null;
  /** `meta.syncState` ya guardado (o borrado): la fachada recalcula el estado. */
  setRecord(record: SyncRecord | null): void;
  setActivity(activity: SyncActivity, error: SyncErrorCode | null): void;
  setPending(pending: number): void;
  /** Una ronda correcta (contador de los E2E). */
  onSuccess(result: RoundResult): void;
  /** Errores que no son de la micro-API (IndexedDB): al registro de errores. */
  onError(error: unknown): void;
}

export interface SyncRuntime {
  /** Emparejado (o restaurando): escucha los disparadores y sincroniza; sin estado, restaura. */
  resume(): void;
  /** Ya no está emparejado: deja de escuchar (la ronda en marcha acaba). */
  pause(): void;
  syncNow(): Promise<void>;
  localWrite(): void;
  /** Se resuelve cuando no hay ronda ni restauración en marcha. */
  idle(): Promise<void>;
  activate(input: ActivateInput): Promise<{ recoveryCode: string }>;
  redeemPairingCode(input: RedeemInput): Promise<void>;
  redeemRecoveryCode(input: RedeemInput): Promise<void>;
  createPairingCode(): Promise<{ code: string; expiresAt: string }>;
  createRecoveryCode(): Promise<{ recoveryCode: string }>;
  listDevices(): Promise<readonly DeviceInfo[]>;
  revokeDevice(id: string): Promise<{ self: boolean }>;
  deleteServerAgenda(): Promise<void>;
  forget(): Promise<void>;
}

function asSyncError(error: unknown): SyncError | null {
  return error instanceof SyncError ? error : null;
}

const BUSY = Symbol('busy');

export function createRuntime(host: RuntimeHost): SyncRuntime {
  const { db, env } = host;
  const timings: RuntimeTimings = { ...DEFAULT_RUNTIME_TIMINGS, ...host.timings };
  const api: SyncApi = createApiClient(host.fetch ? { fetch: host.fetch } : {});
  const engine = createSyncEngine({
    db,
    transport: api,
    clock: host.clock,
    newOpId: host.newOpId,
    now: env.now,
    ...host.engine,
  });
  const scheduler = createScheduler(run, env, timings);

  let failures = 0;
  let noticeShown = false;
  let joining: Promise<void> | null = null;
  let resumed = false;
  let removeOffline: (() => void) | null = null;

  async function saveRecord(record: SyncRecord | null): Promise<void> {
    if (record === null) await db.meta.bulkDelete([META_KEYS.syncState, META_KEYS.syncCursor]);
    else await db.meta.put({ key: META_KEYS.syncState, value: record });
    host.setRecord(record);
  }

  async function patchRecord(patch: Partial<SyncRecord>): Promise<void> {
    const current = host.getRecord();
    if (current === null) return;
    const next = { ...current, ...patch };
    const changed = (Object.keys(patch) as (keyof SyncRecord)[]).some(
      (k) => current[k] !== next[k],
    );
    if (changed) await saveRecord(next);
  }

  async function markUnpairedByServer(): Promise<void> {
    scheduler.stop();
    const current = host.getRecord() ?? newRecord(null, false);
    await saveRecord({ ...current, unpairedBy: 'server', lastError: 'unauthorized' });
    host.setActivity('idle', null);
  }

  /** Una operación con la cookie: un 401 deja el dispositivo desemparejado por el servidor. */
  async function authed<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (asSyncError(error)?.code === 'unauthorized') await markUnpairedByServer();
      throw error;
    }
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => env.setTimeout(resolve, ms));
  }

  /** La ronda dentro del Web Lock (si lo hay). Otra pestaña lo tiene: se reintenta una vez. */
  async function locked(): Promise<RoundResult | typeof BUSY> {
    const { locks } = host;
    if (locks === null) return engine.round();
    const attempt = () =>
      locks.request(SYNC_LOCK, { ifAvailable: true }, async (lock) =>
        lock === null ? BUSY : engine.round(),
      );
    const first = await attempt();
    if (first !== BUSY || env.document.visibilityState !== 'visible') return first;
    // Puede que la otra pestaña leyera la `outbox` antes de nuestra escritura.
    await wait(timings.lockRetryMs);
    return attempt();
  }

  async function notifyFailure(): Promise<void> {
    failures += 1;
    const { notices } = host;
    if (failures < NOTICE_AFTER_FAILURES || noticeShown || notices === null) return;
    // No tapa un aviso a la vista (Deshacer, por ejemplo): saldrá con el siguiente fallo.
    if (notices.getSnapshot() !== null) return;
    noticeShown = true;
    notices.notify(es.sync.failed(await countPendingEntries(db)), {
      actions: [{ label: es.sync.retryNow, run: () => void scheduler.syncNow() }],
    });
  }

  async function onRoundOk(result: RoundResult): Promise<void> {
    const now = env.now();
    failures = 0;
    noticeShown = false;
    const record = host.getRecord();
    let lastPurgeAt = record?.lastPurgeAt ?? null;
    if (lastPurgeAt === null || now - lastPurgeAt >= PURGE_EVERY_MS) {
      // Si falla, la ronda sigue siendo buena: se intentará con la siguiente.
      try {
        await engine.purge();
        lastPurgeAt = now;
      } catch (error) {
        host.onError(error);
      }
    }
    await patchRecord({ lastSyncAt: now, lastError: null, restore: false, lastPurgeAt });
    const copy = host.copyReminder;
    const lastCopy = copy?.getSnapshot()?.lastCopy ?? null;
    if (copy && (lastCopy === null || now - lastCopy >= COPY_EVERY_MS)) copy.copied(now);
    host.setPending(result.pending === 0 ? 0 : await countPendingEntries(db));
    host.setActivity('idle', null);
    host.onSuccess(result);
  }

  async function run(trigger: SyncTrigger): Promise<RoundOutcome> {
    try {
      if (trigger === 'hidden' && (await engine.pending()) === 0) return { kind: 'skipped' };
      if (!env.isOnline()) {
        host.setActivity('offline', 'network');
        return { kind: 'offline' };
      }
      host.setActivity('syncing', null);
      const result = await locked();
      if (result === BUSY) {
        host.setActivity('idle', null);
        return { kind: 'skipped' };
      }
      await onRoundOk(result);
      return { kind: 'ok', complete: result.complete };
    } catch (error) {
      const known = asSyncError(error);
      if (known === null) host.onError(error);
      const code: SyncErrorCode = known?.code ?? 'storage';
      try {
        host.setPending(await countPendingEntries(db));
      } catch {
        // Si IndexedDB tampoco contesta a esto, el número de antes vale.
      }
      if (code === 'unauthorized') {
        await markUnpairedByServer();
        return { kind: 'unpaired' };
      }
      if (code === 'network' && !env.isOnline()) {
        host.setActivity('offline', 'network');
        return { kind: 'offline' };
      }
      await patchRecord({ lastError: code }).catch(host.onError);
      if (code === 'sync_disabled') {
        host.setActivity('disabled', code);
        return { kind: 'stop' };
      }
      host.setActivity('error', code);
      await notifyFailure();
      return RETRYABLE.has(code) || (known?.status ?? 0) >= 500
        ? { kind: 'retry' }
        : { kind: 'stop' };
    }
  }

  /** Activar, emparejar, recuperar o restaurar: todo lo local a la `outbox` y cursor a 0. */
  async function join(deviceId: string | null, restore: boolean): Promise<void> {
    const record = newRecord(deviceId, restore);
    await engine.join(record);
    host.setRecord(record);
    host.setPending(await countPendingEntries(db));
  }

  async function redeem(kind: 'pairing' | 'recovery', input: RedeemInput): Promise<void> {
    const code = parseCode(input.code);
    if (code === null) throw new SyncError('invalid_code');
    const body = { code, label: input.label };
    const { deviceId } =
      kind === 'pairing' ? await api.redeemPairing(body) : await api.redeemRecovery(body);
    await join(deviceId, false);
  }

  function watchOffline(): void {
    if (removeOffline !== null) return;
    const onOffline = () => host.setActivity('offline', 'network');
    env.window.addEventListener('offline', onOffline);
    removeOffline = () => env.window.removeEventListener('offline', onOffline);
  }

  return {
    resume() {
      if (resumed) return;
      resumed = true;
      watchOffline();
      if (!env.isOnline()) host.setActivity('offline', 'network');
      if (host.getRecord() !== null) {
        scheduler.start();
        return;
      }
      // Indicio sin estado (CA4.3): restaurar desde 0, subiendo lo que haya en local.
      joining ??= join(null, true)
        .then(() => {
          if (resumed) scheduler.start();
        })
        .catch(host.onError)
        .finally(() => {
          joining = null;
        });
    },
    pause() {
      resumed = false;
      scheduler.stop();
      removeOffline?.();
      removeOffline = null;
    },
    syncNow: () => scheduler.syncNow(),
    localWrite: () => scheduler.localWrite(),
    async idle() {
      await joining;
      await scheduler.idle();
    },

    async activate({ label, minAge }) {
      const { deviceId, recoveryCode } = await api.createAgenda({ minAge, label });
      await join(deviceId, false);
      return { recoveryCode };
    },
    redeemPairingCode: (input) => redeem('pairing', input),
    redeemRecoveryCode: (input) => redeem('recovery', input),
    createPairingCode: () => authed(() => api.createPairing()),
    createRecoveryCode: () => authed(() => api.createRecovery()),
    async listDevices() {
      const { devices } = await authed(() => api.devices());
      const current = devices.find((d) => d.current);
      if (current && host.getRecord()?.deviceId === null)
        await patchRecord({ deviceId: current.id });
      return devices;
    },
    async revokeDevice(id) {
      await authed(() => api.revokeDevice(id));
      const self = id === host.getRecord()?.deviceId || !host.readHint();
      if (self) {
        scheduler.stop();
        await saveRecord(null);
      }
      return { self };
    },
    async deleteServerAgenda() {
      if (host.getRecord() === null && !host.readHint()) return;
      scheduler.stop();
      await scheduler.idle();
      try {
        await api.deleteAgenda();
      } catch (error) {
        // 401: la agenda ya no existe o el dispositivo no está emparejado; no queda nada que borrar.
        if (asSyncError(error)?.code !== 'unauthorized') {
          if (resumed) scheduler.start();
          throw error;
        }
      }
      await saveRecord(null);
    },
    async forget() {
      scheduler.stop();
      await saveRecord(null);
    },
  };
}
