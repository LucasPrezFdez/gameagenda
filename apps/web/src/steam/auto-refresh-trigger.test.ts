// Cuándo se pone al día Steam vinculado (ADR-014): solo sincronizando y tras una ronda buena de
// esta sesión, con «Actualizar sola» encendido, a la vista, con red y si hace 24 h (7 días sin
// vínculo). La hora se apunta antes de pedir nada.

import { STEAM_AUTO_REFRESH_MS } from '@gameagenda/core/api';
import { describe, expect, it } from 'vitest';
import { type AccountRecord, EMPTY_ACCOUNT } from '../sync/account-state.ts';
import type { SyncState } from '../sync/types.ts';
import {
  AUTO_REFRESH_MS,
  startSteamAutoRefresh,
  type TriggerEnv,
  UNLINKED_RECHECK_MS,
} from './auto-refresh-trigger.ts';

const T0 = Date.UTC(2026, 10, 26, 10);

function harness(account: Partial<AccountRecord>, state: Partial<SyncState> = {}) {
  let snapshot: SyncState = {
    ready: true,
    status: 'paired',
    activity: 'idle',
    error: null,
    unpairedReason: null,
    deviceId: 'd',
    pending: 0,
    lastSyncAt: null,
    ...state,
  };
  let record: AccountRecord = { ...EMPTY_ACCOUNT, ...account };
  const listeners = new Set<() => void>();
  const clock = { ms: T0 };
  const doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
  });
  const net = { online: true };
  let runs = 0;
  const env: TriggerEnv = {
    doc: doc as unknown as Document,
    now: () => clock.ms,
    isOnline: () => net.online,
  };
  const stop = startSteamAutoRefresh(
    {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      localAccount: async () => record,
      updateLocalAccount: async (patch) => {
        record = { ...record, ...patch };
      },
    },
    async () => {
      runs += 1;
    },
    env,
  );
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    clock,
    doc,
    net,
    stop,
    runs: () => runs,
    record: () => record,
    /** Una ronda buena de la sincronización, ahora. */
    async synced() {
      snapshot = { ...snapshot, lastSyncAt: clock.ms };
      for (const listener of listeners) listener();
      await settle();
    },
    async show() {
      doc.visibilityState = 'visible';
      doc.dispatchEvent(new Event('visibilitychange'));
      await settle();
    },
    settle,
  };
}

describe('la actualización diaria de Steam', () => {
  it('24 h, como STEAM_AUTO_REFRESH_MS de core', () => {
    expect(AUTO_REFRESH_MS).toBe(STEAM_AUTO_REFRESH_MS);
    expect(UNLINKED_RECHECK_MS).toBe(7 * AUTO_REFRESH_MS);
  });

  it('no antes de una ronda buena de esta sesión; después, una vez, y apunta la hora', async () => {
    const h = harness({ steamLinked: true }, { lastSyncAt: T0 - 1 });
    await h.settle();
    expect(h.runs()).toBe(0);
    await h.synced();
    expect(h.runs()).toBe(1);
    expect(h.record().steamCheckedAt).toBe(T0);
    // Más rondas el mismo día: nada.
    await h.synced();
    await h.show();
    expect(h.runs()).toBe(1);
    h.stop();
  });

  it('al volver a la vista pasadas 24 h, otra vez', async () => {
    const h = harness({ steamLinked: true, steamCheckedAt: T0 - 1000 });
    await h.synced();
    expect(h.runs()).toBe(0);
    h.clock.ms = T0 - 1000 + AUTO_REFRESH_MS;
    await h.show();
    expect(h.runs()).toBe(1);
    h.stop();
  });

  it('sin vínculo conocido, a la semana', async () => {
    const h = harness({ steamLinked: false, steamCheckedAt: T0 - AUTO_REFRESH_MS });
    await h.synced();
    expect(h.runs()).toBe(0);
    h.clock.ms = T0 - AUTO_REFRESH_MS + UNLINKED_RECHECK_MS;
    await h.show();
    expect(h.runs()).toBe(1);
    h.stop();
  });

  it('nada con «Actualizar sola» apagado, sin sincronizar, oculta o sin red', async () => {
    const off = harness({ steamLinked: true, steamAuto: false });
    await off.synced();
    expect(off.runs()).toBe(0);
    off.stop();

    const unpaired = harness({ steamLinked: true }, { status: 'off' });
    await unpaired.synced();
    expect(unpaired.runs()).toBe(0);
    unpaired.stop();

    const hidden = harness({ steamLinked: true });
    hidden.doc.visibilityState = 'hidden';
    await hidden.synced();
    expect(hidden.runs()).toBe(0);
    hidden.stop();

    const offline = harness({ steamLinked: true });
    offline.net.online = false;
    await offline.synced();
    expect(offline.runs()).toBe(0);
    offline.net.online = true;
    await offline.show();
    expect(offline.runs()).toBe(1);
    offline.stop();
  });
});
