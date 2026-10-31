// Lanzamientos de Mi lista para Próximos y el orden por lanzamiento (§9.2). Las fechas vienen de
// los *shards* de detalles, así que solo se piden los que hacen falta, agrupados por *shard* (lo
// hace el almacén de detalles):
// - Próximos: primero el núcleo (una consulta al Worker de búsqueda) descarta lo publicado hace
//   años, y solo se piden los detalles de lo que queda (próximamente o del año en curso);
// - orden por lanzamiento: los de todas las entradas de la vista.
// Mientras faltan fechas, `lookup` es `null`: la lista no se reordena bajo el cursor (§9.5).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { type AgendaEntry, appidOf } from '../../agenda/types.ts';
import { useServices } from '../../app/services.tsx';
import { useDetailsStore } from '../../details/details-context.tsx';
import type { DetailsStore } from '../../details/details-store.ts';
import {
  type DayNumber,
  localToday,
  RECENT_DAYS,
  type ReleaseInfo,
  releaseFromCore,
  releaseFromDetails,
} from '../../details/release.ts';
import { type CoreGame, canSearchCatalog, GAME_FLAGS } from '../../search-client/index.ts';
import { filterEntries, type ListParams, type ReleaseLookup } from './list-model.ts';

/** Sin abrir Próximos, su contador se calcula en un rato ocioso si cuesta poco. */
const PREFETCH_MAX = 60;
const noopSubscribe = () => () => undefined;
const zero = () => 0;

function useCatalogKey(): string | null {
  const { search } = useServices();
  return useSyncExternalStore(search.subscribeStatus, () => {
    const status = search.getStatus();
    if (canSearchCatalog(status.state)) return status.version ?? 'sin-version';
    return status.error ? 'failed' : null;
  });
}

/** Filas del núcleo de `appids`; `null` mientras llegan. */
function useCoreLookup(
  appids: readonly number[],
  enabled: boolean,
): ReadonlyMap<number, CoreGame> | null {
  const { search } = useServices();
  const catalogKey = useCatalogKey();
  const key = enabled && catalogKey !== null ? `${catalogKey}|${appids.join(',')}` : null;
  const [result, setResult] = useState<{
    key: string;
    map: ReadonlyMap<number, CoreGame>;
  } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` ya resume `appids` y el catálogo.
  useEffect(() => {
    if (key === null) return;
    if (catalogKey === 'failed' || appids.length === 0) {
      setResult({ key, map: new Map() });
      return;
    }
    let live = true;
    search
      .lookup(appids)
      .then(({ found }) => {
        if (live) setResult({ key, map: new Map(found.map((game) => [game.appid, game])) });
      })
      .catch(() => {
        if (live) setResult({ key, map: new Map() });
      });
    return () => {
      live = false;
    };
  }, [key]);
  return result !== null && result.key === key ? result.map : null;
}

/** ¿Puede ir en Próximos? Lo publicado antes del año de hace 14 días, seguro que no. */
function isCandidate(game: CoreGame, today: DayNumber): boolean {
  if ((game.flags & GAME_FLAGS.comingSoon) !== 0 || game.year === null) return true;
  const cutoff = new Date((today - RECENT_DAYS) * 86_400_000).getUTCFullYear();
  return game.year >= cutoff;
}

function infoOf(
  store: DetailsStore,
  core: ReadonlyMap<number, CoreGame>,
  appid: number,
): ReleaseInfo | null {
  const game = core.get(appid);
  const state = store.get(appid);
  if (state.kind === 'ready' && state.details) {
    const { releaseTime, releasePrecision } = state.details;
    return {
      release: releaseFromDetails(releaseTime, releasePrecision),
      comingSoon: game ? (game.flags & GAME_FLAGS.comingSoon) !== 0 : null,
    };
  }
  return game ? releaseFromCore(game) : null;
}

function sameInfo(a: ReleaseInfo | null | undefined, b: ReleaseInfo | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.comingSoon === b.comingSoon && JSON.stringify(a.release) === JSON.stringify(b.release);
}

function sameMaps(
  a: ReadonlyMap<string, ReleaseInfo | null>,
  b: ReadonlyMap<string, ReleaseInfo | null>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (!sameInfo(value, b.get(key))) return false;
  return true;
}

export interface ReleasesResult {
  /** Lanzamientos de las entradas, o `null` mientras faltan. */
  readonly lookup: ReleaseLookup | null;
  /** Lo mismo solo para Próximos (su contador), aunque la vista sea otra. */
  readonly upcoming: ReleaseLookup | null;
}

export function useReleases(entries: readonly AgendaEntry[], params: ListParams): ReleasesResult {
  const store = useDetailsStore();
  const today = localToday(new Date());
  const showUpcoming = params.view === 'upcoming';
  const byRelease = params.order === 'release' && !showUpcoming;

  // Sin abrir Próximos, el contador de su chip se calcula en un rato ocioso.
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (idle) return;
    const done = () => setIdle(true);
    if (typeof requestIdleCallback === 'function') {
      const handle = requestIdleCallback(done, { timeout: 3000 });
      return () => cancelIdleCallback(handle);
    }
    const timer = setTimeout(done, 1500);
    return () => clearTimeout(timer);
  }, [idle]);

  const allAppids = useMemo(() => appidsOf(entries), [entries]);
  const viewAppids = useMemo(
    () => (byRelease ? appidsOf(filterEntries(entries, params)) : []),
    [entries, params, byRelease],
  );

  const core = useCoreLookup(allAppids, showUpcoming || byRelease || idle);
  const candidates = useMemo(() => {
    if (!core) return null;
    return allAppids.filter((appid) => {
      const game = core.get(appid);
      return game !== undefined && isCandidate(game, today);
    });
  }, [core, allAppids, today]);
  const upcomingActive =
    candidates !== null && (showUpcoming || (idle && candidates.length <= PREFETCH_MAX));
  const active = upcomingActive || (byRelease && core !== null);

  const coreReady = core !== null;
  const wantedKey = [
    upcomingActive ? (candidates ?? []).join(',') : '',
    byRelease && coreReady ? viewAppids.join(',') : '',
  ].join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `wantedKey` resume lo que se pide.
  useEffect(() => {
    if (upcomingActive && candidates) store.request(candidates);
    if (byRelease && coreReady) store.request(viewAppids);
  }, [store, wantedKey]);

  // Solo se repinta con los detalles nuevos si hace falta alguno.
  const version = useSyncExternalStore(
    active ? store.subscribeAll : noopSubscribe,
    active ? store.getVersion : zero,
  );

  const settledFor = (appids: readonly number[]) =>
    appids.every((appid) => store.get(appid).kind !== 'loading');

  const previous = useRef<{
    upcoming: ReleaseLookup | null;
    lookup: ReleaseLookup | null;
    map: ReadonlyMap<string, ReleaseInfo | null>;
  } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` cambia con cada detalle.
  return useMemo(() => {
    const upcomingReady = upcomingActive && candidates !== null && settledFor(candidates);
    const viewReady = byRelease && core !== null && settledFor(viewAppids);
    if (!core || (!upcomingReady && !viewReady)) {
      previous.current = null;
      return { lookup: null, upcoming: null };
    }
    const map = new Map<string, ReleaseInfo | null>();
    for (const entry of entries) {
      const appid = appidOf(entry.id);
      map.set(entry.id, appid === null ? null : infoOf(store, core, appid));
    }
    const last = previous.current;
    const reuse = last !== null && sameMaps(last.map, map);
    const lookup: ReleaseLookup =
      reuse && last.lookup ? last.lookup : { today, get: (entry) => map.get(entry.id) ?? null };
    const result = {
      upcoming: upcomingReady ? lookup : null,
      lookup: showUpcoming ? (upcomingReady ? lookup : null) : viewReady ? lookup : null,
    };
    previous.current = { ...result, lookup, map: reuse ? last.map : map };
    return result;
  }, [version, core, candidates, entries, upcomingActive, byRelease, showUpcoming, today, store]);
}

function appidsOf(entries: readonly AgendaEntry[]): number[] {
  const set = new Set<number>();
  for (const entry of entries) {
    const appid = appidOf(entry.id);
    if (appid !== null) set.add(appid);
  }
  return [...set];
}
