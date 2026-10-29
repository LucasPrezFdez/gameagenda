// La agenda de verdad (§7.2–§7.4, §9.5): aplica las acciones puras de `@gameagenda/core/entries`
// en memoria, de forma síncrona, para pintar en el mismo fotograma, y las guarda después en
// Dexie, en segundo plano y en orden. Los cambios de otras pestañas llegan por el almacén
// (`storagemutated`) y se superponen sin pisar lo que esta pestaña aún no ha guardado.
import {
  type ActionContext,
  type ActionResult,
  addEntry,
  viewOf as coreViewOf,
  type Entry,
  editEntry,
  isLive,
  isSteamEntryId,
  linkManual,
  moveEntry,
  moveNeighbors,
  parseEntryId,
  refreshCatalogCopy,
  removeEntry,
  setFlag as setFlagAction,
  setStatus as setStatusAction,
  type UndoStep,
  undo as undoAction,
} from '@gameagenda/core/entries';
import { type HlcClock, isHlc, maxHlc, type Op } from '@gameagenda/core/sync';
import { requestPersistentStorage } from '../db/persist.ts';
import { type AgendaStorage, type StorageChange, sameEntry, type WriteBatch } from './storage.ts';
import {
  type AgendaEffect,
  type AgendaResult,
  type AgendaStore,
  type CaptureOptions,
  type CaptureTarget,
  type CatalogCopy,
  compareRank,
  type EditableField,
  type EntryPatch,
  type Flag,
  type ImportedChanges,
  type MoveTarget,
  type Status,
} from './types.ts';

const NOOP: AgendaResult = { effect: { kind: 'noop' }, undo: null };

/** Fecha local de hoy, `AAAA-MM-DD` (las fechas automáticas de la §3.3 son locales). */
export function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface AgendaOptions {
  /** Lo que había en Dexie al arrancar (lápidas incluidas). */
  readonly entries?: Iterable<Entry>;
  readonly clock: HlcClock;
  /** uuidv7 para `opId` e ids manuales. */
  readonly newId: () => string;
  /** `null`: solo en memoria (si IndexedDB no está disponible). */
  readonly storage: AgendaStorage | null;
  readonly now?: () => Date;
  /** Un guardado ha fallado (se reintenta con el siguiente). */
  readonly onStorageError?: (error: unknown) => void;
  /** Cuándo empieza a guardar: por defecto, tras pintar la respuesta. */
  readonly afterPaint?: () => Promise<void>;
}

interface QueuedWrite {
  readonly batch: WriteBatch;
  readonly seq: number;
}

/** El guardado nunca compite con el fotograma de la respuesta: empieza justo después. */
const LATEST_WRITE_MS = 50;

/**
 * Se resuelve tras el próximo fotograma (o, en una pestaña oculta, sin fotogramas, a los 50 ms
 * como mucho). Sin `requestAnimationFrame` (Vitest en Node), en la tarea siguiente.
 */
export function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0);
      return;
    }
    const fallback = setTimeout(resolve, LATEST_WRITE_MS);
    requestAnimationFrame(() =>
      setTimeout(() => {
        clearTimeout(fallback);
        resolve();
      }, 0),
    );
  });
}

export function createAgenda(options: AgendaOptions): AgendaStore {
  const { clock, newId, storage } = options;
  const now = options.now ?? (() => new Date());
  const afterPaint = options.afterPaint ?? afterNextPaint;
  const newOpId = newId;

  /** Todas las entradas conocidas (lápidas y esqueletos incluidos). */
  const all = new Map<string, Entry>();
  /** id → lote que aún no se ha guardado: lo de Dexie no la pisa hasta entonces. */
  const pending = new Map<string, number>();
  /** id → último cambio local (acción o guardado): invalida las lecturas empezadas antes. */
  const touched = new Map<string, number>();
  let changeSeq = 0;
  let writeSeq = 0;
  /** Cambia con «Borrar todos mis datos»: los Deshacer de antes dejan de valer. */
  let generation = 0;
  /** Entradas vivas, en una referencia nueva tras cada cambio (`useSyncExternalStore`). */
  let snapshot: readonly Entry[] = [];
  const listeners = new Set<() => void>();

  let writes: Promise<void> = Promise.resolve();
  const failed: QueuedWrite[] = [];
  let reads: Promise<void> = Promise.resolve();
  let dirty = new Set<string>();
  let dirtyAll = false;
  let readScheduled = false;

  for (const entry of options.entries ?? []) all.set(entry.id, entry);
  // El reloj, por delante de todo lo guardado (si no, core rechazaría la acción).
  receive(maxHlc([...all.values()].map((entry) => entry.lastHlc).filter(isHlc)));
  rebuild();

  function receive(hlc: string): void {
    if (isHlc(hlc)) clock.receive(hlc);
  }

  function rebuild(): void {
    const live: Entry[] = [];
    for (const entry of all.values()) if (isLive(entry)) live.push(entry);
    snapshot = live;
  }

  function emit(): void {
    rebuild();
    for (const listener of listeners) listener();
  }

  function touch(id: string): void {
    changeSeq += 1;
    touched.set(id, changeSeq);
  }

  function context(): ActionContext {
    return { hlc: clock.next(), today: localDay(now()), newOpId };
  }

  // --- Guardar --------------------------------------------------------------------------------

  async function write(item: QueuedWrite): Promise<void> {
    if (!storage) return;
    requestPersistentStorage();
    const written = await storage.write(item.batch);
    let changed = false;
    for (const entry of written) {
      if (pending.get(entry.id) !== item.seq) continue;
      pending.delete(entry.id);
      touch(entry.id);
      // Si se ha fusionado con un cambio de otra pestaña, lo guardado manda.
      if (!sameEntry(all.get(entry.id), entry)) {
        all.set(entry.id, entry);
        receive(entry.lastHlc);
        changed = true;
      }
    }
    if (changed) emit();
  }

  function enqueue(item: QueuedWrite): Promise<void> {
    const run = async () => {
      await afterPaint();
      // Lo que falló antes va primero, en su orden.
      while (failed.length > 0) {
        const retry = failed[0] as QueuedWrite;
        await write(retry);
        failed.shift();
      }
      await write(item);
    };
    const done = writes.then(run).catch((error: unknown) => {
      if (!failed.includes(item)) failed.push(item);
      options.onStorageError?.(error);
    });
    writes = done;
    return done;
  }

  /** Aplica en memoria (al instante) y encola el guardado. */
  function commit(entries: readonly Entry[], ops: readonly Op[]): Promise<void> {
    const before = new Map<string, Entry | undefined>();
    for (const entry of entries) if (!before.has(entry.id)) before.set(entry.id, all.get(entry.id));
    writeSeq += 1;
    const seq = writeSeq;
    for (const entry of entries) {
      all.set(entry.id, entry);
      touch(entry.id);
      if (storage) pending.set(entry.id, seq);
    }
    emit();
    if (!storage) return Promise.resolve();
    return enqueue({ batch: { entries, ops, before, clock: clock.snapshot() }, seq });
  }

  /**
   * Ejecuta una acción de core con una HLC nueva. Si una entrada trae una HLC posterior al reloj
   * (no debería: se recibe todo lo que llega), lo recibe y lo intenta una vez más.
   */
  function run(
    ids: readonly string[],
    action: (ctx: ActionContext) => ActionResult | null,
  ): ActionResult | null {
    let result: ActionResult | null;
    try {
      result = action(context());
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      for (const id of ids) receive(all.get(id)?.lastHlc ?? '');
      result = action(context());
    }
    if (result) void commit(result.entries, result.ops);
    return result;
  }

  function undoOf(step: UndoStep): () => void {
    const since = generation;
    return () => {
      if (since !== generation) return;
      run(
        step.changes.map((change) => change.id),
        (ctx) => undoAction(step, (id) => all.get(id), ctx),
      );
    };
  }

  function act(
    ids: readonly string[],
    effect: AgendaEffect,
    action: (ctx: ActionContext) => ActionResult | null,
  ): AgendaResult {
    const result = run(ids, action);
    return result ? { effect, undo: undoOf(result.undo) } : NOOP;
  }

  function live(id: string): Entry | undefined {
    const entry = all.get(id);
    return isLive(entry) ? entry : undefined;
  }

  /** La mayor `rank` de Quiero jugar (también la de lo fijado en A continuación). */
  function lastRank(): string | null {
    let max: string | null = null;
    for (const entry of snapshot) {
      if (entry.status === 'want_to_play' && (max === null || entry.rank > max)) max = entry.rank;
    }
    return max;
  }

  // --- Cambios de otras pestañas --------------------------------------------------------------

  function scheduleRead(): void {
    if (readScheduled || !storage) return;
    readScheduled = true;
    reads = reads.then(async () => {
      readScheduled = false;
      const full = dirtyAll;
      const ids = [...dirty];
      dirty = new Set();
      dirtyAll = false;
      const since = changeSeq;
      try {
        if (full) applyStored(await storage.readAll(), since, true);
        else applyStored(await storage.read(ids), since, false, ids);
      } catch (error) {
        options.onStorageError?.(error);
      }
    });
  }

  function onStorageChange(change: StorageChange): void {
    if ('all' in change) dirtyAll = true;
    else for (const id of change.ids) dirty.add(id);
    scheduleRead();
  }

  function isStale(id: string, since: number): boolean {
    return pending.has(id) || (touched.get(id) ?? 0) > since;
  }

  function applyStored(
    rows: ReadonlyArray<Entry | undefined>,
    since: number,
    full: boolean,
    ids: readonly string[] = [],
  ): void {
    let changed = false;
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      const id = row?.id ?? ids[i];
      if (id === undefined) return;
      seen.add(id);
      if (isStale(id, since)) return;
      const current = all.get(id);
      if (row === undefined) {
        if (current !== undefined) {
          all.delete(id);
          changed = true;
        }
        return;
      }
      receive(row.lastHlc);
      if (!sameEntry(current, row)) {
        all.set(id, row);
        changed = true;
      }
    });
    if (full) {
      // Lo que ya no está en Dexie (otra pestaña ha borrado todos los datos).
      let removed = 0;
      for (const id of [...all.keys()]) {
        if (seen.has(id) || isStale(id, since)) continue;
        all.delete(id);
        removed += 1;
      }
      if (removed > 0) {
        changed = true;
        if (all.size === 0) generation += 1;
      }
    }
    if (changed) emit();
  }

  const unsubscribe = storage?.subscribe(onStorageChange) ?? (() => undefined);

  // --- Acciones -------------------------------------------------------------------------------

  function capture(target: CaptureTarget, options: CaptureOptions = {}): AgendaResult {
    const prev = all.get(target.id);
    if (isLive(prev)) {
      return {
        effect: { kind: 'alreadyInList', title: prev.title, status: prev.status },
        undo: null,
      };
    }
    const flags: Record<string, boolean> = {};
    for (const [flag, value] of Object.entries(options.flags ?? {})) {
      if (typeof value === 'boolean') flags[flag] = value;
    }
    const result = run([target.id], (ctx) =>
      addEntry(
        prev,
        { id: target.id, title: target.title, status: options.status, flags },
        { ...ctx, lastRank: lastRank() },
      ),
    );
    if (!result) return NOOP;
    return {
      effect: {
        kind: 'captured',
        title: result.entry.title,
        status: result.entry.status,
        provisional: target.provisional === true,
      },
      undo: undoOf(result.undo),
    };
  }

  function setStatus(id: string, status: Status): AgendaResult {
    const prev = live(id);
    if (!prev || prev.status === status) return NOOP;
    return act([id], { kind: 'status', title: prev.title, from: prev.status, to: status }, (ctx) =>
      setStatusAction(prev, status, ctx),
    );
  }

  function setFlag(id: string, flag: Flag, value: boolean): AgendaResult {
    const prev = live(id);
    if (!prev || (prev.flags[flag] ?? false) === value) return NOOP;
    const autoCompleted = flag === 'platinum' && value && prev.status !== 'completed';
    return act([id], { kind: 'flag', title: prev.title, flag, value, autoCompleted }, (ctx) =>
      setFlagAction(prev, flag, value, ctx),
    );
  }

  function move(id: string, to: MoveTarget): AgendaResult {
    const prev = live(id);
    if (!prev) return NOOP;
    const view = coreViewOf(prev);
    const siblings = snapshot.filter((entry) => coreViewOf(entry) === view).sort(compareRank);
    const from = siblings.findIndex((entry) => entry.id === id);
    const last = siblings.length - 1;
    const target = to === 'top' ? 0 : to === 'bottom' ? last : to === 'up' ? from - 1 : from + 1;
    if (from < 0 || target < 0 || target > last || target === from) return NOOP;
    const { above, below } = moveNeighbors(
      siblings.map((entry) => entry.rank),
      from,
      target,
    );
    return act(
      [id],
      { kind: 'moved', title: prev.title, position: target + 1, total: siblings.length },
      (ctx) => moveEntry(prev, above, below, ctx),
    );
  }

  function update(id: string, patch: EntryPatch): AgendaResult {
    const prev = live(id);
    if (!prev) return NOOP;
    const fields = (Object.keys(patch) as EditableField[]).filter(
      (field) => patch[field] !== undefined && patch[field] !== prev[field],
    );
    const field = fields[0];
    if (field === undefined) return NOOP;
    return act([id], { kind: 'updated', title: prev.title, field }, (ctx) =>
      editEntry(prev, patch, ctx),
    );
  }

  function remove(id: string): AgendaResult {
    const prev = live(id);
    if (!prev) return NOOP;
    return act([id], { kind: 'removed', title: prev.title }, (ctx) => removeEntry(prev, ctx));
  }

  function link(manualId: string, target: CaptureTarget): AgendaResult {
    const manual = live(manualId);
    const parsed = parseEntryId(target.id);
    if (!manual || parsed?.kind !== 'steam') return NOOP;
    return act([manualId, target.id], { kind: 'linked', title: target.title }, (ctx) =>
      linkManual(
        manual,
        all.get(target.id),
        parsed.appid,
        { title: target.title, cover: null },
        ctx,
      ),
    );
  }

  function refreshFromCatalog(copies: readonly CatalogCopy[]): void {
    const entries: Entry[] = [];
    const ops: Op[] = [];
    for (const copy of copies) {
      const prev = live(copy.id);
      if (!prev || !isSteamEntryId(copy.id) || prev.title === copy.title) continue;
      const result = refreshCatalogCopy(prev, { title: copy.title, cover: prev.cover }, context());
      if (!result) continue;
      entries.push(...result.entries);
      ops.push(...result.ops);
    }
    if (entries.length > 0) void commit(entries, ops);
  }

  async function deleteAll(): Promise<void> {
    generation += 1;
    for (const id of all.keys()) touch(id);
    all.clear();
    pending.clear();
    failed.length = 0;
    emit();
    if (!storage) return;
    const done = writes.then(() => storage.clear());
    writes = done.catch(() => undefined);
    await done;
  }

  async function whenIdle(): Promise<void> {
    // Un guardado provoca una relectura, y una relectura puede encontrar más cambios.
    for (let i = 0; i < 10; i++) {
      const w = writes;
      const r = reads;
      await w;
      await r;
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (w === writes && r === reads && !readScheduled) return;
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    capture,
    setStatus,
    setFlag,
    move,
    update,
    remove,
    link,
    deleteAll,
    refreshFromCatalog,
    whenIdle,
    dispose: unsubscribe,

    allEntries: () => [...all.values()],
    get: (id) => all.get(id),
    importContext: () => ({
      nowMs: Date.now(),
      offsetMs: clock.offset,
      today: localDay(now()),
      lastRank: lastRank(),
      nextHlc: () => clock.next(),
      newOpId,
      newManualId: newId,
    }),
    async backup(copy) {
      await writes;
      await storage?.backup(copy);
    },
    async applyImport(result: ImportedChanges) {
      if (result.maxHlc !== null) receive(result.maxHlc);
      if (result.entries.length === 0) return;
      await commit(result.entries, result.ops);
      if (failed.length > 0) throw new Error('No se ha podido guardar la importación');
    },
  };
}
