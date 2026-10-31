// Detalles de los juegos para la interfaz (§7.6): estado por `appid` con suscripción, para las
// portadas, la ficha completa y Próximos. Las peticiones de un mismo pintado se juntan en la
// siguiente tarea y se agrupan por *shard*; la fuente (`details-source.ts`, con Zod) se carga
// diferida la primera vez que hace falta. Respeta el *kill switch* `details` y, sin índice de
// *shards* (el catálogo de M1), no pide nada.
//
// Sin Zod ni el formato del catálogo: va en el *chunk* inicial.
import type { GameDetailsView } from '@gameagenda/core/catalog-format';
import type { CatalogFileRef, CatalogInfo } from '../search-client/protocol.ts';
import type { DetailsSource, ShardResult } from './details-source.ts';

export type DetailsState =
  | { readonly kind: 'loading' }
  /** `details` es `null` si el juego no está en su *shard*. */
  | { readonly kind: 'ready'; readonly details: GameDetailsView | null }
  /** Sin índice, con el *kill switch*, o sin red y sin caché: la ficha básica. */
  | { readonly kind: 'unavailable' };

export type DetailsAvailability = 'unknown' | 'available' | 'unavailable';

export interface DetailsStore {
  /** Estado de `appid`; el mismo objeto mientras no cambie (`useSyncExternalStore`). */
  get(appid: number): DetailsState;
  /** Pide los detalles: se juntan con los demás del mismo pintado y se agrupan por *shard*. */
  request(appids: Iterable<number>): void;
  subscribe(appid: number, listener: () => void): () => void;
  /** Cualquier cambio (detalles o catálogo), como mucho una vez por tarea. */
  subscribeAll(listener: () => void): () => void;
  /** Crece con cada cambio: para las listas que dependen de muchos juegos. */
  getVersion(): number;
  getAvailability(): DetailsAvailability;
  /** El catálogo en uso (con sus *kill switches*), o `null`. */
  getCatalog(): CatalogInfo | null;
  /** Portadas encendidas en el *manifest* (sin el *kill switch* `covers`) y con detalles. */
  coversAvailable(): boolean;
  /**
   * Catálogo en uso. `info` es `null` mientras no hay ninguno; `failed` dice que no lo habrá (la
   * carga ha fallado sin catálogo en la caché).
   */
  setCatalog(info: CatalogInfo | null, failed?: boolean): void;
  /** Una portada quiere cargarse y espera al aviso de primera capa (§11.2). */
  wantCover(): () => void;
  hasCoverDemand(): boolean;
  /** Olvida todo lo leído (tras borrar los datos de Steam del dispositivo). */
  clear(): void;
  dispose(): void;
}

export interface DetailsStoreDeps {
  /** La fuente de los *shards*; se pide la primera vez que hace falta (`import()`). */
  readonly loadSource: () => Promise<DetailsSource>;
  /** Programa una tarea (por defecto, `setTimeout(…, 0)`). */
  readonly schedule?: (task: () => void) => void;
  readonly now?: () => number;
  /** Tras un fallo (sin red), cuánto esperar antes de volver a pedir lo mismo. */
  readonly retryMs?: number;
  /** Tarea en un rato ocioso (la limpieza de la caché). */
  readonly idle?: (task: () => void) => void;
}

const LOADING: DetailsState = { kind: 'loading' };
const UNAVAILABLE: DetailsState = { kind: 'unavailable' };
const DEFAULT_RETRY_MS = 30_000;

function defaultSchedule(task: () => void): void {
  setTimeout(task, 0);
}

function defaultIdle(task: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(task, { timeout: 5000 });
  else setTimeout(task, 2000);
}

interface Entry {
  state: DetailsState;
  /** Índice del que salió `state` (`null` mientras carga por primera vez). */
  generation: number;
  failedAt: number | null;
}

export function createDetailsStore(deps: DetailsStoreDeps): DetailsStore {
  const schedule = deps.schedule ?? defaultSchedule;
  const idle = deps.idle ?? defaultIdle;
  const now = deps.now ?? Date.now;
  const retryMs = deps.retryMs ?? DEFAULT_RETRY_MS;

  const entries = new Map<number, Entry>();
  const listeners = new Map<number, Set<() => void>>();
  const allListeners = new Set<() => void>();
  /** `appid` pedidos para el índice vigente y aún sin pedir a la fuente. */
  const queue = new Set<number>();
  /** `appid` en vuelo para el índice vigente. */
  const inFlight = new Set<number>();

  let availability: DetailsAvailability = 'unknown';
  let catalog: CatalogInfo | null = null;
  let indexRef: CatalogFileRef | null = null;
  let generation = 0;
  let version = 0;
  let flushScheduled = false;
  let notifyScheduled = false;
  let coverDemand = 0;
  let disposed = false;
  let source: Promise<DetailsSource> | null = null;
  const evicted = new Set<string>();

  function getSource(): Promise<DetailsSource> {
    if (!source) {
      source = deps.loadSource();
      source.catch(() => {
        source = null;
      });
    }
    return source;
  }

  function notifyAll(): void {
    version += 1;
    if (notifyScheduled) return;
    notifyScheduled = true;
    schedule(() => {
      notifyScheduled = false;
      for (const listener of [...allListeners]) listener();
    });
  }

  function notify(appids: Iterable<number>): void {
    for (const appid of appids) {
      for (const listener of [...(listeners.get(appid) ?? [])]) listener();
    }
    notifyAll();
  }

  function setState(appid: number, state: DetailsState, failed = false): void {
    const entry = entries.get(appid);
    if (entry) {
      entry.state = state;
      entry.generation = generation;
      entry.failedAt = failed ? now() : null;
    } else {
      entries.set(appid, { state, generation, failedAt: failed ? now() : null });
    }
  }

  /** ¿Hace falta pedirlo para el índice vigente? */
  function needs(appid: number): boolean {
    if (queue.has(appid) || inFlight.has(appid)) return false;
    const entry = entries.get(appid);
    if (!entry || entry.generation !== generation) return true;
    if (entry.state.kind === 'unavailable') {
      return entry.failedAt !== null && now() - entry.failedAt >= retryMs;
    }
    return false;
  }

  function scheduleFlush(): void {
    if (flushScheduled || availability !== 'available') return;
    flushScheduled = true;
    schedule(() => {
      flushScheduled = false;
      void flush();
    });
  }

  async function flush(): Promise<void> {
    const ref = indexRef;
    if (disposed || !ref || queue.size === 0) return;
    const gen = generation;
    const appids = [...queue];
    queue.clear();
    for (const appid of appids) inFlight.add(appid);
    const current = () => !disposed && gen === generation;

    const settle = (result: ShardResult): void => {
      if (!current()) return;
      for (const [appid, details] of result) {
        inFlight.delete(appid);
        setState(appid, { kind: 'ready', details });
      }
      notify(result.keys());
    };
    const fail = (failed: readonly number[]): void => {
      if (!current() || failed.length === 0) return;
      for (const appid of failed) {
        inFlight.delete(appid);
        // Lo que ya se sabía de un índice anterior se queda: mejor eso que nada sin red.
        const entry = entries.get(appid);
        if (entry?.state.kind === 'ready') {
          entry.generation = gen;
          entry.failedAt = now();
        } else {
          setState(appid, UNAVAILABLE, true);
        }
      }
      notify(failed);
    };

    try {
      const loaded = await getSource();
      const { failed } = await loaded.load(ref, appids, settle);
      fail(failed);
      if (current() && !evicted.has(ref.path)) {
        evicted.add(ref.path);
        idle(() => {
          if (current()) void loaded.evict(ref).catch(() => undefined);
        });
      }
    } catch {
      fail(appids.filter((appid) => inFlight.has(appid)));
    } finally {
      if (current()) {
        for (const appid of appids) inFlight.delete(appid);
        if (queue.size > 0) scheduleFlush();
      }
    }
  }

  function availabilityOf(info: CatalogInfo | null, failed: boolean): DetailsAvailability {
    if (!info) return failed ? 'unavailable' : 'unknown';
    if (info.killSwitches.details || !info.detailsIndex) return 'unavailable';
    return 'available';
  }

  const store: DetailsStore = {
    get(appid) {
      if (availability === 'unavailable') return UNAVAILABLE;
      return entries.get(appid)?.state ?? LOADING;
    },

    request(appids) {
      if (disposed) return;
      let added = false;
      for (const appid of appids) {
        if (!Number.isSafeInteger(appid) || appid <= 0 || !needs(appid)) continue;
        queue.add(appid);
        added = true;
      }
      if (added) scheduleFlush();
    },

    subscribe(appid, listener) {
      let set = listeners.get(appid);
      if (!set) {
        set = new Set();
        listeners.set(appid, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(appid);
      };
    },

    subscribeAll(listener) {
      allListeners.add(listener);
      return () => allListeners.delete(listener);
    },

    getVersion: () => version,
    getAvailability: () => availability,
    getCatalog: () => catalog,
    coversAvailable: () => availability === 'available' && catalog?.killSwitches.covers === false,

    setCatalog(info, failed = false) {
      const next = availabilityOf(info, failed);
      const nextRef = next === 'available' ? (info?.detailsIndex ?? null) : null;
      const sameIndex = nextRef?.path === indexRef?.path && nextRef?.sha256 === indexRef?.sha256;
      const changed =
        next !== availability ||
        !sameIndex ||
        info?.killSwitches.covers !== catalog?.killSwitches.covers;
      catalog = info;
      if (!changed) return;
      const wasAvailable = availability === 'available';
      availability = next;
      if (!sameIndex && nextRef) {
        // Índice nuevo: se vuelve a pedir todo lo pedido; mientras, se ve lo de antes.
        generation += 1;
        indexRef = nextRef;
        for (const appid of inFlight) queue.add(appid);
        inFlight.clear();
        for (const appid of entries.keys()) queue.add(appid);
      } else if (!nextRef) {
        indexRef = null;
      }
      if (next === 'available' && (!wasAvailable || !sameIndex)) scheduleFlush();
      notify([...listeners.keys()]);
    },

    wantCover() {
      coverDemand += 1;
      if (coverDemand === 1) notifyAll();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        coverDemand -= 1;
        if (coverDemand === 0) notifyAll();
      };
    },

    hasCoverDemand: () => coverDemand > 0,

    clear() {
      generation += 1;
      entries.clear();
      queue.clear();
      inFlight.clear();
      evicted.clear();
      void source?.then((loaded) => loaded.clearMemory()).catch(() => undefined);
      notify([...listeners.keys()]);
      // Lo que está en pantalla se vuelve a pedir.
      store.request([...listeners.keys()]);
    },

    dispose() {
      disposed = true;
      queue.clear();
      listeners.clear();
      allListeners.clear();
    },
  };
  return store;
}
