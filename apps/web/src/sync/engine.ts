// Motor de la sincronización (§5.3 y §7.7; ADR-011): una ronda sube la `outbox` por lotes y baja
// los cambios por páginas con `POST /api/v1/sync`, y aplica cada respuesta en UNA transacción `rw`
// de Dexie (`entries`, `outbox` y `meta`). La agenda de la pestaña se entera por `storagemutated`
// (relee las entradas cambiadas) y, si tenía una escritura pendiente de la misma entrada, la
// fusiona sobre lo guardado con `merge()` (`db/agenda-storage.ts`): nada se pisa.
//
// El buzón del Atajo de iOS (CA4.5) llega en la última página de cada respuesta: la ronda apunta sus
// enlaces con `options.inbox` (fuera de la transacción: es la agenda de la pestaña la que escribe)
// y los confirma en la petición siguiente, solo si el juego ya está guardado en la agenda.
//
// Quien llama tiene el Web Lock (una ronda a la vez entre pestañas; ver `runtime.ts`). Si falta
// `meta.syncState` (otra pestaña, o esta, ha desemparejado, olvidado o borrado todos los datos), la
// ronda no escribe nada más ni manda más peticiones: acaba con `aborted`.
import type { SyncResponse } from '@gameagenda/core/api';
import { type Entry, isLive } from '@gameagenda/core/entries';
import { parseSteamLink } from '@gameagenda/core/steam-link';
import {
  applyOps,
  canon,
  compactOutbox,
  formatHlc,
  groupByEntry,
  type HlcClock,
  isHlc,
  isTooFarAhead,
  MAX_COUNTER,
  MAX_DRIFT_MS,
  maxHlc,
  merge,
  nextOffset,
  type Op,
  opsFromChanges,
  planReseal,
  purgeCutoff,
  resealEntry,
  resealOps,
  SYNC_BATCH_SIZE,
  sortForUpload,
  takeSortedBatch,
  uploadOf,
} from '@gameagenda/core/sync';
import { Dexie } from 'dexie';
import { type GameAgendaDb, META_KEYS } from '../db/database.ts';
import type { SyncCall } from './api-client.ts';
import { INITIAL_CURSOR, parseSyncCursor, type SyncCursorState, type SyncRecord } from './state.ts';
import type { InboxLink, InboxSink } from './types.ts';

/**
 * Peticiones por ronda, como mucho: con lotes de 200, 20 000 operaciones. Las páginas de un `reset`
 * que avanzan (el cursor sube) no cuentan: el servidor ya acota cada página, y cortar el `reset` lo
 * haría empezar otra vez desde 0 en la ronda siguiente, sin acabar nunca si tiene más páginas.
 */
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
  /** Apunta los enlaces del buzón; sin él, se quedan en el servidor para otro dispositivo. */
  readonly inbox?: InboxSink;
}

export interface RoundResult {
  /** Peticiones hechas (también las páginas de un `reset`, que no cuentan para el tope). */
  readonly requests: number;
  /** `false` si se llegó al tope de peticiones con trabajo pendiente: hace falta otra ronda. */
  readonly complete: boolean;
  /** Operaciones que quedan en la `outbox`. */
  readonly pending: number;
  /** Entradas cambiadas (o borradas, al acabar un `reset`) por lo que ha llegado del servidor. */
  readonly changed: number;
  /** Operaciones que se han vuelto a sellar por reloj. */
  readonly resealed: number;
  /** Enlaces del buzón apuntados (o que ya estaban en la lista) y confirmados al servidor. */
  readonly inbox: number;
  /**
   * `true` si la ronda ha parado porque `meta.syncState` ya no estaba: antes de una petición, o
   * al ir a aplicar su respuesta. De esa respuesta no se ha escrito nada (ni entradas, ni
   * `outbox`, ni cursor, ni reloj) y no se han mandado más peticiones; `complete` es `false`.
   * Quien llama no la trata como una ronda correcta: nada de `onRoundOk`, aviso ni
   * `meta.syncState` (lo borraron a propósito).
   */
  readonly aborted: boolean;
}

export interface SyncEngine {
  /**
   * Una ronda completa. Lanza `SyncError` si falla una petición (lo aplicado se queda) y acaba con
   * `aborted` si falta `meta.syncState` (ver `RoundResult.aborted`).
   */
  round(): Promise<RoundResult>;
  /**
   * Al activar, emparejar, recuperar o restaurar: todas las entradas locales (lápidas incluidas) a
   * la `outbox` con `uploadOf()` (idempotente: la `outbox` se compacta al subir), el cursor a 0 y
   * `record` en `meta.syncState`, en una transacción. Así un dispositivo que se une a una agenda
   * con entradas suyas las fusiona en vez de perderlas. Lo que D1 purgaría (lápidas y esqueletos
   * de más de 90 días) no sube su contenido, y en local queda como quedará en el servidor.
   */
  join(record: SyncRecord): Promise<void>;
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

type Change = SyncResponse['changes'][number];

/** Por dónde va la ronda. */
interface Progress {
  /** Lo que queda guardado en `meta.syncCursor`. */
  readonly state: SyncCursorState;
  /** El cursor de la petición siguiente (en un `reset`, el de su página siguiente). */
  readonly pageCursor: number;
  /**
   * Los cambios de un `reset` en marcha, de todas sus páginas, o `null` si no hay `reset`. Se
   * aplican juntos en la transacción de la última página (ver `finishReset`).
   */
  readonly changes: Change[] | null;
}

/** La `outbox` compactada y en orden de subida, leída una vez por ronda; `head`: lo ya enviado. */
interface Queue {
  readonly ops: readonly Op[];
  head: number;
}

type Applied =
  | { readonly aborted: true }
  | {
      readonly aborted: false;
      readonly progress: Progress;
      readonly pending: number;
      readonly changed: number;
      readonly resealed: number;
      /** La `outbox` ha cambiado más allá de quitar lo aceptado: hay que volver a leerla. */
      readonly requeue: boolean;
      /** Hay que volver a bajar desde 0 en esta ronda aunque no queden páginas (otra época). */
      readonly again: boolean;
    };

const ABORTED: Applied = { aborted: true };

function startOf(state: SyncCursorState): Progress {
  return state.reset
    ? { state, pageCursor: 0, changes: [] }
    : { state, pageCursor: state.cursor, changes: null };
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

  /** ¿Sigue este navegador emparejado? (Ver `RoundResult.aborted`.) */
  async function isPaired(): Promise<boolean> {
    return (await db.meta.get(META_KEYS.syncState)) !== undefined;
  }

  /**
   * Compacta la `outbox` (borra lo que sobra) y la deja en orden de subida. Una vez por ronda: los
   * lotes salen de esta cola, y solo se vuelve a leer si cambia más allá de lo que quita `apply`.
   */
  function loadQueue(): Promise<Queue> {
    return db.transaction('rw', db.outbox, async () => {
      const all = await db.outbox.toArray();
      const { keep, drop } = compactOutbox(all);
      if (drop.length > 0) await db.outbox.bulkDelete(drop.map((o) => o.opId));
      return { ops: sortForUpload(keep), head: 0 };
    });
  }

  /**
   * Los enlaces del buzón de la última página: los apunta (`options.inbox`) y devuelve los ids que
   * se pueden confirmar: los que no son un enlace de Steam (no se apuntarán nunca) y los que ya
   * están vivos en la agenda. `null` si, mientras tanto, se ha dejado de sincronizar.
   */
  async function takeInbox(items: SyncResponse['inbox']): Promise<string[] | null> {
    const links: InboxLink[] = [];
    const acks: string[] = [];
    for (const item of items) {
      const link = parseSteamLink(item.url);
      if (link === null) acks.push(item.id);
      else links.push({ id: item.id, appid: link.appid, title: link.title });
    }
    if (links.length === 0 || options.inbox === undefined) return acks;
    await options.inbox.capture(links);
    if (!(await isPaired())) return null;
    const rows = await db.entries.bulkGet(links.map((l) => `steam:${l.appid}`));
    links.forEach((link, i) => {
      if (isLive(rows[i])) acks.push(link.id);
    });
    return acks;
  }

  /**
   * Tras bajar el reloj (`setOffset`), lo vuelve a poner por delante de lo legítimo de la agenda:
   * la mayor `lastHlc` que no va más de 5 min por delante (con el índice `lastHlc`). Si no, una
   * entrada propia reciente que aún no ha vuelto en una página iría por delante del reloj, y core
   * rechazaría la acción siguiente sobre ella. Lo que va más lejos está en la `outbox` y se vuelve a
   * sellar.
   */
  async function catchUpClock(): Promise<void> {
    const ms = Math.max(0, Math.floor(now() + clock.offset + MAX_DRIFT_MS));
    const limit = formatHlc({ ms, counter: MAX_COUNTER, node: 'zzzzzzzz' });
    const top = await db.entries.where('lastHlc').belowOrEqual(limit).last();
    if (top !== undefined && isHlc(top.lastHlc)) clock.receive(top.lastHlc);
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

  /** Las operaciones de la `outbox`, por entrada. */
  async function pendingByEntry(): Promise<Map<string, Op[]>> {
    return groupByEntry(await db.outbox.toArray());
  }

  /**
   * Una entrada solo con lo que tiene pendiente en la `outbox` (`undefined` si nada): así empieza
   * en un `reset` (ver `finishReset`).
   */
  function rebuilt(id: string, pending: ReadonlyMap<string, Op[]>): Entry | undefined {
    const ops = pending.get(id);
    return ops === undefined ? undefined : merge(undefined, ops, newOpId).entry;
  }

  /**
   * Fusiona los cambios con `applyOps()` de core sobre lo guardado (LWW, Platinado ⇒ Completado y
   * reenvío de los manuales vinculados, siguiendo los reenvíos a entradas que haya que leer). Con
   * `rebuildFrom` (fin de un `reset`), cada entrada de los cambios empieza solo con lo que tiene
   * pendiente (`rebuilt`), no con lo guardado.
   *
   * Las derivadas NO van a la `outbox`: el servidor ya las ha calculado con la misma `applyOps()`
   * sobre su estado, que cumple las reglas tras cada petición (CA4.1), y lo que esta réplica tenga
   * pendiente lo sube su `outbox`, y el servidor vuelve a derivar al aplicarlo.
   */
  async function mergeChanges(
    changes: readonly Change[],
    rebuildFrom: ReadonlyMap<string, Op[]> | null,
  ): Promise<number> {
    if (changes.length === 0) return 0;
    const ops = opsFromChanges(changes, newOpId);
    const rebuild = rebuildFrom === null ? null : new Set(ops.map((o) => o.entryId));
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
        const start =
          rebuildFrom !== null && rebuild?.has(id) === true ? rebuilt(id, rebuildFrom) : row;
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

  /**
   * Fin de un `reset` (§7.7), en la transacción de su última página: los cambios de TODAS sus
   * páginas, de una vez. Mientras duran las páginas no se toca ninguna entrada, así que nada se
   * queda a medias ni deja de verse (las filas bajan por `seq`, no por entrada), y un `reset`
   * cortado deja lo local como estaba.
   * - Cada entrada que manda el servidor se reconstruye: lo pendiente en su `outbox` y, encima, lo
   *   del servidor. Si se conservara la local entera, una lápida purgada que esta réplica tocó sin
   *   red resucitaría aquí y en el servidor quedaría como esqueleto.
   * - Las que no manda se borran (una copia vieja no resucita lo purgado), salvo lo que sigue en la
   *   `outbox`, que se queda solo con eso: es lo que tendrá el servidor cuando lo suba.
   */
  async function finishReset(changes: readonly Change[]): Promise<number> {
    const pending = await pendingByEntry();
    const changed = await mergeChanges(changes, pending);
    const seen = new Set(changes.map((c) => c.entryId));
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
    return changed + gone.length + kept.length;
  }

  /**
   * Todas las entradas locales a la `outbox`, con `uploadOf()`: lo que D1 purgaría no sube su
   * contenido, y en local queda como quedará en el servidor. Tampoco sube lo que esas entradas ya
   * tuvieran en la `outbox` (la agenda la llena desde M1, aunque no se sincronice).
   */
  async function uploadAll(): Promise<void> {
    const cutoff = purgeCutoff(now() + clock.offset);
    const entries = await db.entries.toArray();
    const ops: Op[] = [];
    const put: Entry[] = [];
    const gone: string[] = [];
    const reduced: string[] = [];
    for (const e of entries) {
      const upload = uploadOf(e, cutoff, newOpId);
      for (const o of upload.ops) ops.push(o);
      if (upload.local === e) continue;
      reduced.push(e.id);
      if (upload.local === null) gone.push(e.id);
      else put.push(upload.local);
    }
    if (reduced.length > 0) {
      const stale = await Promise.all(
        reduced.map((id) =>
          db.outbox
            .where('[entryId+field]')
            .between([id, Dexie.minKey], [id, Dexie.maxKey])
            .primaryKeys(),
        ),
      );
      const keys = stale.flat() as string[];
      if (keys.length > 0) await db.outbox.bulkDelete(keys);
    }
    if (ops.length > 0) await db.outbox.bulkAdd(ops);
    if (gone.length > 0) await db.entries.bulkDelete(gone);
    if (put.length > 0) await db.entries.bulkPut(put);
  }

  function apply(
    batch: readonly Op[],
    sent: SyncCall,
    response: SyncResponse,
    sample: { sentAt: number; receivedAt: number },
    progress: Progress,
  ): Promise<Applied> {
    return db.transaction('rw', db.entries, db.outbox, db.meta, async () => {
      // 0. Si ya no está emparejado, nada: ni entradas, ni `outbox`, ni cursor, ni reloj.
      if (!(await isPaired())) return ABORTED;

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

      // 2. El reloj: desfase con `serverTime` (si eso lo baja, otra vez por delante de lo
      //    legítimo de la agenda) y todo lo visto del servidor.
      const before = clock.snapshot().ms;
      clock.setOffset(nextOffset(clock.offset, { ...sample, serverTime: response.serverTime }));
      if (clock.snapshot().ms < before) await catchUpClock();
      const { state } = progress;
      const maxSeen = maxHlc([state.maxSeen, ...response.changes.map((c) => c.hlc)]);
      if (isHlc(maxSeen)) clock.receive(maxSeen);

      // 3. Volver a sellar lo rechazado por reloj (con el desfase ya corregido).
      const resealed = clockRejected.length > 0 ? await reseal(clockRejected) : 0;

      // 4. Los cambios y el cursor.
      const { purgedSeq, epoch } = response;
      const at = (cursor: number, reset = false): SyncCursorState => ({
        cursor,
        purgedSeq,
        reset,
        maxSeen,
        epoch,
      });
      let changed = 0;
      let requeue = false;
      let again = false;
      let next: Progress;
      if (state.epoch !== undefined && epoch !== state.epoch) {
        // Otra época: D1 ha vuelto atrás (restore) y el cursor ya no vale; con varios
        // dispositivos, la `seq` nueva puede haberlo alcanzado. Lo de esta página es del servidor
        // y se fusiona; luego todo lo local vuelve a subir y se baja desde 0, sin `reset` (lo que
        // el restore perdió no se borra aquí: vuelve con lo que se sube).
        changed = await mergeChanges(response.changes, null);
        await uploadAll();
        requeue = true;
        again = true;
        next = { state: at(0), pageCursor: 0, changes: null };
      } else if (!response.reset && response.cursor < sent.cursor) {
        // El cursor baja sin `reset`: D1 ha vuelto atrás y no tiene lo nuestro (el servidor baja
        // desde 0 y no ha escrito el lote). También corta un `reset` en marcha: sus páginas de
        // antes eran del D1 de antes.
        changed = await mergeChanges(response.changes, null);
        await uploadAll();
        requeue = true;
        next = { state: at(response.cursor), pageCursor: response.cursor, changes: null };
      } else if (progress.changes !== null || response.reset) {
        // `reset` (§7.7): desde 0, y las páginas se juntan hasta la última (ver `finishReset`).
        // Otro `reset` en medio (una purga entre páginas) vuelve a empezar.
        const changes = response.reset || progress.changes === null ? [] : progress.changes;
        for (const c of response.changes) changes.push(c);
        if (response.more) {
          // A medias de un `reset`, la ronda siguiente vuelve a empezar desde 0.
          next = { state: at(0, true), pageCursor: response.cursor, changes };
        } else {
          changed = await finishReset(changes);
          next = { state: at(response.cursor), pageCursor: response.cursor, changes: null };
        }
      } else {
        changed = await mergeChanges(response.changes, null);
        next = { state: at(response.cursor), pageCursor: response.cursor, changes: null };
      }

      await db.meta.bulkPut([
        { key: META_KEYS.syncCursor, value: next.state },
        { key: META_KEYS.hlcClock, value: clock.snapshot() },
      ]);
      const pending = await db.outbox.count();
      return { aborted: false, progress: next, pending, changed, resealed, requeue, again };
    });
  }

  return {
    async round() {
      let progress = startOf(await readCursor());
      let queue: Queue | null = null;
      let requests = 0;
      let counted = 0;
      let changed = 0;
      let resealed = 0;
      let pending = 0;
      let inbox = 0;
      /** Lo que se confirma del buzón en la petición siguiente. */
      let acks: string[] = [];
      /** Lo del buzón que ya se ha intentado apuntar en esta ronda (no se repite). */
      const tried = new Set<string>();
      const end = (complete: boolean, aborted = false): RoundResult => ({
        requests,
        complete,
        pending,
        changed,
        resealed,
        inbox,
        aborted,
      });
      for (;;) {
        if (!(await isPaired())) return end(false, true);
        // En un `reset`, las peticiones solo bajan: lo pendiente sube cuando acaba.
        let batch: Op[] = [];
        if (progress.changes === null) {
          queue ??= await loadQueue();
          batch = takeSortedBatch(queue.ops, batchSize, queue.head);
        }
        const sent: SyncCall = {
          cursor: progress.pageCursor,
          purgedSeq: progress.state.purgedSeq,
          ops: batch,
          ...(acks.length > 0 ? { inboxAck: acks } : {}),
        };
        const sentAt = now();
        const response = await transport.sync(sent);
        const receivedAt = now();
        requests += 1;
        // El servidor ya ha borrado lo confirmado.
        inbox += acks.length;
        acks = [];
        const applied = await apply(batch, sent, response, { sentAt, receivedAt }, progress);
        if (applied.aborted) return end(false, true);
        // Una página de un `reset` que avanza no cuenta para el tope (ver `MAX_REQUESTS_PER_ROUND`).
        const advancing =
          applied.progress.changes !== null && !response.reset && response.cursor > sent.cursor;
        if (!advancing) counted += 1;
        ({ progress, pending } = applied);
        changed += applied.changed;
        resealed += applied.resealed;
        if (queue !== null) {
          queue.head += batch.length;
          // La agenda ha escrito, algo no se ha quitado o se ha vuelto a sellar: se vuelve a leer.
          const stale = pending !== queue.ops.length - queue.head;
          if (applied.requeue || applied.resealed > 0 || stale) queue = null;
        }
        // El buzón, solo con todo bajado: antes, la app aún no sabe si el juego ya estaba en la
        // agenda, y apuntarlo otra vez pisaría su estado.
        const settled = !response.more && !applied.again && applied.progress.changes === null;
        const fresh = settled ? response.inbox.filter((item) => !tried.has(item.id)) : [];
        if (fresh.length > 0) {
          for (const item of fresh) tried.add(item.id);
          const taken = await takeInbox(fresh);
          if (taken === null) return end(false, true);
          acks = taken;
          // Lo apuntado está en la `outbox`: la cola se vuelve a leer.
          pending = await db.outbox.count();
          queue = null;
        }
        if (!response.more && !applied.again && pending === 0 && acks.length === 0) {
          return end(true);
        }
        if (counted >= maxRequests) return end(false);
        await pause();
      }
    },

    join(record) {
      return db.transaction('rw', db.entries, db.outbox, db.meta, async () => {
        await uploadAll();
        await db.meta.bulkPut([
          { key: META_KEYS.syncCursor, value: INITIAL_CURSOR },
          { key: META_KEYS.syncState, value: record },
        ]);
      });
    },

    pending: () => db.outbox.count(),
  };
}
