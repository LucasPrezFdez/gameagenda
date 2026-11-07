import { describe, expect, it } from 'vitest';
import type { SyncState } from '../../sync/types.ts';
import { emptyTextOf, SYNCED_EMPTY_TEXTS, syncedEmptyState } from './restore-notice.ts';

function state(patch: Partial<SyncState>): SyncState {
  return {
    ready: true,
    status: 'off',
    activity: 'idle',
    error: null,
    unpairedReason: null,
    deviceId: null,
    pending: 0,
    lastSyncAt: null,
    ...patch,
  };
}

describe('Mi lista vacía con la agenda sincronizada llegando (CA4.3)', () => {
  it('sin sincronizar o desemparejada, el estado vacío de siempre', () => {
    for (const s of [
      state({ status: 'off' }),
      state({ status: 'off', ready: false }),
      state({ status: 'unpaired', unpairedReason: 'cookies' }),
    ]) {
      expect(syncedEmptyState(s)).toBe(false);
      expect(emptyTextOf(s)).toBe('empty');
    }
  });

  it('restaurando: la trae, sin red llegará, y con un error lo seguirá intentando', () => {
    expect(emptyTextOf(state({ status: 'restoring' }))).toBe('restoring');
    expect(emptyTextOf(state({ status: 'restoring', activity: 'syncing' }))).toBe('restoring');
    expect(emptyTextOf(state({ status: 'restoring', activity: 'offline' }))).toBe(
      'restoringOffline',
    );
    expect(emptyTextOf(state({ status: 'restoring', activity: 'error' }))).toBe('restoringFailed');
    expect(emptyTextOf(state({ status: 'restoring', activity: 'disabled' }))).toBe(
      'restoringFailed',
    );
  });

  it('con el indicio y antes de leer el estado, ya dice que la trae', () => {
    expect(emptyTextOf(state({ status: 'paired', ready: false }))).toBe('restoring');
    expect(syncedEmptyState(state({ status: 'paired', ready: false }))).toBe(true);
  });

  it('emparejada con su estado y sin juegos, de verdad está vacía', () => {
    expect(emptyTextOf(state({ status: 'paired' }))).toBe('empty');
    expect(syncedEmptyState(state({ status: 'paired' }))).toBe(true);
  });

  it('todos los textos posibles se reservan en la misma celda', () => {
    for (const s of [
      state({ status: 'paired' }),
      state({ status: 'restoring', activity: 'offline' }),
      state({ status: 'restoring', activity: 'error' }),
      state({ status: 'paired', ready: false }),
    ]) {
      expect(SYNCED_EMPTY_TEXTS).toContain(emptyTextOf(s));
    }
  });
});
