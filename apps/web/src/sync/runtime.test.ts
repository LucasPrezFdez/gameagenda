// El motor tal como lo carga la fachada (`runtime.ts`), con un servidor falso: lo que guarda en
// `meta.syncState` al acabar una ronda. Los casos de punta a punta (pestañas, 401, Web Locks)
// están en `apps/web/worker/test/sync-client-lifecycle.test.ts`.
import { createHlcClock } from '@gameagenda/core/sync';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { v7 as uuidv7 } from 'uuid';
import { afterEach, describe, expect, it } from 'vitest';
import { type GameAgendaDb, META_KEYS, openDatabase } from '../db/database.ts';
import type { FetchLike } from './api-client.ts';
import { createRuntime, type LockManagerLike, type SyncRuntime } from './runtime.ts';
import type { SchedulerEnv } from './scheduler.ts';
import { newRecord, parseSyncRecord, type SyncRecord } from './state.ts';

const NOW = Date.UTC(2026, 10, 7, 12);
const open: Array<{ db: GameAgendaDb; runtime: SyncRuntime }> = [];

afterEach(async () => {
  for (const { db, runtime } of open.splice(0)) {
    await runtime.idle();
    runtime.pause();
    db.close();
  }
});

function fakeEnv(): SchedulerEnv {
  return {
    window: new EventTarget(),
    document: Object.assign(new EventTarget(), {
      visibilityState: 'visible' as DocumentVisibilityState,
    }),
    isOnline: () => true,
    now: () => NOW,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    random: () => 0.5,
  };
}

/** `/sync` sin cambios: todo al día. */
const fetchOk: FetchLike = async () =>
  new Response(
    JSON.stringify({
      cursor: 0,
      purgedSeq: 0,
      epoch: 'a1b2c3d4e5f60718',
      reset: false,
      more: false,
      serverTime: NOW,
      changes: [],
      accepted: [],
      rejected: [],
      inbox: [],
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );

/** Un Web Lock siempre libre que, al acabar cada ronda (aún dentro), ejecuta `after`. */
class AfterRound implements LockManagerLike {
  after: (() => Promise<void>) | null = null;

  async request<T>(
    name: string,
    _options: { ifAvailable?: boolean },
    callback: (lock: unknown) => Promise<T>,
  ): Promise<T> {
    const result = await callback({ name });
    const after = this.after;
    this.after = null;
    if (after !== null) await after();
    return result;
  }
}

async function setup(options: { hint: boolean; stored: SyncRecord; copy: SyncRecord }) {
  const db = openDatabase({ name: 'runtime', indexedDB: new IDBFactory(), IDBKeyRange });
  await db.meta.put({ key: META_KEYS.syncState, value: options.stored });
  const locks = new AfterRound();
  const seen = { record: options.copy as SyncRecord | null, successes: 0, errors: [] as unknown[] };
  const runtime = createRuntime({
    db,
    clock: createHlcClock({ now: () => NOW, node: 'abcdabcd' }),
    newOpId: uuidv7,
    env: fakeEnv(),
    locks,
    fetch: fetchOk,
    engine: { yieldToMain: () => Promise.resolve() },
    notices: null,
    copyReminder: null,
    readHint: () => options.hint,
    getRecord: () => seen.record,
    setRecord(next) {
      seen.record = next;
    },
    setActivity: () => undefined,
    setPending: () => undefined,
    onSuccess() {
      seen.successes += 1;
    },
    onError: (error) => seen.errors.push(error),
  });
  open.push({ db, runtime });
  const stored = async () => parseSyncRecord((await db.meta.get(META_KEYS.syncState))?.value);
  return { db, locks, runtime, seen, stored };
}

describe('meta.syncState al acabar una ronda buena', () => {
  it('parte de lo guardado, no de la copia de la fachada, que puede estar vieja', async () => {
    // Otra pestaña ya ha aprendido el id del dispositivo; la copia de esta no lo sabe.
    const s = await setup({
      hint: true,
      stored: { ...newRecord('d2', false), lastError: 'busy' },
      copy: newRecord(null, false),
    });
    s.runtime.resume();
    await s.runtime.idle();
    const expected = { ...newRecord('d2', false), lastSyncAt: NOW };
    expect(await s.stored()).toEqual(expected);
    expect(s.seen.record).toEqual(expected);
    expect(s.seen.successes).toBe(1);
  });

  it('si lo borran justo tras la ronda y sigue el indicio (IndexedDB borrada), lo vuelve a crear', async () => {
    const s = await setup({
      hint: true,
      stored: newRecord('d1', false),
      copy: newRecord('d1', false),
    });
    s.locks.after = () => s.db.meta.delete(META_KEYS.syncState);
    s.runtime.resume();
    await s.runtime.idle();
    // Ya no se sabe el id (vuelve con la lista de dispositivos), pero está emparejado.
    const expected = { ...newRecord(null, false), lastSyncAt: NOW };
    expect(await s.stored()).toEqual(expected);
    expect(s.seen.record).toEqual(expected);
  });

  it('sin el indicio (lo han quitado a propósito) no lo vuelve a crear, y corrige la copia', async () => {
    const s = await setup({
      hint: false,
      stored: newRecord('d1', false),
      copy: newRecord('d1', false),
    });
    s.locks.after = () => s.db.meta.delete(META_KEYS.syncState);
    s.runtime.resume();
    await s.runtime.idle();
    expect(await s.db.meta.get(META_KEYS.syncState)).toBeUndefined();
    expect(s.seen.record).toBeNull();
  });
});
