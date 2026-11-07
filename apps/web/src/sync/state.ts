// Estado de la sincronización guardado en `meta` (§7.2 y §7.7) y el indicio de emparejamiento.
// Sin Zod: lo lee la fachada, en el *chunk* inicial. Lo que no tiene la forma esperada se trata
// como ausente (como `clockSnapshotOf` con `meta.hlcClock`).
import { isHlc } from '@gameagenda/core/sync';
import type { GameAgendaDb } from '../db/database.ts';
import type { SyncErrorCode } from './types.ts';

/**
 * Juegos con cambios sin subir: entradas distintas en la `outbox` (solo lee las claves del índice
 * `[entryId+field]`). Es lo que cuenta el aviso «No hemos podido sincronizar N cambios»: apuntar
 * un juego son varias operaciones, pero para quien lo lee es un cambio.
 */
export async function countPendingEntries(db: GameAgendaDb): Promise<number> {
  const keys = (await db.outbox.orderBy('[entryId+field]').keys()) as unknown as [string, string][];
  let count = 0;
  let last: string | null = null;
  for (const [entryId] of keys) {
    if (entryId !== last) count += 1;
    last = entryId;
  }
  return count;
}

/**
 * Nombre del indicio en `document.cookie`: `__Host-` + `SYNC_HINT_COOKIE` de
 * `@gameagenda/core/api` (aquí escrito a mano para no arrastrar Zod; una prueba lo compara).
 */
export const SYNC_HINT = '__Host-ga_sync';

/** ¿Está el indicio `__Host-ga_sync=1`? Vive y muere con la credencial `HttpOnly` (ADR-011). */
export function hasSyncHint(cookie: string): boolean {
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SYNC_HINT && part.slice(eq + 1).trim() === '1') return true;
  }
  return false;
}

/** `meta.syncCursor`: por dónde va la bajada (§7.7). */
export interface SyncCursorState {
  /** La `seq` del servidor hasta la que ya se tienen los cambios (0 en modo `reset`). */
  readonly cursor: number;
  /** El `purgedSeq` de la última respuesta: va en la petición siguiente. */
  readonly purgedSeq: number;
  /**
   * Modo `reset` a medias: la ronda siguiente vuelve a bajar desde 0 y, al acabar las páginas,
   * borra las entradas que el servidor no ha mandado y no están en la `outbox`.
   */
  readonly reset: boolean;
  /**
   * La mayor HLC recibida del servidor (`''` si ninguna). El reloj la vuelve a recibir tras
   * corregir el desfase: así lo que se vuelve a sellar va por delante de todo lo que el servidor
   * pueda tener, aunque bajar la parte física del reloj la hubiera dejado atrás.
   */
  readonly maxSeen: string;
}

export const INITIAL_CURSOR: SyncCursorState = {
  cursor: 0,
  purgedSeq: 0,
  reset: false,
  maxSeen: '',
};

const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isTimeOrNull = (v: unknown): v is number | null => v === null || isCount(v);

export function parseSyncCursor(value: unknown): SyncCursorState | null {
  if (typeof value !== 'object' || value === null) return null;
  const { cursor, purgedSeq, reset, maxSeen } = value as Record<string, unknown>;
  if (!isCount(cursor) || !isCount(purgedSeq) || typeof reset !== 'boolean') return null;
  if (maxSeen !== '' && !isHlc(maxSeen)) return null;
  return { cursor, purgedSeq, reset, maxSeen: maxSeen as string };
}

/** `meta.syncState`: este navegador está (o estaba) emparejado. */
export interface SyncRecord {
  /** Id del dispositivo en el servidor; `null` tras restaurar (se aprende con la lista). */
  readonly deviceId: string | null;
  /** Restauración desde 0 sin acabar (CA4.3): el estado es `restoring` hasta la primera ronda buena. */
  readonly restore: boolean;
  readonly lastSyncAt: number | null;
  readonly lastError: SyncErrorCode | null;
  /** El servidor respondió 401: desemparejado por el servidor (ver `SyncState.unpairedReason`). */
  readonly unpairedBy: 'server' | null;
  /** Última purga local de lápidas y esqueletos (como mucho una al día). */
  readonly lastPurgeAt: number | null;
}

export function newRecord(deviceId: string | null, restore: boolean): SyncRecord {
  return {
    deviceId,
    restore,
    lastSyncAt: null,
    lastError: null,
    unpairedBy: null,
    lastPurgeAt: null,
  };
}

export function parseSyncRecord(value: unknown): SyncRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const { deviceId, restore, lastSyncAt, lastError, unpairedBy, lastPurgeAt } = v;
  if (deviceId !== null && typeof deviceId !== 'string') return null;
  if (typeof restore !== 'boolean') return null;
  if (!isTimeOrNull(lastSyncAt) || !isTimeOrNull(lastPurgeAt)) return null;
  if (lastError !== null && typeof lastError !== 'string') return null;
  if (unpairedBy !== null && unpairedBy !== 'server') return null;
  return {
    deviceId,
    restore,
    lastSyncAt,
    lastError: lastError as SyncErrorCode | null,
    unpairedBy,
    lastPurgeAt,
  };
}
