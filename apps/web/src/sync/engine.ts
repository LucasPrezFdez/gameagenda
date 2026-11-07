// Motor de la sincronización (§5.3 y §7.7; ADR-011): una ronda sube la `outbox` por lotes y baja
// los cambios por páginas con `POST /api/v1/sync`, y aplica cada respuesta en UNA transacción `rw`
// de Dexie (`entries`, `outbox` y `meta`). La agenda de la pestaña se entera por `storagemutated`
// (relee las entradas cambiadas) y, si tenía una escritura pendiente de la misma entrada, la
// fusiona sobre lo guardado con `merge()` (`db/agenda-storage.ts`): nada se pisa.
//
// Quien llama tiene el Web Lock (una ronda a la vez entre pestañas; ver `runtime.ts`).
import type { SyncResponse } from '@gameagenda/core/api';
import type { Entry } from '@gameagenda/core/entries';
import {
  applyOps,
  canon,
  compactOutbox,
  groupByEntry,
  type HlcClock,
  isHlc,
  isPurgeable,
  isTooFarAhead,
  maxHlc,
  merge,
  nextOffset,
  type Op,
  opsFromChanges,
  opsFromEntry,
  planReseal,
  purgeCutoff,
  resealEntry,
  resealOps,
  SYNC_BATCH_SIZE,
  takeBatch,
} from '@gameagenda/core/sync';
import { type GameAgendaDb, META_KEYS } from '../db/database.ts';
import type { SyncCall } from './api-client.ts';
import { INITIAL_CURSOR, parseSyncCursor, type SyncCursorState, type SyncRecord } from './state.ts';

/** Peticiones por ronda, como mucho: con lotes de 200, 20 000 operaciones. */
export const MAX_REQUESTS_PER_ROUND = 100;
/** Saltos de reenvío entre entradas, como `applyOps()` (ADR-004). */
const MAX_HOPS = 8;

export interface SyncTransport {
  sync(request: SyncCall): Promise<SyncResponse>;
}

export interface EngineOptions {
  readonly db: GameAgendaDb;
  readonly transport: SyncTransport;
  /** El MISMO reloj que la agenda de la pestaña (`main.tsx`). */
  readonly clock: HlcClock;
  /** uuidv7. */
  readonly newOpId: () => string;
  /** Reloj de pared en ms (`Date.now`). */
  readonly now: () => number;
  readonly batchSize?: number;
  readonly maxRequests?: number;
  /** Cede el turno entre páginas (por defecto, `scheduler.yield()` o una tarea nueva). */
  readonly yieldToMain?: () => Promise<void>;
}

export interface RoundResult {
  readonly requests: number;
  /** `false` si se llegó al tope de peticiones con trabajo pendiente: hace falta otra ronda. */
  readonly complete: boolean;
  /** Operaciones que quedan en la `outbox`. */
  readonly pending: number;
  /** Entradas cambiadas por lo que ha llegado del servidor. */
  readonly changed: number;
  /** Operaciones que se han vuelto a sellar por reloj. */
  readonly resealed: number;
}

export interface SyncEngine {
  /** Una ronda completa. Lanza `SyncError` si falla una petición (lo aplicado se queda). */
  round(): Promise<RoundResult>;
  /**
   * Al activar, emparejar, recuperar o restaurar: todas las entradas locales (lápidas incluidas) a
   * la `outbox` con `opsFromEntry()` (idempotente: la `outbox` se compacta al subir), el cursor a
   * 0 y `record` en `meta.syncState`, en una transacción. Así un dispositivo que se une a una
   * agenda con entradas suyas las fusiona en vez de perderlas.
   */
  join(record: SyncRecord): Promise<void>;
  /**
   * Purga local (§7.7): las lápidas de más de 90 días y los esqueletos sin cambios en 90 días que
   * no estén en la `outbox`, con el criterio del servidor. Devuelve cuántas entradas ha borrado.
   */
  purge(): Promise<number>;
  /** Operaciones en la `outbox`. */
  pending(): Promise<number>;
}

/** Cede el turno al navegador: nada de tareas largas entre páginas (§9.5). */
export function yieldToMain(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof s?.yield === 'function') return s.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * ¿Misma entrada, también en los valores? `sameEntry` de la agenda solo mira las HLC (cada una es de
 * una sola acción), pero aquí se compara todo: cuesta poco y no depende de esa suposición.
 */
function sameContent(a: Entry | undefined, b: Entry): boolean {
  return a !== undefined && (a === b || canon(a) === canon(b));
}

interface Applied {
  readonly state: SyncCursorState;
  readonly pageCursor: number;
  readonly seen: Set<string> | null;
  readonly pending: number;
  readonly changed: number;
  readonly resealed: number;
}

export function createSyncEngine(options: EngineOptions): SyncEngine {
  const { db, transport, clock, newOpId, now } = options;
  const batchSize = options.batchSize ?? SYNC_BATCH_SIZE;
  const maxRequests = options.maxRequests ?? MAX_REQUESTS_PER_ROUND;
  const pause = options.yieldToMain ?? yieldToMain;

  async function readCursor(): Promise<SyncCursorState> {
    const row = await db.meta.get(META_KEYS.syncCursor);
    return parseSyncCursor(row?.value) ?? INITIAL_CURSOR;
  }

  /** Compacta la `outbox` (borra lo que sobra) y toma el primer lote, sin partir acciones. */
  function nextBatch(): Promise<Op[]> {
    return db.transaction('rw', db.outbox, async () => {
      const all = await db.outbox.toArray();
      const { keep, drop } = compactOutbox(all);
      if (drop.length > 0) await db.outbox.bulkDelete(drop.map((o) => o.opId));
      return takeBatch(keep, batchSize);
    });
  }

  /**
   * Vuelve a sellar las acciones rechazadas por reloj y, de paso, todas las de la `outbox` que van
   * más de 5 min por delante con el desfase ya corregido (si no, cada lote siguiente se rechazaría
   * igual). Cambia la `outbox` y las entradas con esas HLC. Devuelve cuántas operaciones cambian.
   */
  async function reseal(rejected: readonly Op[]): Promise<number> {
    const outbox = await db.outbox.toArray();
    const old = new Set(rejected.map((o) => o.hlc));
    const nowMs = now();
    for (const o of outbox) {
      if (isHlc(o.hlc) && isTooFarAhead(o.hlc, nowMs, clock.offset)) old.add(o.hlc);
    }
    const lowest = [...old].sort()[0];
    if (lowest === undefined) return 0;
    // Cualquier entrada con una de esas HLC tiene un `lastHlc` igual o mayor.
    const entries = await db.entries.where('lastHlc').aboveOrEqual(lowest).toArray();
    // Las HLC nuevas, por delante de lo legítimo que tengan esas entradas.
    const legit = maxHlc(
      entries
        .flatMap((e) => Object.values(e.hlc))
        .filter((h) => !old.has(h) && isHlc(h) && !isTooFarAhead(h, nowMs, clock.offset)),
    );
    if (isHlc(legit)) clock.receive(legit);
    const plan = planReseal(old, () => clock.next());
    const ops = resealOps(outbox, plan);
    if (ops.length > 0) await db.outbox.bulkPut(ops);
    const fixed: Entry[] = [];
    for (const e of entries) {
      const out = resealEntry(e, plan);
      if (out !== null) fixed.push(out);
    }
    if (fixed.length > 0) await db.entries.bulkPut(fixed);
    return ops.length;
  }

  /**
   * Fusiona los cambios con `applyOps()` de core sobre lo guardado (LWW, Platinado ⇒ Completado y
   * reenvío de los manuales vinculados, siguiendo los reenvíos a entradas que haya que leer).
   * Las derivadas NO van a la `outbox`: el servidor ya las ha calculado con la misma `applyOps()`
   * sobre su estado, que cumple las reglas tras cada petición (CA4.1), y lo que esta réplica tenga
   * pendiente lo sube su `outbox`, y el servidor vuelve a derivar al aplicarlo.
   */
  async function mergeChanges(
    changes: SyncResponse['changes'],
    rebuild: ReadonlySet<string>,
  ): Promise<number> {
    if (changes.length === 0) return 0;
    const ops = opsFromChanges(changes, newOpId);
    const pendingOps = rebuild.size > 0 ? await pendingByEntry() : null;
    const stored = new Map<string, Entry>();
    const base = new Map<string, Entry>();
    const loaded = new Set<string>();
    let toLoad = [...new Set(ops.map((o) => o.entryId))];
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const rows = await db.entries.bulkGet(toLoad);
      toLoad.forEach((id, i) => {
        loaded.add(id);
        const row = rows[i];
        if (row !== undefined) stored.set(id, row);
        const start = pendingOps !== null && rebuild.has(id) ? rebuilt(id, pendingOps) : row;
        if (start !== undefined) base.set(id, start);
      });
      const { entries } = applyOps((id) => base.get(id), ops, newOpId);
      toLoad = [...entries.keys()].filter((id) => !loaded.has(id));
      if (toLoad.length > 0) continue;
      const changed: Entry[] = [];
      for (const [id, e] of entries) if (!sameContent(stored.get(id), e)) changed.push(e);
      if (changed.length > 0) await db.entries.bulkPut(changed);
      return changed.length;
    }
    throw new Error('sync: demasiados saltos de reenvío');
  }

  /** Las operaciones de la `outbox`, por entrada. */
  async function pendingByEntry(): Promise<Map<string, Op[]>> {
    return groupByEntry(await db.outbox.toArray());
  }

  /**
   * En un `reset`, una entrada empieza solo con lo que tiene pendiente en la `outbox` (y encima
   * va lo que mande el servidor): lo demás ya lo tenía el servidor o lo ha purgado. Si se
   * conservara la entrada local entera, una lápida purgada que esta réplica tocó sin red
   * resucitaría aquí y en el servidor quedaría como esqueleto.
   */
  function rebuilt(id: string, pending: ReadonlyMap<string, Op[]>): Entry | undefined {
    const ops = pending.get(id);
    return ops === undefined ? undefined : merge(undefined, ops, newOpId).entry;
  }

  /** D1 vuelto atrás (cursor menor sin `reset`): todo lo local otra vez a la `outbox`. */
  async function reuploadAll(): Promise<void> {
    const entries = await db.entries.toArray();
    const ops = entries.flatMap((e) => opsFromEntry(e, newOpId));
    if (ops.length > 0) await db.outbox.bulkAdd(ops);
  }

  /**
   * Fin de un `reset`: fuera lo que el servidor ya no tiene (una copia vieja no resucita lo
   * borrado), salvo lo que sigue en la `outbox`, que se queda solo con eso: es lo que tendrá el
   * servidor cuando lo suba.
   */
  async function dropUnseen(seen: ReadonlySet<string>): Promise<void> {
    const pending = await pendingByEntry();
    const rows = await db.entries.toArray();
    const gone: string[] = [];
    const kept: Entry[] = [];
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      const entry = rebuilt(row.id, pending);
      if (entry === undefined) gone.push(row.id);
      else if (!sameContent(row, entry)) kept.push(entry);
    }
    if (gone.length > 0) await db.entries.bulkDelete(gone);
    if (kept.length > 0) await db.entries.bulkPut(kept);
  }

  function apply(
    batch: readonly Op[],
    sent: SyncCall,
    response: SyncResponse,
    sample: { sentAt: number; receivedAt: number },
    state: SyncCursorState,
    seenBefore: Set<string> | null,
  ): Promise<Applied> {
    return db.transaction('rw', db.entries, db.outbox, db.meta, async () => {
      // 1. Fuera de la `outbox` lo aceptado (ganara o no) y lo rechazado por inválido, si sigue
      //    siendo lo que se envió.
      const byId = new Map(batch.map((o) => [o.opId, o]));
      const done = new Set(response.accepted);
      const clockRejected: Op[] = [];
      for (const r of response.rejected) {
        const o = batch[r.index];
        if (o === undefined) continue;
        if (r.reason === 'invalid') done.add(o.opId);
        else clockRejected.push(o);
      }
      const ids = [...done].filter((id) => byId.has(id));
      const stored = await db.outbox.bulkGet(ids);
      const remove = ids.filter((id, i) => stored[i]?.hlc === byId.get(id)?.hlc);
      if (remove.length > 0) await db.outbox.bulkDelete(remove);

      // 2. El reloj: desfase con `serverTime` y todo lo visto del servidor.
      clock.setOffset(nextOffset(clock.offset, { ...sample, serverTime: response.serverTime }));
      const maxSeen = maxHlc([state.maxSeen, ...response.changes.map((c) => c.hlc)]);
      if (isHlc(maxSeen)) clock.receive(maxSeen);

      // 3. Volver a sellar lo rechazado por reloj (con el desfase ya corregido).
      const resealed = clockRejected.length > 0 ? await reseal(clockRejected) : 0;

      // 4. Los cambios. Con `reset`, empiezan desde 0: se cuentan las entradas vistas, y cada una
      //    se reconstruye la primera vez que llega (ver `rebuilt`).
      let reset = state.reset || response.reset;
      let seen = response.reset ? new Set<string>() : seenBefore;
      const firstSeen = new Set<string>();
      if (reset) {
        seen ??= new Set();
        for (const c of response.changes) {
          if (!seen.has(c.entryId)) firstSeen.add(c.entryId);
          seen.add(c.entryId);
        }
      }
      const changed = await mergeChanges(response.changes, firstSeen);

      // 5. El cursor. Menor que el enviado sin `reset`: D1 ha vuelto atrás y no tiene lo nuestro.
      if (!reset && response.cursor < sent.cursor) await reuploadAll();
      if (reset && !response.more && seen !== null) {
        await dropUnseen(seen);
        reset = false;
        seen = null;
      }
      const next: SyncCursorState = {
        // A medias de un `reset`, la ronda siguiente vuelve a empezar desde 0.
        cursor: reset ? 0 : response.cursor,
        purgedSeq: response.purgedSeq,
        reset,
        maxSeen,
      };
      await db.meta.bulkPut([
        { key: META_KEYS.syncCursor, value: next },
        { key: META_KEYS.hlcClock, value: clock.snapshot() },
      ]);
      const pending = await db.outbox.count();
      return { state: next, pageCursor: response.cursor, seen, pending, changed, resealed };
    });
  }

  return {
    async round() {
      let state = await readCursor();
      let pageCursor = state.reset ? 0 : state.cursor;
      let seen: Set<string> | null = state.reset ? new Set() : null;
      let requests = 0;
      let changed = 0;
      let resealed = 0;
      let pending = 0;
      while (requests < maxRequests) {
        const batch = await nextBatch();
        const sent: SyncCall = { cursor: pageCursor, purgedSeq: state.purgedSeq, ops: batch };
        const sentAt = now();
        const response = await transport.sync(sent);
        const receivedAt = now();
        requests += 1;
        const applied = await apply(batch, sent, response, { sentAt, receivedAt }, state, seen);
        ({ state, pageCursor, seen, pending } = applied);
        changed += applied.changed;
        resealed += applied.resealed;
        if (!response.more && pending === 0) {
          return { requests, complete: true, pending, changed, resealed };
        }
        await pause();
      }
      return { requests, complete: false, pending, changed, resealed };
    },

    join(record) {
      return db.transaction('rw', db.entries, db.outbox, db.meta, async () => {
        const entries = await db.entries.toArray();
        const ops = entries.flatMap((e) => opsFromEntry(e, newOpId));
        if (ops.length > 0) await db.outbox.bulkAdd(ops);
        await db.meta.bulkPut([
          { key: META_KEYS.syncCursor, value: INITIAL_CURSOR },
          { key: META_KEYS.syncState, value: record },
        ]);
      });
    },

    purge() {
      return db.transaction('rw', db.entries, db.outbox, async () => {
        const cutoff = purgeCutoff(now() + clock.offset);
        // Lo que sigue en la `outbox` no se purga: aún no lo tiene el servidor.
        const keep = await pendingByEntry();
        const victims = (await db.entries
          .filter((e) => !keep.has(e.id) && isPurgeable(e, cutoff))
          .primaryKeys()) as string[];
        if (victims.length > 0) await db.entries.bulkDelete(victims);
        return victims.length;
      });
    },

    pending: () => db.outbox.count(),
  };
}
