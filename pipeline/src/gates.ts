// Etapa 5 · Puertas de publicación (§4.6): recuento, renombrados, centinelas, integridad,
// tamaño, consultas de humo y calidad de búsqueda (§8.10). Las de calidad y humo se ejecutan con
// `@gameagenda/core/search-quality` sobre el índice construido con `packages/core` a partir de los
// ficheros ya serializados, como lo hará la app. Si una falla, no se publica.

import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import {
  applyRecent,
  type CatalogManifest,
  type CoreCatalog,
  catalogManifestSchema,
  DETAIL_SHARDS,
  detailShardOf,
  detailShardPath,
  detailShardSchema,
  detailsIndexSchema,
  parseAliases,
  parseCore,
} from '@gameagenda/core/catalog-format';
import { buildSearcher, type FuzzyMatcher, loadFuzzy } from '@gameagenda/core/search';
import {
  evaluateExact,
  evaluateGolden,
  evaluateNegatives,
  evaluatePrefix,
  evaluateSmoke,
  type GoldenQuery,
} from '@gameagenda/core/search-quality';
import { type CatalogFiles, sha256 } from './catalog-files.ts';

export type GateId =
  | 'count'
  | 'renames'
  | 'sentinels'
  | 'integrity'
  | 'size'
  | 'smoke'
  | 'golden'
  | 'exact'
  | 'prefix'
  | 'negatives';

export interface GateOutcome {
  readonly id: GateId;
  readonly status: 'pass' | 'fail' | 'skip';
  readonly detail: string;
  readonly data?: unknown;
}

/** Centinelas de la §4.6: CS2, Dota 2, Elden Ring, Baldur's Gate 3 y Hollow Knight. */
export const SENTINELS: readonly number[] = [730, 570, 1245620, 1086940, 367520];

export interface GateConfig {
  /** Mínimo absoluto de juegos (190 000). */
  readonly minGames: number;
  /** Variación del recuento admitida respecto a la versión anterior (−2 % … +5 %). */
  readonly minDeltaPct: number;
  readonly maxDeltaPct: number;
  /** Renombrados admitidos respecto a la versión anterior (≤1 %). */
  readonly maxRenamedPct: number;
  readonly sentinels: readonly number[];
  /** Núcleo con brotli 11 (≤3 MiB, §7.6). */
  readonly maxCoreBrotliBytes: number;
  /** Por despliegue (§7.6, plan gratuito de Workers): ficheros de ≤25 MiB… */
  readonly maxFileBytes: number;
  /** …y ≤20 000 ficheros, con los de la versión anterior. */
  readonly maxDeployFiles: number;
  /** `full`: dorado, exactos, prefijos y negativas; `smoke`: solo humo (catálogos de prueba). */
  readonly quality: 'full' | 'smoke';
}

export const PUBLISH_GATES: GateConfig = {
  minGames: 190_000,
  minDeltaPct: -2,
  maxDeltaPct: 5,
  maxRenamedPct: 1,
  sentinels: SENTINELS,
  maxCoreBrotliBytes: 3 * 1024 * 1024,
  maxFileBytes: 25 * 1024 * 1024,
  maxDeployFiles: 20_000,
  quality: 'full',
};

/** La versión anterior, para las puertas que comparan (vacía en la primera versión). */
export interface PreviousVersion {
  readonly count: number;
  /** Nombre base por `appid`. */
  readonly names: ReadonlyMap<number, string>;
}

const pct = (k: number, n: number): number => (n === 0 ? 0 : +((100 * k) / n).toFixed(3));
const fmt = (n: number): string => n.toLocaleString('es-ES');

function deltaSkipped(prev: PreviousVersion | null, skipDelta: boolean): string | null {
  if (skipDelta) return 'saltada con --skip-delta-gates';
  if (!prev) return 'primera versión: sin versión anterior';
  return null;
}

export function countGate(
  count: number,
  prev: PreviousVersion | null,
  cfg: GateConfig,
  skipDelta: boolean,
): GateOutcome {
  if (count < cfg.minGames) {
    return { id: 'count', status: 'fail', detail: `${fmt(count)} juegos < ${fmt(cfg.minGames)}` };
  }
  const skipped = deltaSkipped(prev, skipDelta);
  if (skipped || !prev) {
    return {
      id: 'count',
      status: 'pass',
      detail: `${fmt(count)} juegos ≥ ${fmt(cfg.minGames)} (variación ${skipped})`,
      data: { count },
    };
  }
  const delta = pct(count - prev.count, prev.count);
  const ok = delta >= cfg.minDeltaPct && delta <= cfg.maxDeltaPct;
  return {
    id: 'count',
    status: ok ? 'pass' : 'fail',
    detail: `${fmt(count)} juegos (${delta >= 0 ? '+' : ''}${delta} % frente a ${fmt(prev.count)}; admitido ${cfg.minDeltaPct} % … +${cfg.maxDeltaPct} %)`,
    data: { count, previous: prev.count, deltaPct: delta },
  };
}

export function renamesGate(
  names: ReadonlyMap<number, string>,
  prev: PreviousVersion | null,
  cfg: GateConfig,
  skipDelta: boolean,
): GateOutcome {
  const skipped = deltaSkipped(prev, skipDelta);
  if (skipped || !prev) return { id: 'renames', status: 'skip', detail: skipped ?? '' };
  let common = 0;
  const renamed: Array<[number, string, string]> = [];
  for (const [appid, name] of names) {
    const before = prev.names.get(appid);
    if (before === undefined) continue;
    common++;
    if (before !== name) renamed.push([appid, before, name]);
  }
  const p = pct(renamed.length, common);
  return {
    id: 'renames',
    status: p <= cfg.maxRenamedPct ? 'pass' : 'fail',
    detail: `${fmt(renamed.length)} renombrados de ${fmt(common)} (${p} %; admitido ≤${cfg.maxRenamedPct} %)`,
    data: { renamed: renamed.length, common, pct: p, sample: renamed.slice(0, 20) },
  };
}

export function sentinelsGate(appids: ReadonlySet<number>, cfg: GateConfig): GateOutcome {
  const missing = cfg.sentinels.filter((a) => !appids.has(a));
  return {
    id: 'sentinels',
    status: missing.length === 0 ? 'pass' : 'fail',
    detail:
      missing.length === 0 ? `están los ${cfg.sentinels.length}` : `faltan ${missing.join(', ')}`,
    data: { missing },
  };
}

/** `true` si los dos núcleos tienen las mismas filas, en el mismo orden. */
function sameRows(a: CoreCatalog, b: CoreCatalog): boolean {
  if (a.count !== b.count) return false;
  for (let g = 0; g < a.count; g++) {
    if (
      a.appid[g] !== b.appid[g] ||
      a.name[g] !== b.name[g] ||
      a.nameEs.get(g) !== b.nameEs.get(g) ||
      a.flags[g] !== b.flags[g] ||
      a.year[g] !== b.year[g] ||
      a.pop[g] !== b.pop[g]
    ) {
      return false;
    }
  }
  return true;
}

/** Recientes: se leen, son del núcleo y aplicarlos al núcleo de hoy lo deja igual. */
function recentProblems(core: CoreCatalog, seen: ReadonlySet<number>, text: string): string[] {
  const out: string[] = [];
  const recent = parseCore(text, 'recent');
  if (recent.version !== core.version) out.push('versión de recent ≠ núcleo');
  const ids = new Set<number>();
  let orphan = 0;
  for (let r = 0; r < recent.count; r++) {
    const a = recent.appid[r] as number;
    if (ids.has(a)) out.push(`recent repite ${a}`);
    ids.add(a);
    if (!seen.has(a)) orphan++;
  }
  if (orphan > 0) out.push(`${orphan} filas de recent sin juego en el núcleo`);
  if (!sameRows(applyRecent(core, recent), core)) {
    out.push('aplicar recent al núcleo de hoy lo cambia');
  }
  return out;
}

/**
 * *Shards* (§7.6): índice con su esquema y la versión del núcleo; cada *shard* citado existe, el
 * *hash* de su nombre es el de su contenido, cumple su esquema Zod y solo tiene juegos del núcleo
 * que caen en él (FNV-1a mod 1024); no hay *shards* sin citar.
 */
function detailsProblems(
  core: CoreCatalog,
  seen: ReadonlySet<number>,
  files: CatalogFiles,
): string[] {
  const out: string[] = [];
  const index = detailsIndexSchema.safeParse(JSON.parse(files.details.indexText));
  if (!index.success) return ['el índice de shards no cumple su esquema'];
  if (index.data.version !== core.version) out.push('versión del índice de shards ≠ núcleo');
  let cited = 0;
  for (let n = 0; n < DETAIL_SHARDS; n++) {
    const h = index.data.shards[n];
    if (!h) continue;
    cited++;
    const path = detailShardPath(n, h);
    const text = files.files.get(path);
    if (text === undefined) {
      out.push(`falta ${path}`);
      continue;
    }
    if (!sha256(text).startsWith(h)) out.push(`hash de ${path}`);
    const shard = detailShardSchema.safeParse(JSON.parse(text));
    if (!shard.success) {
      out.push(`${path} no cumple su esquema`);
      continue;
    }
    const keys = Object.keys(shard.data);
    if (keys.length === 0) out.push(`${path} vacío (debería ser null)`);
    for (const k of keys) {
      const appid = Number(k);
      if (detailShardOf(appid) !== n) out.push(`${appid} no va en el shard ${n}`);
      if (!seen.has(appid)) out.push(`${appid} tiene detalles y no está en el núcleo`);
    }
  }
  const shardFiles = [...files.files.keys()].filter(
    (p) => p.startsWith('details/') && p !== files.details.indexPath,
  ).length;
  if (shardFiles !== cited) out.push(`${shardFiles} shards publicados y ${cited} en el índice`);
  return out;
}

/**
 * Integridad: todas las filas se leen con el lector de la app, sin `appid` repetidos ni nombres
 * vacíos; los alias apuntan a juegos del núcleo; los recientes y los *shards* son válidos; el
 * *manifest* cumple su esquema y sus `sha256`, tamaños, rutas y recuentos casan con los ficheros.
 */
export function integrityGate(files: CatalogFiles): GateOutcome {
  const problems: string[] = [];
  let manifest: CatalogManifest | null = null;
  try {
    manifest = catalogManifestSchema.parse(JSON.parse(files.manifestText));
  } catch (e) {
    problems.push(`manifest: ${(e as Error).message.slice(0, 200)}`);
  }
  try {
    const core = parseCore(files.coreText);
    const seen = new Set<number>();
    let dups = 0;
    let empty = 0;
    for (let g = 0; g < core.count; g++) {
      const a = core.appid[g] as number;
      if (seen.has(a)) dups++;
      seen.add(a);
      if (!(core.name[g] as string).trim()) empty++;
    }
    if (dups > 0) problems.push(`${dups} appid repetidos`);
    if (empty > 0) problems.push(`${empty} nombres vacíos`);
    const aliases = parseAliases(files.aliasesText);
    const orphan = aliases.pairs.filter(([, a]) => !seen.has(a)).length;
    if (orphan > 0) problems.push(`${orphan} alias sin juego`);
    if (aliases.version !== core.version) problems.push('versiones distintas en núcleo y alias');
    problems.push(...recentProblems(core, seen, files.recentText));
    problems.push(...detailsProblems(core, seen, files));
    if (manifest) {
      if (manifest.version !== core.version) problems.push('versión del manifest ≠ núcleo');
      if (manifest.counts.core !== core.count) problems.push('counts.core ≠ filas del núcleo');
      if (manifest.counts.aliases !== aliases.pairs.length) problems.push('counts.aliases ≠ alias');
      if (manifest.counts.recent !== files.recentText.split('\n').length - 2) {
        problems.push('counts.recent ≠ filas de recent');
      }
      if (!manifest.killSwitches) problems.push('faltan los kill switches');
      const expected = [
        ['core', files.coreText, (h: string) => `core.${h}.tsv`],
        ['recent', files.recentText, (h: string) => `recent.${h}.tsv`],
        ['aliases', files.aliasesText, (h: string) => `aliases.${h}.tsv`],
        ['details', files.details.indexText, (h: string) => `details/index.${h}.json`],
      ] as const;
      for (const [key, text, pathOf] of expected) {
        const f = manifest.files[key];
        if (!f) {
          problems.push(`falta files.${key}`);
          continue;
        }
        const h = sha256(text);
        if (f.sha256 !== h) problems.push(`sha256 de ${key}`);
        if (f.bytes !== Buffer.byteLength(text)) problems.push(`bytes de ${key}`);
        if (f.path !== pathOf(h.slice(0, 16))) problems.push(`ruta de ${key}`);
        if (files.files.get(f.path) !== text) problems.push(`fichero de ${key}`);
      }
    }
  } catch (e) {
    problems.push((e as Error).message);
  }
  return {
    id: 'integrity',
    status: problems.length === 0 ? 'pass' : 'fail',
    detail:
      problems.length === 0
        ? `todas las filas se leen; recent, ${files.details.shards.size} shards, manifest y hashes correctos`
        : problems.slice(0, 20).join('; '),
  };
}

/** Bytes con brotli 11, como lo mide la §7.6. */
export function brotli11(text: string): number {
  const buf = Buffer.from(text, 'utf8');
  return brotliCompressSync(buf, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_LGWIN]: 24,
      [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  }).length;
}

/** Un fichero de un despliegue de `ga-catalog`. */
export interface DeployFile {
  readonly path: string;
  readonly bytes: number;
}

/**
 * Límites de un despliegue del plan gratuito (§7.6): ≤`maxDeployFiles` ficheros de
 * ≤`maxFileBytes`. `files` es lo que se sube (esta versión, la anterior y `_headers`); `count`, si
 * se cuenta otra cosa.
 */
export function deployProblems(
  files: readonly DeployFile[],
  cfg: GateConfig,
  count = files.length,
): string[] {
  const out: string[] = [];
  if (count > cfg.maxDeployFiles) {
    out.push(`${fmt(count)} ficheros por despliegue > ${fmt(cfg.maxDeployFiles)}`);
  }
  const big = files.filter((f) => f.bytes > cfg.maxFileBytes);
  if (big.length > 0) {
    out.push(`${big.length} ficheros de más de ${mib(cfg.maxFileBytes)} (${big[0]?.path})`);
  }
  return out;
}

const mib = (n: number): string => `${(n / 1024 / 1024).toFixed(2)} MiB`;
const kb = (n: number): string => `${(n / 1000).toFixed(1)} KB`;

/** *Shards* en los que se mide brotli 11 (uno de cada 16): medirlos todos costaría ≈30 s. */
const SHARD_SAMPLE_EVERY = 16;

/**
 * Tamaño (§7.6): el núcleo con brotli 11 (puerta; el informe anota también gzip -6) y los límites
 * del despliegue, contando esta versión dos veces porque cada despliegue reincluye la anterior,
 * que tiene los mismos ficheros más o menos. Mide también `recent`, los *shards* y su índice.
 */
export function sizeGate(files: CatalogFiles, cfg: GateConfig): GateOutcome {
  const raw = Buffer.byteLength(files.coreText);
  const br11 = brotli11(files.coreText);
  const gzip6 = gzipSync(Buffer.from(files.coreText, 'utf8'), { level: 6 }).length;
  const deploy: DeployFile[] = [
    { path: 'manifest.json', bytes: Buffer.byteLength(files.manifestText) },
    ...[...files.files].map(([path, text]) => ({ path, bytes: Buffer.byteLength(text) })),
  ];
  // Esta versión, la anterior (con tantos ficheros como esta, más o menos) y `_headers`.
  const deployCount = deploy.length * 2 + 1;
  const problems = deployProblems(deploy, cfg, deployCount);
  if (br11 > cfg.maxCoreBrotliBytes) {
    problems.unshift(`núcleo con brotli 11 ${mib(br11)} > ${mib(cfg.maxCoreBrotliBytes)}`);
  }
  const shardTexts = [...files.details.shards.values()];
  const shardRaw = shardTexts.map((t) => Buffer.byteLength(t));
  const sample = shardTexts.filter((_, i) => i % SHARD_SAMPLE_EVERY === 0);
  const sampleRaw = sample.reduce((a, t) => a + Buffer.byteLength(t), 0);
  const sampleBr = sample.reduce((a, t) => a + brotli11(t), 0);
  const shardsRaw = shardRaw.reduce((a, b) => a + b, 0);
  const shards = {
    count: shardTexts.length,
    games: files.details.games,
    raw: shardsRaw,
    meanRaw: shardTexts.length ? Math.round(shardsRaw / shardTexts.length) : 0,
    maxRaw: Math.max(0, ...shardRaw),
    // Estimado con la proporción de la muestra.
    brotli11: sampleRaw ? Math.round((shardsRaw * sampleBr) / sampleRaw) : 0,
    sampled: sample.length,
  };
  const recent = {
    rows: files.recentText.split('\n').length - 2,
    raw: Buffer.byteLength(files.recentText),
    brotli11: brotli11(files.recentText),
  };
  const index = {
    raw: Buffer.byteLength(files.details.indexText),
    brotli11: brotli11(files.details.indexText),
  };
  return {
    id: 'size',
    status: problems.length === 0 ? 'pass' : 'fail',
    detail: `${problems.length > 0 ? `${problems.join('; ')} · ` : ''}núcleo ${mib(raw)} · brotli 11 ${mib(br11)} (≤${mib(cfg.maxCoreBrotliBytes)}) · gzip -6 ${mib(gzip6)} · recent ${recent.rows} filas, ${kb(recent.raw)} (${kb(recent.brotli11)} brotli 11) · ${shards.count} shards, ${mib(shards.raw)} (≈${mib(shards.brotli11)} brotli 11) · ${fmt(deployCount)} ficheros por despliegue (≤${fmt(cfg.maxDeployFiles)})`,
    data: { raw, brotli11: br11, gzip6, recent, shards, index, deployFiles: deployCount },
  };
}

/** Humo y calidad de búsqueda en el índice construido con `core` desde los ficheros. */
export function searchGates(
  files: CatalogFiles,
  fuzzy: FuzzyMatcher,
  golden: readonly GoldenQuery[],
  cfg: GateConfig,
): GateOutcome[] {
  const core = parseCore(files.coreText);
  const s = buildSearcher(core, parseAliases(files.aliasesText).pairs);
  const out: GateOutcome[] = [];
  const smoke = evaluateSmoke(s, fuzzy);
  out.push({
    id: 'smoke',
    status: smoke.ok ? 'pass' : 'fail',
    detail: smoke.checks
      .map((c) => `«${c.q}» → ${c.appid} ${c.ok ? '✓' : `✗ (${c.got.join(', ')})`}`)
      .join(' · '),
    data: smoke.checks,
  });
  if (cfg.quality === 'smoke') {
    for (const id of ['golden', 'exact', 'prefix', 'negatives'] as const) {
      out.push({ id, status: 'skip', detail: 'catálogo de prueba: solo consultas de humo' });
    }
    return out;
  }
  const g = evaluateGolden(s, fuzzy, golden);
  out.push({
    id: 'golden',
    status: g.ok ? 'pass' : 'fail',
    detail: `dorado (${g.n}): top-1 ${g.top1} % (≥90) · top-5 ${g.top5} % (≥95); sin nivel 4, ${g.top1NoFuzzy} % / ${g.top5NoFuzzy} %`,
    data: g,
  });
  const ex = evaluateExact(s, core.name, core.appid);
  out.push({
    id: 'exact',
    status: ex.ok ? 'pass' : 'fail',
    detail: `${ex.n} exactos: ${ex.pct} % en el top-5 (≥99)`,
    data: ex,
  });
  const pre = evaluatePrefix(s, core.name, core.appid);
  out.push({
    id: 'prefix',
    status: pre.ok ? 'pass' : 'fail',
    detail: `prefijos de 4 letras (${pre.n}): ${pre.pct} % en el top-10 (≥90); top-8, ${pre.top8} %`,
    data: pre,
  });
  const neg = evaluateNegatives(s, fuzzy);
  out.push({
    id: 'negatives',
    status: neg.ok ? 'pass' : 'fail',
    detail: neg.ok ? 'sin resultados de nivel 0–1' : `con nivel 0–1: ${neg.failed.join(', ')}`,
    data: neg.top3,
  });
  return out;
}

export interface GateInput {
  readonly files: CatalogFiles;
  readonly names: ReadonlyMap<number, string>;
  readonly previous: PreviousVersion | null;
  readonly skipDelta: boolean;
  readonly golden: readonly GoldenQuery[];
  readonly cfg: GateConfig;
  readonly fuzzy?: FuzzyMatcher;
}

/** Todas las puertas, en el orden de la §4.6. */
export async function runGates(input: GateInput): Promise<GateOutcome[]> {
  const { files, names, previous, skipDelta, cfg } = input;
  const out: GateOutcome[] = [
    countGate(names.size, previous, cfg, skipDelta),
    renamesGate(names, previous, cfg, skipDelta),
    sentinelsGate(new Set(names.keys()), cfg),
    integrityGate(files),
    sizeGate(files, cfg),
  ];
  if (out[3]?.status === 'fail') {
    for (const id of ['smoke', 'golden', 'exact', 'prefix', 'negatives'] as const) {
      out.push({ id, status: 'skip', detail: 'el núcleo no pasa la puerta de integridad' });
    }
    return out;
  }
  const fuzzy = input.fuzzy ?? (await loadFuzzy());
  out.push(...searchGates(files, fuzzy, input.golden, cfg));
  return out;
}

export function gatesPassed(gates: readonly GateOutcome[]): boolean {
  return gates.every((g) => g.status !== 'fail');
}
