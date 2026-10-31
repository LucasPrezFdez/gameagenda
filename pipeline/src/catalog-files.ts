// Ficheros publicados (§7.6): `core.<hash>.tsv`, `recent.<hash>.tsv`, `aliases.<hash>.tsv`, los
// *shards* `details/<nnnn>.<hash>.json` con su índice `details/index.<hash>.json` y `manifest.json`
// con `killSwitches`, `enrichmentAgeDays` y, si hay clave de firma, `sig`. Los serializadores y los
// esquemas son los de `core/catalog-format`: la app los lee tal cual.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type AliasPair,
  type CatalogManifest,
  type CoreRow,
  catalogManifestSchema,
  detailsIndexSchema,
  serializeAliases,
  serializeCore,
} from '@gameagenda/core/catalog-format';
import type { Game } from './derive.ts';
import { buildDetailFiles, type DetailFiles, sha256 } from './details.ts';
import { KILL_SWITCHES_OFF, type KillSwitches } from './kill-switches.ts';
import { type Signer, signManifest } from './signing.ts';

/** Versión mínima de la app que lee un *manifest* sin firma (M1 y desarrollo). */
export const MIN_CLIENT_VERSION = '0.0.0';
/** Desde v0.2.0 la app exige la firma (§7.6): un *manifest* firmado pide esa versión. */
export const MIN_CLIENT_VERSION_SIGNED = '0.2.0';

export interface CatalogFiles {
  /** El *manifest* leído con su esquema (para consultarlo). */
  readonly manifest: CatalogManifest;
  /** El *manifest* tal como se publica: es lo que se firma y se verifica. */
  readonly manifestJson: Readonly<Record<string, unknown>>;
  readonly manifestText: string;
  readonly coreText: string;
  readonly recentText: string;
  readonly aliasesText: string;
  readonly details: DetailFiles;
  /** Ruta publicada → contenido (sin el *manifest*), *shards* e índice incluidos. */
  readonly files: ReadonlyMap<string, string>;
}

export { sha256 };

/** Nombre con los 16 primeros dígitos hexadecimales del SHA-256 (§7.6). */
export function hashedName(prefix: string, text: string, ext = 'tsv'): string {
  return `${prefix}.${sha256(text).slice(0, 16)}.${ext}`;
}

export interface CatalogMeta {
  readonly version: string;
  readonly generatedAt: string;
  /** Días desde el último enriquecimiento (Query) correcto; 0 si hoy fue bien (§4.6). */
  readonly enrichmentAgeDays?: number;
  /** Por defecto, la de un *manifest* sin firma; `buildCatalog` pone la de uno firmado. */
  readonly minClientVersion?: string;
  readonly killSwitches?: KillSwitches;
}

const coreRow = (g: Game): CoreRow => ({
  appid: g.appid,
  name: g.name,
  nameEs: g.nameEs,
  flags: g.flags,
  year: g.year,
  pop: g.pop,
});

const fileEntry = (path: string, text: string) => ({
  path,
  sha256: sha256(text),
  bytes: Buffer.byteLength(text),
});

/** Texto del *manifest*: JSON con sangría de 2 y salto de línea final. */
function manifestTextOf(json: Readonly<Record<string, unknown>>): string {
  return `${JSON.stringify(json, null, 2)}\n`;
}

/**
 * Todos los ficheros de una versión. `games` va en el orden del núcleo; `recent`, los juegos de
 * los recientes (en ese mismo orden). El *manifest* sale sin firma: `withSignature` la añade.
 */
export function buildCatalogFiles(
  games: readonly Game[],
  pairs: readonly AliasPair[],
  meta: CatalogMeta,
  recent: readonly Game[] = [],
): CatalogFiles {
  const coreText = serializeCore(games.map(coreRow), { version: meta.version });
  const recentText = serializeCore(recent.map(coreRow), { version: meta.version, kind: 'recent' });
  const aliasesText = serializeAliases(pairs, { version: meta.version });
  const details = buildDetailFiles(games, meta.version);
  const corePath = hashedName('core', coreText);
  const recentPath = hashedName('recent', recentText);
  const aliasesPath = hashedName('aliases', aliasesText);
  const manifestJson = {
    format: 'gacat',
    v: 1,
    version: meta.version,
    generatedAt: meta.generatedAt,
    counts: {
      core: games.length,
      aliases: aliasesText.split('\n').length - 2,
      recent: recent.length,
    },
    files: {
      core: fileEntry(corePath, coreText),
      recent: fileEntry(recentPath, recentText),
      aliases: fileEntry(aliasesPath, aliasesText),
      details: fileEntry(details.indexPath, details.indexText),
    },
    enrichmentAgeDays: meta.enrichmentAgeDays ?? 0,
    minClientVersion: meta.minClientVersion ?? MIN_CLIENT_VERSION,
    killSwitches: { ...(meta.killSwitches ?? KILL_SWITCHES_OFF) },
  };
  const files = new Map<string, string>([
    [corePath, coreText],
    [recentPath, recentText],
    [aliasesPath, aliasesText],
    [details.indexPath, details.indexText],
    ...details.shards,
  ]);
  return {
    manifest: catalogManifestSchema.parse(manifestJson),
    manifestJson,
    manifestText: manifestTextOf(manifestJson),
    coreText,
    recentText,
    aliasesText,
    details,
    files,
  };
}

/** Los mismos ficheros con el *manifest* firmado (§7.6: `sig` del JSON canónico sin `sig`). */
export function withSignature(built: CatalogFiles, signer: Signer): CatalogFiles {
  const manifestJson = signManifest({ ...built.manifestJson }, signer);
  return {
    ...built,
    manifest: catalogManifestSchema.parse(manifestJson),
    manifestJson,
    manifestText: manifestTextOf(manifestJson),
  };
}

const RE_GENERATED = /^(core|aliases|recent|boot)\.[0-9a-f]{16}\.tsv$/;
const RE_DETAILS = /^(?:\d{4}|index)\.[0-9a-f]{16}\.json$/;

/** Ficheros de la versión publicada en `dir` (su *manifest* y los *shards* de su índice). */
export function catalogPaths(dir: string): Set<string> {
  const out = new Set<string>();
  const m = join(dir, 'manifest.json');
  if (!existsSync(m)) return out;
  let manifest: CatalogManifest;
  try {
    manifest = catalogManifestSchema.parse(JSON.parse(readFileSync(m, 'utf8')));
  } catch {
    return out;
  }
  for (const f of Object.values(manifest.files)) if (f) out.add(f.path);
  const index = manifest.files.details;
  if (index && existsSync(join(dir, index.path))) {
    const parsed = detailsIndexSchema.safeParse(
      JSON.parse(readFileSync(join(dir, index.path), 'utf8')),
    );
    if (parsed.success) {
      parsed.data.shards.forEach((h, n) => {
        if (h) out.add(`details/${String(n).padStart(4, '0')}.${h}.json`);
      });
    }
  }
  return out;
}

/**
 * Escribe el catálogo en `dir` (el *manifest*, el último). Con `keepPrevious`, conserva los
 * ficheros de la versión que había (cada despliegue los reincluye, §4.6: un cliente con el
 * *manifest* anterior sigue funcionando, CA2.4) y borra los de generaciones más viejas.
 */
export function writeCatalog(
  dir: string,
  built: CatalogFiles,
  options: { keepPrevious?: boolean } = {},
): void {
  mkdirSync(dir, { recursive: true });
  const keep = options.keepPrevious ? catalogPaths(dir) : new Set<string>();
  for (const name of readdirSync(dir)) {
    if (name === 'manifest.json' || (RE_GENERATED.test(name) && !keep.has(name))) {
      rmSync(join(dir, name));
    }
  }
  const detailsDir = join(dir, 'details');
  if (existsSync(detailsDir)) {
    for (const name of readdirSync(detailsDir)) {
      if (RE_DETAILS.test(name) && !keep.has(`details/${name}`)) rmSync(join(detailsDir, name));
    }
  }
  for (const [name, text] of built.files) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  writeFileSync(join(dir, 'manifest.json'), built.manifestText, 'utf8');
}
