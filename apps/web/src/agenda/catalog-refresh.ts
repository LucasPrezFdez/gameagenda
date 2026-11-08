// Juegos provisionales (RF-04, §7.3): cuando el catálogo local cambia de `version` (también al
// cargarse en cada arranque), se buscan sus `appid` y se pone al día el título de las entradas de
// Steam con `refreshCatalogCopy`, sin cambiar de id. También recoge los cambios de nombre.
//
// M4 (CA4.5): los juegos apuntados después (un enlace pegado, el buzón del Atajo de iOS, lo que
// llega de otro dispositivo) se buscan también, poco después de llegar. Y lo que no está en el
// catálogo entero (en `scan` o `full`; en `boot` solo están los más populares) pregunta su nombre
// a `resolve`, una vez por sesión y juego: sin red o con un fallo, se vuelve a intentar más tarde.
import { isLive, isSteamEntryId, parseEntryId, steamEntryId } from '@gameagenda/core/entries';
import { logError } from '../errors/error-log.ts';
import { displayName } from '../palette/palette-model.ts';
import { type CatalogState, canSearchCatalog, type SearchClient } from '../search-client/index.ts';
import type { ResolveName } from './resolve-client.ts';
import type { AgendaEntry, AgendaStore } from './types.ts';

export interface CatalogRefreshOptions {
  /** `resolve` de la micro-API (M4): sin él, lo que no está en el catálogo se queda provisional. */
  readonly resolve?: ResolveName;
  /** `navigator.onLine` por defecto. */
  readonly isOnline?: () => boolean;
  readonly now?: () => number;
  /** Tras un cambio en la agenda, cuánto se espera para mirar sus entradas nuevas. */
  readonly settleMs?: number;
  /** Donde se escucha `online` (por defecto, `window`; `null`: en ninguna parte). */
  readonly events?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

/** Tras apuntar, la búsqueda espera un poco: el fotograma de la confirmación va antes (§9.5). */
export const SETTLE_MS = 50;

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
  const now = options.now ?? Date.now;
  const events =
    options.events === undefined ? (typeof window === 'undefined' ? null : window) : options.events;

  /** La versión (y `|boot`) de la última búsqueda completa. */
  let done: string | null = null;
  /** Las entradas ya buscadas con esa versión. */
  let known = new Set<string>();
  /** `appid` que no están en el catálogo y esperan a `resolve`. */
  const waiting = new Set<number>();
  /** Ya preguntados en esta sesión (con nombre o sin él). */
  const asked = new Set<number>();
  let pausedUntil = 0;
  let resolving = false;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function flush(): Promise<void> {
    const resolve = options.resolve;
    if (resolving || resolve === undefined || stopped) return;
    resolving = true;
    try {
      for (const appid of [...waiting]) {
        if (stopped || !isOnline() || now() < pausedUntil) return;
        const id = steamEntryId(appid);
        if (!isLive(agenda.get(id))) {
          waiting.delete(appid);
          continue;
        }
        const result = await resolve(appid);
        if (result.kind === 'later') {
          pausedUntil = now() + result.retryAfterMs;
          if (retryTimer !== null) clearTimeout(retryTimer);
          retryTimer = setTimeout(run, result.retryAfterMs);
          return;
        }
        waiting.delete(appid);
        asked.add(appid);
        if (result.kind === 'name') agenda.refreshFromCatalog([{ id, title: result.name }]);
      }
    } finally {
      resolving = false;
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
    for (const appid of missing) if (!asked.has(appid)) waiting.add(appid);
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

  const onOnline = () => run();
  run();
  const stopStatus = search.subscribeStatus(run);
  const stopAgenda = agenda.subscribe(settle);
  events?.addEventListener('online', onOnline);
  return () => {
    stopped = true;
    stopStatus();
    stopAgenda();
    events?.removeEventListener('online', onOnline);
    if (settleTimer !== null) clearTimeout(settleTimer);
    if (retryTimer !== null) clearTimeout(retryTimer);
  };
}
