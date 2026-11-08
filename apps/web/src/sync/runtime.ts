// El motor de la sincronización tal como lo carga la fachada (`facade.ts`) con `import()`: el
// cliente HTTP (con Zod), la ronda (`engine.ts`), el planificador (`scheduler.ts`), el Web Lock,
// el aviso «Sincronización fallida» (§9.6), el aviso de copia (RNF-08: una ronda correcta lo
// reinicia) y las operaciones de Ajustes. Va en un *chunk* diferido: quien no sincroniza no lo
// descarga. (La app no purga lápidas por su cuenta: le llega la purga de D1 con un `reset`.)
//
// Una ronda puede acabar después de desemparejar o de borrar los datos, en esta pestaña o en otra.
// Por eso `meta.syncState` solo cambia con `updateRecord`, que relee lo guardado y no lo vuelve a
// crear si ya no está; la ronda que se encuentra sin él acaba con `aborted` y no se trata como
// buena; y borrar la agenda del servidor espera su turno en el Web Lock.
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
import { countPendingEntries, newRecord, parseSyncRecord, type SyncRecord } from './state.ts';
import {
  type ActivateInput,
  type DeviceInfo,
  type InboxSink,
  type RedeemInput,
  type SyncActivity,
  SyncError,
  type SyncErrorCode,
} from './types.ts';

/** Nombre del Web Lock: una ronda a la vez entre todas las pestañas del origen. */
export const SYNC_LOCK = 'gameagenda-sync';
/** El aviso «Sincronización fallida» sale tras estos fallos seguidos (unos 15 s reintentando). */
export const NOTICE_AFTER_FAILURES = 3;
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

/**
 * Lo que se usa de `navigator.locks`: con `ifAvailable`, `lock` es `null` si otra pestaña lo
 * tiene; sin él, espera su turno.
 */
export interface LockManagerLike {
  request<T>(
    name: string,
    options: { ifAvailable?: boolean },
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
  /** Apunta los enlaces del buzón del Atajo de iOS (`links/inbox-capture.ts`). */
  readonly inbox?: InboxSink;
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
  /** Ver `SyncService.createInboxToken`. */
  createInboxToken(label: string): Promise<{ deviceId: string; token: string }>;
  listDevices(): Promise<readonly DeviceInfo[]>;
  /** Ver `SyncService.revokeDevice`. */
  revokeDevice(id: string): Promise<{ self: boolean }>;
  /** Ver `SyncService.deleteServerAgenda` (con un 401, rechaza con `unauthorized`). */
  deleteServerAgenda(): Promise<void>;
  forget(): Promise<void>;
}

function asSyncError(error: unknown): SyncError | null {
  return error instanceof SyncError ? error : null;
}

interface UpdateOptions {
  /**
   * Si ya no hay `meta.syncState` y está el indicio, lo crea: una ronda buena prueba que el
   * dispositivo sigue emparejado (IndexedDB borrada con la app abierta, CA4.3). Sin indicio, nunca:
   * revocar este dispositivo, borrar la agenda y el 401 quitan el indicio antes que el estado.
   */
  readonly createIfHint?: boolean;
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
    ...(host.inbox ? { inbox: host.inbox } : {}),
    ...host.engine,
  });
  const scheduler = createScheduler(run, env, timings);

  let failures = 0;
  let noticeShown = false;
  let joining: Promise<void> | null = null;
  let resumed = false;
  let removeOffline: (() => void) | null = null;

  /** Ya no sincroniza: fuera el estado y el cursor. */
  async function clearRecord(): Promise<void> {
    await db.meta.bulkDelete([META_KEYS.syncState, META_KEYS.syncCursor]);
    host.setRecord(null);
  }

  /**
   * Cambia `meta.syncState` en una transacción: parte de lo guardado, no de la copia de la
   * fachada, que puede estar vieja (otra pestaña lo ha cambiado o borrado). Si ya no está, no lo
   * vuelve a crear (salvo con `createIfHint`): así una ronda que acaba tras desemparejar o borrar
   * los datos, en esta pestaña o en otra, no deja un estado nuevo. Después corrige la copia de la
   * fachada con lo que haya quedado, también `null`.
   */
  async function updateRecord(
    patch: Partial<SyncRecord>,
    { createIfHint = false }: UpdateOptions = {},
  ): Promise<void> {
    const saved = await db.transaction('rw', db.meta, async () => {
      const stored = parseSyncRecord((await db.meta.get(META_KEYS.syncState))?.value);
      const current = stored ?? (createIfHint && host.readHint() ? newRecord(null, false) : null);
      if (current === null) return null;
      const next: SyncRecord = { ...current, ...patch };
      const same =
        stored !== null &&
        (Object.keys(patch) as (keyof SyncRecord)[]).every((k) => current[k] === next[k]);
      if (!same) await db.meta.put({ key: META_KEYS.syncState, value: next });
      return next;
    });
    host.setRecord(saved);
  }

  /** 401: el servidor ya no reconoce este dispositivo (y ha quitado sus cookies). */
  async function markUnpairedByServer(): Promise<void> {
    scheduler.stop();
    await updateRecord({ unpairedBy: 'server', lastError: 'unauthorized' });
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
    // Mientras tanto se ha desemparejado (o se han borrado las cookies): ya no toca.
    if (!resumed) return BUSY;
    return attempt();
  }

  /** `fn` con el Web Lock, esperando su turno: antes acaba la ronda de otra pestaña. */
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const { locks } = host;
    return locks === null ? fn() : locks.request(SYNC_LOCK, {}, fn);
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
    await updateRecord(
      { lastSyncAt: now, lastError: null, restore: false },
      { createIfHint: true },
    );
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
      if (result.aborted) return onAborted();
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
      await updateRecord({ lastError: code }).catch(host.onError);
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

  /**
   * La ronda ha parado porque ya no está `meta.syncState` (ver `RoundResult.aborted`): no es una
   * ronda buena, así que nada de `onRoundOk`, aviso ni registro. Sin indicio, lo han quitado a
   * propósito (desemparejar, borrar los datos) y la fachada pausará el motor. Con el indicio, han
   * borrado IndexedDB con la app abierta: se restaura como al arrancar sin estado (CA4.3).
   */
  function onAborted(): RoundOutcome {
    host.setActivity('idle', null);
    if (resumed && host.readHint()) restore(() => void scheduler.syncNow());
    return { kind: 'stop' };
  }

  /** Activar, emparejar, recuperar o restaurar: todo lo local a la `outbox` y cursor a 0. */
  async function join(deviceId: string | null, restore: boolean): Promise<void> {
    const record = newRecord(deviceId, restore);
    await engine.join(record);
    host.setRecord(record);
    host.setPending(await countPendingEntries(db));
  }

  /** Indicio sin estado (CA4.3): restaura desde 0, subiendo lo que haya en local; luego, `then`. */
  function restore(then: () => void): void {
    joining ??= join(null, true)
      .then(() => {
        if (resumed) then();
      })
      .catch(host.onError)
      .finally(() => {
        joining = null;
      });
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
      if (host.getRecord() !== null) scheduler.start();
      else restore(() => scheduler.start());
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
      // Una ronda puede acabar restaurando (`onAborted`), y la restauración lanza otra ronda.
      do {
        await joining;
        await scheduler.idle();
      } while (joining !== null);
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
    createInboxToken: (label) => authed(() => api.createInboxToken(label)),
    async listDevices() {
      const { devices } = await authed(() => api.devices());
      const current = devices.find((d) => d.current);
      if (current && host.getRecord()?.deviceId === null)
        await updateRecord({ deviceId: current.id });
      return devices;
    },
    async revokeDevice(id) {
      // Desemparejar este dispositivo: sin rondas nuevas durante la llamada. La que ya esté en
      // marcha acaba, y su 401 (o su 200) tardío ya no vuelve a crear el estado (`updateRecord`).
      const mine = id === host.getRecord()?.deviceId;
      if (mine) scheduler.stop();
      try {
        await authed(() => api.revokeDevice(id));
      } catch (error) {
        if (mine && resumed && asSyncError(error)?.code !== 'unauthorized') scheduler.start();
        throw error;
      }
      // Tras restaurar no se sabe el id propio; revocarse quita el indicio.
      const self = mine || !host.readHint();
      if (self) {
        scheduler.stop();
        await clearRecord();
      }
      return { self };
    },
    async deleteServerAgenda() {
      if (host.getRecord() === null && !host.readHint()) return;
      // Ni restauración ni rondas de esta pestaña mientras tanto; la de otra acaba antes (el Web
      // Lock, esperando turno), con su respuesta aplicada. Lo que llegue después ya no se escribe:
      // falta `meta.syncState` (`aborted`) o el servidor da 401 (`updateRecord` no lo crea).
      await joining;
      scheduler.stop();
      await scheduler.idle();
      try {
        await exclusive(async () => {
          // 401: revocado desde otro dispositivo, o la agenda ya no existe. El servidor no los
          // distingue, así que no se da por borrada: queda desemparejado por el servidor y se
          // relanza (`authed`). Lo local no se toca.
          await authed(() => api.deleteAgenda());
          await clearRecord();
        });
      } catch (error) {
        if (resumed && asSyncError(error)?.code !== 'unauthorized') scheduler.start();
        throw error;
      }
    },
    async forget() {
      scheduler.stop();
      await clearRecord();
    },
  };
}
