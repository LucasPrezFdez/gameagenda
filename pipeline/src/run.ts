// Orquestación de los pasos 0–5 de la §4.5 y de la firma del paso 6 (desplegar y subir el estado
// quedan fuera): descargar (`collectInputs`) y construir, pasar las puertas y firmar
// (`buildCatalog`). Sin E/S de ficheros: la hace `build.ts`, así que las pruebas ejecutan todo con
// *fixtures* y en memoria.

import { CatalogFlag, type CoreCatalog, trustedSigningKeys } from '@gameagenda/core/catalog-format';
import type { GoldenQuery } from '@gameagenda/core/search-quality';
import { type RequestRecord, type SteamClient, SteamError } from '../steam/client.ts';
import { ENGLISH_ES } from '../steam/endpoints.ts';
import type { AppListEntry, StoreItem } from '../steam/schemas.ts';
import { type AliasBuild, buildAliases } from './aliases.ts';
import { appListPass } from './app-list.ts';
import {
  buildCatalogFiles,
  type CatalogFiles,
  MIN_CLIENT_VERSION,
  MIN_CLIENT_VERSION_SIGNED,
  withSignature,
} from './catalog-files.ts';
import { daysBetween, isoSeconds, madridDate } from './clock.ts';
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
import { KILL_SWITCHES_OFF, type KillSwitches } from './kill-switches.ts';
import { type QueryPass, queryPass } from './query-pass.ts';
import { markRecent, recentGames } from './recent.ts';
import { type Signer, verifyManifest } from './signing.ts';
import type { StateMeta } from './state.ts';

/** Parámetros de una ejecución: el catálogo real o el de prueba sobre `fixtures/steam/`. */
export interface Profile {
  readonly name: 'steam' | 'fixtures' | 'world';
  readonly pageSize: number;
  readonly overlap: number;
  readonly maxPages?: number;
  /** Juegos por página de `GetAppList` (50 000). */
  readonly listPageSize: number;
  /** Mínimo de juegos de `GetAppList` para fiarse de la lista. */
  readonly minListApps: number;
  /**
   * Con clave: parte de L que Query tiene que devolver para fiarse de su enriquecimiento (el
   * 29-10-2026, el 99,88 %). Por debajo, Query cuenta como caída (§4.8).
   */
  readonly minQueryCoverage: number;
  /** `appid` como mucho en los huecos (H1 ∪ H2): 20 lotes de `GetItems`, el margen de la §4.7. */
  readonly maxGapIds: number;
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
  minQueryCoverage: 0.95,
  maxGapIds: 4000,
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
  // Dos páginas de Query frente a toda la lista sintética: no se exige cobertura.
  minQueryCoverage: 0,
  maxGapIds: 4000,
  deltaGates: false,
  gates: { ...PUBLISH_GATES, minGames: 20, quality: 'smoke' },
};

/** Una etapa que falló sin tumbar la ejecución (§4.8): se publica con lo que hay. */
export interface StageFailure {
  readonly stage: 'query' | 'gaps' | 'baseNames';
  readonly kind: string;
  readonly message: string;
}

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
  /**
   * Si falló Query con clave (§4.6: «si falla solo el enriquecimiento»): se publican los nombres
   * de `GetAppList` con el último enriquecimiento del estado.
   */
  readonly enrichmentFailed: StageFailure | null;
  /** Etapas secundarias que fallaron (`GetItems`): se publica igual y lo anota el informe. */
  readonly degraded: readonly StageFailure[];
  readonly timings: Record<string, number>;
}

const EMPTY_QUERY: QueryPass = {
  items: new Map(),
  pages: 0,
  firstTotal: 0,
  lastTotal: 0,
  rows: 0,
  truncated: false,
};

/**
 * Un fallo de Steam que no tumba la ejecución. Una página cruda o un *fixture* que falta sí: al
 * volver a derivar (`--from-raw`) o en las pruebas tiene que salir lo mismo.
 */
function stageFailure(stage: StageFailure['stage'], e: unknown): StageFailure | null {
  if (!(e instanceof SteamError) || e.kind === 'missing-fixture') return null;
  return { stage, kind: e.kind, message: e.message };
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

  // Con clave, que falle Query no tumba la ejecución: se publican los nombres de GetAppList con el
  // último enriquecimiento (§4.6 y §4.8). Sin clave, Query es también la lista: sin ella no hay
  // catálogo.
  let query = EMPTY_QUERY;
  let enrichmentFailed: StageFailure | null = null;
  const degraded: StageFailure[] = [];
  try {
    query = await queryPass(client, {
      pageSize: profile.pageSize,
      overlap: profile.overlap,
      ...(profile.maxPages !== undefined ? { maxPages: profile.maxPages } : {}),
      log,
    });
  } catch (e) {
    enrichmentFailed = list ? stageFailure('query', e) : null;
    if (!enrichmentFailed) throw e;
  }
  if (list && !enrichmentFailed) {
    let inList = 0;
    for (const a of query.items.keys()) if (list.has(a)) inList++;
    if (inList < profile.minQueryCoverage * list.size) {
      enrichmentFailed = {
        stage: 'query',
        kind: 'coverage',
        message: `Query devolvió ${inList} de los ${list.size} juegos de GetAppList`,
      };
      query = EMPTY_QUERY;
    }
  }
  lap('query');
  if (enrichmentFailed) {
    log(
      `2 · Query FALLA (${enrichmentFailed.kind}: ${enrichmentFailed.message}): nombres de GetAppList con el último enriquecimiento`,
    );
  } else {
    log(
      `2 · Query: ${query.items.size} juegos únicos en ${query.pages} páginas (total ${query.lastTotal})`,
    );
  }

  const inL = (a: number): boolean => (list ? list.has(a) : query.items.has(a));
  // Sin Query, H1 sería toda la lista (≈1 000 lotes): solo se clasifican los que desaparecen.
  const h1 =
    list && !enrichmentFailed
      ? [...list.keys()].filter((a) => !query.items.has(a)).sort((a, b) => a - b)
      : [];
  const h2 = [...state.keys()].filter((a) => !inL(a)).sort((a, b) => a - b);
  const gapIds = [...h1, ...h2];
  if (gapIds.length > profile.maxGapIds) {
    degraded.push({
      stage: 'gaps',
      kind: 'budget',
      message: `${gapIds.length} huecos; se clasifican ${profile.maxGapIds} (§4.7)`,
    });
  }
  const toClassify = gapIds.slice(0, profile.maxGapIds);
  let gaps: Map<number, Classified>;
  try {
    gaps = await classifyAppids(client, toClassify);
  } catch (e) {
    const failure = stageFailure('gaps', e);
    if (!failure) throw e;
    degraded.push(failure);
    gaps = new Map();
  }
  // Lo que no se pudo clasificar se conserva como esté en el estado (o en L).
  for (const a of gapIds) {
    if (!gaps.has(a)) {
      gaps.set(a, { cls: 'unknown', item: null, country: null, reason: 'sin clasificar' });
    }
  }
  lap('gaps');

  // Nombre base: en el plan B, si el *slug* dice que el nombre está traducido; con clave, solo
  // si GetAppList y Query lo traen vacío.
  const ask: number[] = [];
  for (const [appid, it] of query.items) {
    if (it.type !== 0) continue;
    const listName = cleanName(list?.get(appid)?.name);
    if (list ? !listName && !cleanName(it.name) : needsBaseName(it)) ask.push(appid);
  }
  const baseNames = new Map<number, string>();
  try {
    for (const [appid, it] of await getItems(client, ask, ENGLISH_ES)) {
      const n = cleanName(it.name);
      if (n && it.success === 1) baseNames.set(appid, n);
    }
  } catch (e) {
    const failure = stageFailure('baseNames', e);
    if (!failure) throw e;
    degraded.push(failure);
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
    enrichmentFailed,
    degraded,
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
      keyed: rs.filter((r) => r.keyed).length,
      fromRawPages: rs.filter((r) => r.cached).length,
      statuses,
      wireBytes: stats(ok.map((r) => r.wireBytes)),
      bodyBytes: stats(ok.map((r) => r.bodyBytes)),
      ms: stats(ok.map((r) => r.ms)),
    };
  }
  return out;
}

/**
 * Presupuesto del CA2.1: llamadas a Steam (las de la red, con reintentos), cuántas con clave, el
 * ritmo máximo entre dos inicios seguidos y la duración de la pasada.
 */
export function budgetSummary(records: readonly RequestRecord[]): {
  calls: number;
  keyed: number;
  maxPerSecond: number;
  minGapMs: number | null;
  spanMs: number;
} {
  const net = records.filter((r) => !r.cached);
  const starts = net.map((r) => r.startedAt).sort((a, b) => a - b);
  let minGap: number | null = null;
  for (let i = 1; i < starts.length; i++) {
    const gap = (starts[i] as number) - (starts[i - 1] as number);
    if (minGap === null || gap < minGap) minGap = gap;
  }
  return {
    calls: net.length,
    keyed: net.filter((r) => r.keyed).length,
    maxPerSecond: minGap ? +(1000 / minGap).toFixed(3) : 0,
    minGapMs: minGap,
    spanMs: starts.length > 1 ? (starts[starts.length - 1] as number) - (starts[0] as number) : 0,
  };
}

export interface BuildOptions extends CollectOptions {
  /** Cabecera del estado: versión publicada y día del último enriquecimiento. */
  readonly stateMeta?: StateMeta;
  readonly frozen: CoreCatalog | null;
  readonly golden: readonly GoldenQuery[];
  readonly skipDeltaGates: boolean;
  /** Momento de la ejecución: da la versión y `generatedAt`. */
  readonly runAt: number;
  /** Versión publicada anterior (para `.N`); o la versión exacta con `version`. */
  readonly previousVersion: string | null;
  readonly version?: string;
  readonly killSwitches?: KillSwitches;
  /** Clave con la que se firma el *manifest* si pasan las puertas; `null`, sin firma. */
  readonly signer?: Signer | null;
}

export interface BuildResult {
  readonly ok: boolean;
  readonly version: string;
  readonly inputs: Inputs;
  readonly games: readonly Game[];
  readonly excluded: readonly Exclusion[];
  readonly aliases: AliasBuild;
  /** Con el *manifest* firmado si hay `signer` y pasan las puertas. */
  readonly files: CatalogFiles;
  readonly gates: readonly GateOutcome[];
  readonly state: readonly StateRow[];
  /** Cabecera del estado nuevo. */
  readonly stateMeta: { readonly version: string; readonly enrichedOn: string };
  readonly enrichmentAgeDays: number;
  readonly recent: readonly Game[];
  readonly coverage: CoverageReport | null;
  readonly frozenDiff: FrozenDiff | null;
  readonly summary: Record<string, unknown>;
}

/** Último día con una pasada de Query correcta, del estado (o de sus filas, si es de M1). */
function lastEnrichedOn(state: ReadonlyMap<number, StateRow>, meta?: StateMeta): string | null {
  if (meta?.enrichedOn) return meta.enrichedOn;
  let latest = '';
  for (const r of state.values()) if (r.enrichedOn > latest) latest = r.enrichedOn;
  return latest || null;
}

function countBits(games: readonly Game[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, bit] of Object.entries(CatalogFlag)) {
    out[name] = games.filter((g) => (g.flags & bit) !== 0).length;
  }
  return out;
}

/**
 * Pasos 0–5 de la §4.5 con el cliente dado: descarga, construye y pasa las puertas; si pasan y hay
 * clave de firma, firma el *manifest* (el despliegue y la subida del estado son de `catalog.yml`).
 */
export async function buildCatalog(client: SteamClient, opts: BuildOptions): Promise<BuildResult> {
  const { state, now, log } = opts;
  log(
    `0 · Estado: ${state.size === 0 ? 'sin estado (todo es alta)' : `${state.size} juegos conocidos`}`,
  );
  const inputs = await collectInputs(client, opts);
  const t0 = now();
  const today = madridDate(opts.runAt);
  const version = opts.version ?? versionFor(opts.runAt, opts.previousVersion);
  // Si solo falló Query, crece la edad del enriquecimiento (§4.6; CA2.2).
  const enrichedBefore = lastEnrichedOn(state, opts.stateMeta);
  if (inputs.enrichmentFailed && !enrichedBefore) {
    throw new Error('Query falla y no hay estado con un enriquecimiento anterior');
  }
  const enrichedOn = inputs.enrichmentFailed ? (enrichedBefore as string) : today;
  const enrichmentAgeDays = Math.max(0, daysBetween(enrichedOn, today));
  const assembled = assemble({
    list: inputs.list,
    query: inputs.query.items,
    gaps: inputs.gaps,
    baseNames: inputs.baseNames,
    state,
    today,
  });
  const { excluded } = assembled;
  const games = markRecent(assembled.games, state, today);
  const recent = recentGames(games, today);
  const aliases = buildAliases(games);
  const signer = opts.signer ?? null;
  let files = buildCatalogFiles(
    games,
    aliases.pairs,
    {
      version,
      generatedAt: isoSeconds(opts.runAt),
      enrichmentAgeDays,
      minClientVersion: signer ? MIN_CLIENT_VERSION_SIGNED : MIN_CLIENT_VERSION,
      killSwitches: opts.killSwitches ?? KILL_SWITCHES_OFF,
    },
    recent,
  );
  inputs.timings.build = now() - t0;
  const byReason: Record<string, number> = {};
  for (const e of excluded) byReason[e.reason] = (byReason[e.reason] ?? 0) + 1;
  log(
    `4 · Construir ${version}: ${games.length} juegos, ${aliases.pairs.length} alias, ${recent.length} recientes, ${files.details.games} con detalles en ${files.details.shards.size} shards; fuera ${excluded.length} (${JSON.stringify(byReason)})`,
  );
  if (enrichmentAgeDays > 0) {
    log(`   enrichmentAgeDays ${enrichmentAgeDays}: último enriquecimiento del ${enrichedOn}`);
  }
  for (const d of inputs.degraded) log(`   ! ${d.stage} (${d.kind}): ${d.message}`);

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

  // Se firma solo lo que pasa las puertas, y se comprueba la firma como lo hará la app.
  if (ok && signer) {
    files = withSignature(files, signer);
    const keys = trustedSigningKeys({ dev: signer.use === 'dev' });
    if (!verifyManifest(files.manifestJson, keys)) {
      throw new Error('La firma del manifest no se verifica con su clave pública');
    }
    log(`   firmado con «${signer.kid}» (${signer.use})`);
  }

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
    signature: files.manifest.sig ? { kid: files.manifest.sig.kid, use: signer?.use } : null,
    enrichment: {
      ageDays: enrichmentAgeDays,
      enrichedOn,
      failed: inputs.enrichmentFailed,
      degraded: inputs.degraded,
    },
    budget: budgetSummary(client.records),
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
      recent: recent.length,
      recentAdded: recent.filter((g) => g.addedOn).length,
      recentRenamed: recent.filter((g) => g.renamedOn).length,
      withDetails: files.details.games,
      withoutDetails: games.length - files.details.games,
      detailShards: files.details.shards.size,
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
    stateMeta: { version, enrichedOn },
    enrichmentAgeDays,
    recent,
    coverage,
    frozenDiff: fdiff,
    summary,
  };
}
