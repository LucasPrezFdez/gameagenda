// Juegos provisionales (RF-04, §7.3): cuando el catálogo local cambia de `version` (también al
// cargarse en cada arranque), se buscan sus `appid` y se pone al día el título de las entradas de
// Steam con `refreshCatalogCopy`, sin cambiar de id. También recoge los cambios de nombre.
//
// M4 (CA4.5): los juegos apuntados después (un enlace pegado, el buzón del Atajo de iOS, lo que
// llega de otro dispositivo) se buscan también, poco después de llegar: cuando la agenda crece. Y
// lo que no está en el catálogo entero (en `scan` o `full`; en `boot` solo están los más populares)
// pregunta su nombre a `resolve`:
// - solo si este dispositivo sincroniza (`canResolve`; decisión del usuario, 08-11-2026): quien no
//   sincroniza no hace ninguna petición a `/api`, y su provisional espera al catálogo;
// - de uno en uno, y cada juego como mucho una vez cada 7 días (`memory`, en `meta.resolveAsked`);
// - sin red, con el límite o con la micro-API apagada, todo espera (`later` de alcance `all`); si
//   falla un juego, solo él (`one`), y los demás siguen.
import { isLive, isSteamEntryId, parseEntryId, steamEntryId } from '@gameagenda/core/entries';
import { logError } from '../errors/error-log.ts';
import { displayName } from '../palette/palette-model.ts';
import { type CatalogState, canSearchCatalog, type SearchClient } from '../search-client/index.ts';
import type { ResolveName } from './resolve-client.ts';
import type { AgendaEntry, AgendaStore } from './types.ts';

/** A cuándo se preguntó por cada `appid` (ms), de esta sesión y de las anteriores. */
export interface ResolveMemory {
  load(): Promise<ReadonlyMap<number, number>>;
  save(asked: ReadonlyMap<number, number>): void;
}

export interface CatalogRefreshOptions {
  /** `resolve` de la micro-API (M4): sin él, lo que no está en el catálogo se queda provisional. */
  readonly resolve?: ResolveName;
  /** Si se puede preguntar ahora a `resolve` (en la app: si este dispositivo sincroniza). */
  readonly canResolve?: () => boolean;
  /** Avisa de que `canResolve` puede haber cambiado: al pasar a `true`, se pregunta lo pendiente. */
  readonly subscribeCanResolve?: (listener: () => void) => () => void;
  /** Lo preguntado en sesiones anteriores (sin ella, solo se recuerda en esta). */
  readonly memory?: ResolveMemory;
  /** `navigator.onLine` por defecto. */
  readonly isOnline?: () => boolean;
  readonly now?: () => number;
  /** Tras crecer la agenda, cuánto se espera para mirar sus entradas nuevas. */
  readonly settleMs?: number;
  /** Donde se escucha `online` (por defecto, `window`; `null`: en ninguna parte). */
  readonly events?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

/** Tras apuntar, la búsqueda espera un poco: el fotograma de la confirmación va antes (§9.5). */
export const SETTLE_MS = 50;
/** Un juego por el que ya se preguntó no se vuelve a preguntar en 7 días. */
export const ASK_AGAIN_MS = 7 * 86_400_000;

function steamIds(entries: readonly AgendaEntry[]): string[] {
  return entries.filter((e) => isSteamEntryId(e.id)).map((e) => e.id);
}

function appidOf(id: string): number | null {
  const parsed = parseEntryId(id);
  return parsed?.kind === 'steam' ? parsed.appid : null;
}

export function startCatalogRefresh(
  search: SearchClient,
  agenda: AgendaStore,
  options: CatalogRefreshOptions = {},
): () => void {
  const isOnline = options.isOnline ?? (() => globalThis.navigator?.onLine !== false);
  const canResolve = options.canResolve ?? (() => true);
  const now = options.now ?? Date.now;
  const events =
    options.events === undefined ? (typeof window === 'undefined' ? null : window) : options.events;

  /** La versión (y `|boot`) de la última búsqueda completa. */
  let done: string | null = null;
  /** Las entradas ya buscadas con esa versión. */
  let known = new Set<string>();
  /** `appid` que no están en el catálogo y esperan a `resolve` (por orden de llegada). */
  const waiting = new Set<number>();
  /** Cuándo se puede volver a preguntar por un `appid` que falló él solo. */
  const retryAt = new Map<number, number>();
  /** A cuándo se preguntó por cada `appid` (`memory`, cargada la primera vez que hace falta). */
  let asked: Map<number, number> | null = null;
  /** Todo espera hasta aquí: sin red de verdad, con el límite o con la micro-API apagada. */
  let pausedUntil = 0;
  let resolving = false;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function askedMap(): Promise<Map<number, number>> {
    if (asked !== null) return asked;
    let loaded: ReadonlyMap<number, number> = new Map();
    try {
      loaded = (await options.memory?.load()) ?? loaded;
    } catch (error) {
      logError('storage', error);
    }
    asked ??= new Map(loaded);
    return asked;
  }

  function remember(map: Map<number, number>, appid: number): void {
    const t = now();
    map.set(appid, t);
    for (const [id, at] of map) if (t - at >= ASK_AGAIN_MS) map.delete(id);
    options.memory?.save(map);
  }

  /** Lo siguiente por preguntar ya, o `undefined`. */
  function nextAppid(): number | undefined {
    const t = now();
    for (const appid of waiting) if ((retryAt.get(appid) ?? 0) <= t) return appid;
    return undefined;
  }

  /** Si quedan juegos esperando un plazo, vuelve a mirar cuando venza el primero. */
  function scheduleRetry(): void {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    if (stopped || waiting.size === 0) return;
    let earliest = Number.POSITIVE_INFINITY;
    for (const appid of waiting) earliest = Math.min(earliest, retryAt.get(appid) ?? 0);
    const wake = Math.max(earliest, pausedUntil) - now();
    if (wake > 0 && Number.isFinite(wake)) retryTimer = setTimeout(run, wake);
  }

  async function flush(): Promise<void> {
    const resolve = options.resolve;
    if (resolving || resolve === undefined || stopped || waiting.size === 0) return;
    if (!canResolve()) return;
    resolving = true;
    try {
      const memory = await askedMap();
      // Vuelve a mirar `waiting` en cada vuelta: lo que llega mientras tanto también se pregunta.
      for (;;) {
        if (stopped || !canResolve() || !isOnline() || now() < pausedUntil) return;
        const appid = nextAppid();
        if (appid === undefined) return;
        const id = steamEntryId(appid);
        const at = memory.get(appid);
        if (!isLive(agenda.get(id)) || (at !== undefined && now() - at < ASK_AGAIN_MS)) {
          waiting.delete(appid);
          continue;
        }
        const result = await resolve(appid);
        if (result.kind === 'later') {
          if (result.scope === 'all') pausedUntil = now() + result.retryAfterMs;
          else retryAt.set(appid, now() + result.retryAfterMs);
          continue;
        }
        waiting.delete(appid);
        retryAt.delete(appid);
        remember(memory, appid);
        if (result.kind === 'name') agenda.refreshFromCatalog([{ id, title: result.name }]);
      }
    } finally {
      resolving = false;
      scheduleRetry();
    }
  }

  async function lookUp(ids: readonly string[], state: CatalogState): Promise<void> {
    const appids = ids.map(appidOf).filter((a): a is number => a !== null);
    if (appids.length === 0) return;
    const { found, missing } = await search.lookup(appids);
    agenda.refreshFromCatalog(
      found.map((game) => ({ id: steamEntryId(game.appid), title: displayName(game) })),
    );
    // En `boot` solo están los 20 000 más populares: lo que falta puede estar en el núcleo.
    if (state === 'boot') return;
    for (const appid of missing) waiting.add(appid);
  }

  async function check(): Promise<void> {
    const { state, version } = search.getStatus();
    // En `boot` (M3) se vuelve a mirar en `scan`, con la misma versión: un enlace pegado mientras
    // tanto de un juego que no está entre los más populares ha quedado provisional.
    const key = state === 'boot' ? `${version}|boot` : version;
    if (!canSearchCatalog(state) || version === null) return;
    let ids: string[];
    if (key !== done) {
      done = key;
      ids = steamIds(agenda.getSnapshot());
      known = new Set(ids);
    } else {
      // Lo apuntado en `boot` se mira todo junto al llegar a `scan`.
      if (state === 'boot') return;
      ids = steamIds(agenda.getSnapshot()).filter((id) => !known.has(id));
      for (const id of ids) known.add(id);
    }
    await lookUp(ids, state);
    await flush();
  }

  function run(): void {
    if (stopped) return;
    check().catch((error: unknown) => logError('worker', error));
  }

  function settle(): void {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      run();
    }, options.settleMs ?? SETTLE_MS);
  }

  // Solo cuando la agenda crece (algo apuntado, recuperado o llegado de otro dispositivo): un
  // cambio de estado, de orden o de nota no trae juegos nuevos, y así no se recorre la agenda
  // entera con cada uno.
  let liveCount = agenda.getSnapshot().length;
  const onAgenda = () => {
    const count = agenda.getSnapshot().length;
    if (count > liveCount) settle();
    liveCount = count;
  };
  // Solo al pasar a poder preguntar (p. ej., al activar la sincronización): el estado de la
  // sincronización cambia con cada ronda, y no hace falta mirar la agenda cada vez.
  let couldResolve = canResolve();
  const onCanResolve = () => {
    const can = canResolve();
    if (can && !couldResolve) run();
    couldResolve = can;
  };
  const onOnline = () => run();
  run();
  const stopStatus = search.subscribeStatus(run);
  const stopAgenda = agenda.subscribe(onAgenda);
  const stopCanResolve = options.subscribeCanResolve?.(onCanResolve) ?? (() => undefined);
  events?.addEventListener('online', onOnline);
  return () => {
    stopped = true;
    stopStatus();
    stopAgenda();
    stopCanResolve();
    events?.removeEventListener('online', onOnline);
    if (settleTimer !== null) clearTimeout(settleTimer);
    if (retryTimer !== null) clearTimeout(retryTimer);
  };
}
