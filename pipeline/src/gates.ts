// Etapa 5 · Puertas de publicación (§4.6): recuento, renombrados, centinelas, integridad,
// tamaño, consultas de humo y calidad de búsqueda (§8.10). Las de calidad y humo se ejecutan con
// `@gameagenda/core/search-quality` sobre el índice construido con `packages/core` a partir de los
// ficheros ya serializados, como lo hará la app. Si una falla, no se publica.

import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import {
  type CatalogManifest,
  catalogManifestSchema,
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

/**
 * Integridad: todas las filas se leen con el lector de la app, sin `appid` repetidos ni nombres
 * vacíos; los alias apuntan a juegos del núcleo; el *manifest* cumple su esquema y sus `sha256`,
 * tamaños, rutas y recuentos casan con los ficheros. (Los *shards* llegan en M2.)
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
    if (manifest) {
      if (manifest.version !== core.version) problems.push('versión del manifest ≠ núcleo');
      if (manifest.counts.core !== core.count) problems.push('counts.core ≠ filas del núcleo');
      if (manifest.counts.aliases !== aliases.pairs.length) problems.push('counts.aliases ≠ alias');
      for (const [key, text] of [
        ['core', files.coreText],
        ['aliases', files.aliasesText],
      ] as const) {
        const f = manifest.files[key];
        const h = sha256(text);
        if (f.sha256 !== h) problems.push(`sha256 de ${key}`);
        if (f.bytes !== Buffer.byteLength(text)) problems.push(`bytes de ${key}`);
        if (f.path !== `${key}.${h.slice(0, 16)}.tsv`) problems.push(`ruta de ${key}`);
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
        ? 'todas las filas se leen; manifest y hashes correctos'
        : problems.join('; '),
  };
}

/** Tamaño del núcleo con brotli 11 (puerta) y con gzip -6 (lo anota el informe, §7.6). */
export function sizeGate(coreText: string, cfg: GateConfig): GateOutcome {
  const buf = Buffer.from(coreText, 'utf8');
  const br11 = brotliCompressSync(buf, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_LGWIN]: 24,
      [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  }).length;
  const gzip6 = gzipSync(buf, { level: 6 }).length;
  const mib = (n: number): string => `${(n / 1024 / 1024).toFixed(2)} MiB`;
  return {
    id: 'size',
    status: br11 <= cfg.maxCoreBrotliBytes ? 'pass' : 'fail',
    detail: `núcleo ${mib(buf.length)} · brotli 11 ${mib(br11)} (≤${mib(cfg.maxCoreBrotliBytes)}) · gzip -6 ${mib(gzip6)}`,
    data: { raw: buf.length, brotli11: br11, gzip6 },
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
    sizeGate(files.coreText, cfg),
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
