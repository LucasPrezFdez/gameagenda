// Orquestación de los pasos 0–5 de la §4.5 (el 6, publicar, queda fuera en M1): descargar
// (`collectInputs`) y construir y pasar las puertas (`buildCatalog`). Sin E/S de ficheros: la
// hace `build.ts`, así que las pruebas ejecutan todo con *fixtures* y en memoria.

import { CatalogFlag, type CoreCatalog } from '@gameagenda/core/catalog-format';
import type { GoldenQuery } from '@gameagenda/core/search-quality';
import type { RequestRecord, SteamClient } from '../steam/client.ts';
import { ENGLISH_ES } from '../steam/endpoints.ts';
import type { AppListEntry, StoreItem } from '../steam/schemas.ts';
import { type AliasBuild, buildAliases } from './aliases.ts';
import { appListPass } from './app-list.ts';
import { buildCatalogFiles, type CatalogFiles } from './catalog-files.ts';
import { isoSeconds, madridDate } from './clock.ts';
import {
  type CoverageReport,
  coverageReport,
  type DumpEntry,
  type FrozenDiff,
  frozenDiff,
} from './coverage.ts';
import {
  assemble,
  cleanName,
  type Exclusion,
  type Game,
  needsBaseName,
  type StateRow,
  stateRows,
} from './derive.ts';
import {
  type GateConfig,
  type GateOutcome,
  gatesPassed,
  PUBLISH_GATES,
  runGates,
} from './gates.ts';
import { type Classified, classifyAppids, getItems } from './get-items.ts';
import { type QueryPass, queryPass } from './query-pass.ts';

/** Parámetros de una ejecución: el catálogo real o el de prueba sobre `fixtures/steam/`. */
export interface Profile {
  readonly name: 'steam' | 'fixtures';
  readonly pageSize: number;
  readonly overlap: number;
  readonly maxPages?: number;
  /** Juegos por página de `GetAppList` (50 000). */
  readonly listPageSize: number;
  /** Mínimo de juegos de `GetAppList` para fiarse de la lista. */
  readonly minListApps: number;
  /** `false`: nunca compara con la versión anterior (el estado de los *fixtures* es parcial). */
  readonly deltaGates: boolean;
  readonly gates: GateConfig;
}

export const STEAM_PROFILE: Profile = {
  name: 'steam',
  pageSize: 1000,
  overlap: 50,
  listPageSize: 50_000,
  minListApps: 150_000,
  deltaGates: true,
  gates: PUBLISH_GATES,
};

/**
 * Lo que graba `fixtures:record`: dos páginas de Query de 20 con 5 de solape, `GetAppList` en
 * páginas de 40 y un mínimo pequeño; sin las puertas que comparan (el estado de partida solo
 * tiene los retirados y los inexistentes) y, de las de búsqueda, solo las consultas de humo.
 */
export const FIXTURES_PROFILE: Profile = {
  name: 'fixtures',
  pageSize: 20,
  overlap: 5,
  maxPages: 2,
  listPageSize: 40,
  minListApps: 1,
  deltaGates: false,
  gates: { ...PUBLISH_GATES, minGames: 20, quality: 'smoke' },
};

export interface Inputs {
  /** L (con clave); `null` en el plan B. */
  readonly list: ReadonlyMap<number, AppListEntry> | null;
  readonly query: QueryPass;
  /** H1 = L − Q y H2 = estado − L, clasificados con `GetItems`. */
  readonly h1: readonly number[];
  readonly h2: readonly number[];
  readonly gaps: ReadonlyMap<number, Classified>;
  /** Nombres base pedidos a `GetItems` en `english` y los que llegaron con nombre. */
  readonly baseNamesAsked: number;
  readonly baseNames: ReadonlyMap<number, string>;
  /** `GetItems` de los juegos del volcado que no están en L ni en los huecos (`--compare`). */
  readonly compare: ReadonlyMap<number, Classified> | null;
  readonly timings: Record<string, number>;
}

export interface CollectOptions {
  readonly keyless: boolean;
  readonly profile: Profile;
  readonly state: ReadonlyMap<number, StateRow>;
  readonly dump: readonly DumpEntry[] | null;
  readonly now: () => number;
  readonly log: (line: string) => void;
}

/** Pasos 1–3: lista, Query y huecos (más los nombres base del plan B y el contraste). */
export async function collectInputs(client: SteamClient, opts: CollectOptions): Promise<Inputs> {
  const { keyless, profile, state, dump, now, log } = opts;
  const timings: Record<string, number> = {};
  let t = now();
  const lap = (name: string): void => {
    const n = now();
    timings[name] = n - t;
    t = n;
  };

  const list = keyless
    ? null
    : await appListPass(client, { maxResults: profile.listPageSize, minApps: profile.minListApps });
  lap('list');
  if (list) log(`1 · Lista: ${list.size} juegos en GetAppList`);
  else log('1 · Lista: plan B sin clave (L := ids de Q)');

  const query = await queryPass(client, {
    pageSize: profile.pageSize,
    overlap: profile.overlap,
    ...(profile.maxPages !== undefined ? { maxPages: profile.maxPages } : {}),
    log,
  });
  lap('query');
  log(
    `2 · Query: ${query.items.size} juegos únicos en ${query.pages} páginas (total ${query.lastTotal})`,
  );

  const inL = (a: number): boolean => (list ? list.has(a) : query.items.has(a));
  const h1 = list ? [...list.keys()].filter((a) => !query.items.has(a)).sort((a, b) => a - b) : [];
  const h2 = [...state.keys()].filter((a) => !inL(a)).sort((a, b) => a - b);
  const gaps = await classifyAppids(client, [...h1, ...h2]);
  lap('gaps');

  // Nombre base: en el plan B, si el *slug* dice que el nombre está traducido; con clave, solo
  // si GetAppList y Query lo traen vacío.
  const ask: number[] = [];
  for (const [appid, it] of query.items) {
    if (it.type !== 0) continue;
    const listName = cleanName(list?.get(appid)?.name);
    if (list ? !listName && !cleanName(it.name) : needsBaseName(it)) ask.push(appid);
  }
  const english = await getItems(client, ask, ENGLISH_ES);
  const baseNames = new Map<number, string>();
  for (const [appid, it] of english) {
    const n = cleanName(it.name);
    if (n && it.success === 1) baseNames.set(appid, n);
  }
  lap('baseNames');
  log(
    `3 · Huecos: H1 ${h1.length}, H2 ${h2.length}; nombres base pedidos en inglés ${ask.length} (${baseNames.size} con nombre)`,
  );

  let compare: Map<number, Classified> | null = null;
  if (dump) {
    const only = dump
      .filter((d) => d.name && !inL(d.appid) && !gaps.has(d.appid))
      .map((d) => d.appid);
    compare = await classifyAppids(client, only);
    lap('compare');
    log(`   Contraste: ${only.length} juegos del volcado fuera de L, clasificados con GetItems`);
  }
  return {
    list,
    query,
    h1,
    h2,
    gaps,
    baseNamesAsked: ask.length,
    baseNames,
    compare,
    timings,
  };
}

/** Versión `AAAAMMDD.N` del día de `runAt` (Europe/Madrid), detrás de `previous` si es del mismo día. */
export function versionFor(runAt: number, previous: string | null): string {
  const day = madridDate(runAt).replaceAll('-', '');
  const m = previous?.match(/^(\d{8})\.(\d+)$/);
  const n = m && m[1] === day ? Number(m[2]) + 1 : 1;
  return `${day}.${n}`;
}

/** Cuántos juegos de Q traen cada campo (el punto «a verificar en M0» de la §4.5). */
export function fieldPresence(items: Iterable<StoreItem>): Record<string, number> {
  const out: Record<string, number> = {
    items: 0,
    is_free: 0,
    is_early_access: 0,
    is_coming_soon: 0,
    content_descriptorids: 0,
    'release.is_coming_soon': 0,
    'release.is_early_access': 0,
    'release.coming_soon_display': 0,
    'release.steam_release_date': 0,
    'reviews.summary_filtered.review_count': 0,
    store_url_slug: 0,
  };
  const inc = (k: string, v: unknown): void => {
    if (v !== undefined) out[k] = (out[k] ?? 0) + 1;
  };
  for (const it of items) {
    out.items = (out.items ?? 0) + 1;
    inc('is_free', it.is_free);
    inc('is_early_access', it.is_early_access);
    inc('is_coming_soon', it.is_coming_soon);
    inc('content_descriptorids', it.content_descriptorids);
    inc('release.is_coming_soon', it.release?.is_coming_soon);
    inc('release.is_early_access', it.release?.is_early_access);
    inc('release.coming_soon_display', it.release?.coming_soon_display);
    inc('release.steam_release_date', it.release?.steam_release_date);
    inc('reviews.summary_filtered.review_count', it.reviews?.summary_filtered?.review_count);
    inc('store_url_slug', it.store_url_slug);
  }
  return out;
}

interface Stats {
  readonly n: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly min: number;
  readonly max: number;
  readonly sum: number;
}

function stats(xs: readonly number[]): Stats {
  const s = [...xs].sort((a, b) => a - b);
  const q = (f: number): number =>
    s[Math.min(s.length - 1, Math.max(0, Math.ceil(f * s.length) - 1))] ?? 0;
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    mean: s.length ? Math.round(sum / s.length) : 0,
    p50: q(0.5),
    p95: q(0.95),
    min: s[0] ?? 0,
    max: s[s.length - 1] ?? 0,
    sum,
  };
}

/** Resumen de peticiones por endpoint: cuántas, de la caché, estados, peso y tiempo. */
export function requestSummary(records: readonly RequestRecord[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const byEndpoint = new Map<string, RequestRecord[]>();
  for (const r of records) byEndpoint.set(r.endpoint, [...(byEndpoint.get(r.endpoint) ?? []), r]);
  for (const [endpoint, rs] of byEndpoint) {
    const ok = rs.filter((r) => r.status === 200);
    const statuses: Record<string, number> = {};
    for (const r of rs) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    out[endpoint] = {
      responses: rs.length,
      network: rs.filter((r) => !r.cached).length,
      fromRawPages: rs.filter((r) => r.cached).length,
      statuses,
      wireBytes: stats(ok.map((r) => r.wireBytes)),
      bodyBytes: stats(ok.map((r) => r.bodyBytes)),
      ms: stats(ok.map((r) => r.ms)),
    };
  }
  return out;
}

export interface BuildOptions extends CollectOptions {
  readonly frozen: CoreCatalog | null;
  readonly golden: readonly GoldenQuery[];
  readonly skipDeltaGates: boolean;
  /** Momento de la ejecución: da la versión y `generatedAt`. */
  readonly runAt: number;
  /** Versión publicada anterior (para `.N`); o la versión exacta con `version`. */
  readonly previousVersion: string | null;
  readonly version?: string;
}

export interface BuildResult {
  readonly ok: boolean;
  readonly version: string;
  readonly inputs: Inputs;
  readonly games: readonly Game[];
  readonly excluded: readonly Exclusion[];
  readonly aliases: AliasBuild;
  readonly files: CatalogFiles;
  readonly gates: readonly GateOutcome[];
  readonly state: readonly StateRow[];
  readonly coverage: CoverageReport | null;
  readonly frozenDiff: FrozenDiff | null;
  readonly summary: Record<string, unknown>;
}

function countBits(games: readonly Game[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, bit] of Object.entries(CatalogFlag)) {
    out[name] = games.filter((g) => (g.flags & bit) !== 0).length;
  }
  return out;
}

/** Pasos 0–5 de la §4.5 con el cliente dado: descarga, construye y pasa las puertas. */
export async function buildCatalog(client: SteamClient, opts: BuildOptions): Promise<BuildResult> {
  const { state, now, log } = opts;
  log(
    `0 · Estado: ${state.size === 0 ? 'sin estado (todo es alta)' : `${state.size} juegos conocidos`}`,
  );
  const inputs = await collectInputs(client, opts);
  const t0 = now();
  const today = madridDate(opts.runAt);
  const version = opts.version ?? versionFor(opts.runAt, opts.previousVersion);
  const { games, excluded } = assemble({
    list: inputs.list,
    query: inputs.query.items,
    gaps: inputs.gaps,
    baseNames: inputs.baseNames,
    state,
    today,
  });
  const aliases = buildAliases(games);
  const files = buildCatalogFiles(games, aliases.pairs, {
    version,
    generatedAt: isoSeconds(opts.runAt),
  });
  inputs.timings.build = now() - t0;
  const byReason: Record<string, number> = {};
  for (const e of excluded) byReason[e.reason] = (byReason[e.reason] ?? 0) + 1;
  log(
    `4 · Construir ${version}: ${games.length} juegos, ${aliases.pairs.length} alias; fuera ${excluded.length} (${JSON.stringify(byReason)})`,
  );

  const t1 = now();
  const previous =
    state.size > 0
      ? { count: state.size, names: new Map([...state.values()].map((r) => [r.appid, r.name])) }
      : null;
  const gates = await runGates({
    files,
    names: new Map(games.map((g) => [g.appid, g.name])),
    previous,
    skipDelta: opts.skipDeltaGates || !opts.profile.deltaGates,
    golden: opts.golden,
    cfg: opts.profile.gates,
  });
  inputs.timings.gates = now() - t1;
  const ok = gatesPassed(gates);
  log(`5 · Puertas: ${ok ? 'todas en verde' : 'FALLA ALGUNA'}`);
  for (const g of gates)
    log(`   ${g.status === 'pass' ? '✓' : g.status === 'skip' ? '–' : '✗'} ${g.id}: ${g.detail}`);

  const coverage =
    opts.dump && inputs.compare
      ? coverageReport({ dump: opts.dump, games, excluded, classified: inputs.compare })
      : null;
  const fdiff = opts.frozen ? frozenDiff(opts.frozen, games) : null;
  const summary = {
    version,
    generatedAt: files.manifest.generatedAt,
    mode: opts.keyless ? 'sin clave (plan B)' : 'con clave',
    profile: opts.profile.name,
    skipDeltaGates: opts.skipDeltaGates,
    counts: {
      list: inputs.list?.size ?? null,
      queryUnique: inputs.query.items.size,
      queryRows: inputs.query.rows,
      queryPages: inputs.query.pages,
      queryTotalFirst: inputs.query.firstTotal,
      queryTotalLast: inputs.query.lastTotal,
      queryTruncated: inputs.query.truncated,
      h1: inputs.h1.length,
      h2: inputs.h2.length,
      baseNamesAsked: inputs.baseNamesAsked,
      baseNamesFound: inputs.baseNames.size,
      core: games.length,
      nameEs: games.filter((g) => g.nameEs).length,
      withReviews: games.filter((g) => g.reviews > 0).length,
      maxPop: games.reduce((m, g) => Math.max(m, g.pop), 0),
      byClass: {
        visible: games.filter((g) => g.cls === 'visible').length,
        retired: games.filter((g) => g.cls === 'retired').length,
        blocked: games.filter((g) => g.cls === 'blocked').length,
      },
      flags: countBits(games),
      aliases: aliases.pairs.length,
      aliasesGenerated: aliases.generated,
      aliasesCurated: aliases.curated,
      aliasesMissing: aliases.missing,
      excluded: byReason,
    },
    files: files.manifest.files,
    fieldPresence: fieldPresence(inputs.query.items.values()),
    requests: requestSummary(client.records),
    timingsMs: inputs.timings,
    gates: gates.map((g) => ({ id: g.id, status: g.status, detail: g.detail })),
  };
  return {
    ok,
    version,
    inputs,
    games,
    excluded,
    aliases,
    files,
    gates,
    state: stateRows(games),
    coverage,
    frozenDiff: fdiff,
    summary,
  };
}
