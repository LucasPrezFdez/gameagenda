import { DEVICE_LABEL_MAX, SYNC_HINT_COOKIE } from '@gameagenda/core/api';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database.ts';
import { defaultDeviceLabel, LABEL_MAX } from './device-label.ts';
import {
  countPendingEntries,
  hasSyncHint,
  INITIAL_CURSOR,
  newRecord,
  parseSyncCursor,
  parseSyncRecord,
  SYNC_HINT,
} from './state.ts';

describe('el indicio de emparejamiento', () => {
  it('es la cookie de core con el prefijo __Host-', () => {
    expect(SYNC_HINT).toBe(`__Host-${SYNC_HINT_COOKIE}`);
  });

  it('solo cuenta con el valor 1, entre otras cookies', () => {
    expect(hasSyncHint('')).toBe(false);
    expect(hasSyncHint('__Host-ga_sync=1')).toBe(true);
    expect(hasSyncHint('a=b; __Host-ga_sync=1; c=d')).toBe(true);
    expect(hasSyncHint('a=b;__Host-ga_sync = 1 ')).toBe(true);
    expect(hasSyncHint('__Host-ga_sync=0')).toBe(false);
    expect(hasSyncHint('ga_sync=1')).toBe(false);
    expect(hasSyncHint('x__Host-ga_sync=1')).toBe(false);
  });
});

describe('lo guardado en meta', () => {
  it('meta.syncCursor solo con la forma esperada', () => {
    expect(parseSyncCursor(INITIAL_CURSOR)).toEqual(INITIAL_CURSOR);
    const value = {
      cursor: 12,
      purgedSeq: 3,
      reset: true,
      maxSeen: '1793178900000-0000-k3x9p2qa',
    };
    expect(parseSyncCursor(value)).toEqual(value);
    expect(parseSyncCursor({ ...value, cursor: -1 })).toBeNull();
    expect(parseSyncCursor({ ...value, reset: 'no' })).toBeNull();
    expect(parseSyncCursor({ ...value, maxSeen: 'nope' })).toBeNull();
    expect(parseSyncCursor(null)).toBeNull();
  });

  it('meta.syncState solo con la forma esperada', () => {
    const record = { ...newRecord('d1', false), lastSyncAt: 5, lastError: 'busy' as const };
    expect(parseSyncRecord(record)).toEqual(record);
    expect(parseSyncRecord(newRecord(null, true))).toEqual(newRecord(null, true));
    expect(parseSyncRecord({ ...record, unpairedBy: 'cookies' })).toBeNull();
    expect(parseSyncRecord({ ...record, deviceId: 5 })).toBeNull();
    expect(parseSyncRecord({ ...record, lastSyncAt: 1.5 })).toBeNull();
    expect(parseSyncRecord('x')).toBeNull();
  });

  it('un meta.syncState de antes, con lastPurgeAt, se sigue leyendo y sin ese campo', () => {
    // La app purgaba por su cuenta y lo apuntaba; ahora solo purga D1 (llega con un `reset`).
    const old = { ...newRecord('d1', false), lastSyncAt: 5, lastPurgeAt: 7 };
    expect(parseSyncRecord(old)).toEqual({ ...newRecord('d1', false), lastSyncAt: 5 });
    expect(parseSyncRecord({ ...old, lastPurgeAt: null })).toEqual(parseSyncRecord(old));
    expect(newRecord(null, true)).not.toHaveProperty('lastPurgeAt');
  });

  it('cuenta juegos con cambios pendientes, no operaciones', async () => {
    const db = openDatabase({ name: 'pending', indexedDB: new IDBFactory(), IDBKeyRange });
    const h = '1793178900000-0000-k3x9p2qa';
    await db.outbox.bulkAdd([
      { opId: 'a', entryId: 'steam:1', field: 'status', value: 'playing', hlc: h },
      { opId: 'b', entryId: 'steam:1', field: 'title', value: 'Uno', hlc: h },
      { opId: 'c', entryId: 'steam:2', field: 'note', value: '', hlc: h },
      { opId: 'd', entryId: 'steam:1', field: 'status', value: 'dropped', hlc: h },
    ]);
    expect(await countPendingEntries(db)).toBe(2);
    db.close();
  });
});

describe('nombre del dispositivo', () => {
  it('cabe en el límite del servidor', () => {
    expect(LABEL_MAX).toBe(DEVICE_LABEL_MAX);
  });

  it('se deduce del navegador y del sistema', () => {
    const cases: Array<[string, string]> = [
      [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        'Chrome en Windows',
      ],
      [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
        'Edge en Windows',
      ],
      [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
        'Safari en iPhone',
      ],
      [
        'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
        'Chrome en Android',
      ],
      [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0',
        'Firefox en macOS',
      ],
      ['curl/8.0', 'Navegador en otro sistema'],
    ];
    for (const [ua, label] of cases) expect(defaultDeviceLabel(ua)).toBe(label);
  });
});
