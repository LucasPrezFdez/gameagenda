// Ficheros publicados de M1 (§7.6): `core.<hash>.tsv`, `aliases.<hash>.tsv` y `manifest.json`
// sin `sig`, `killSwitches`, `recent` ni `details`, con los serializadores de
// `core/catalog-format` (el Worker de la app los lee tal cual).

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AliasPair,
  type CatalogManifest,
  catalogManifestSchema,
  serializeAliases,
  serializeCore,
} from '@gameagenda/core/catalog-format';
import type { Game } from './derive.ts';

/** Versión mínima de la app que lee este formato. */
export const MIN_CLIENT_VERSION = '0.0.0';

export interface CatalogFiles {
  readonly manifest: CatalogManifest;
  readonly manifestText: string;
  readonly coreText: string;
  readonly aliasesText: string;
  /** Ruta publicada → contenido (sin el *manifest*). */
  readonly files: ReadonlyMap<string, string>;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Nombre con los 16 primeros dígitos hexadecimales del SHA-256 (§7.6). */
export function hashedName(prefix: string, text: string): string {
  return `${prefix}.${sha256(text).slice(0, 16)}.tsv`;
}

export function buildCatalogFiles(
  games: readonly Game[],
  pairs: readonly AliasPair[],
  meta: { version: string; generatedAt: string; enrichmentAgeDays?: number },
): CatalogFiles {
  const coreText = serializeCore(
    games.map((g) => ({
      appid: g.appid,
      name: g.name,
      nameEs: g.nameEs,
      flags: g.flags,
      year: g.year,
      pop: g.pop,
    })),
    { version: meta.version },
  );
  const aliasesText = serializeAliases(pairs, { version: meta.version });
  const corePath = hashedName('core', coreText);
  const aliasesPath = hashedName('aliases', aliasesText);
  const manifest = catalogManifestSchema.parse({
    format: 'gacat',
    v: 1,
    version: meta.version,
    generatedAt: meta.generatedAt,
    counts: { core: games.length, aliases: aliasesText.split('\n').length - 2 },
    files: {
      core: { path: corePath, sha256: sha256(coreText), bytes: Buffer.byteLength(coreText) },
      aliases: {
        path: aliasesPath,
        sha256: sha256(aliasesText),
        bytes: Buffer.byteLength(aliasesText),
      },
    },
    enrichmentAgeDays: meta.enrichmentAgeDays ?? 0,
    minClientVersion: MIN_CLIENT_VERSION,
  });
  return {
    manifest,
    manifestText: `${JSON.stringify(manifest, null, 2)}\n`,
    coreText,
    aliasesText,
    files: new Map([
      [corePath, coreText],
      [aliasesPath, aliasesText],
    ]),
  };
}

const RE_GENERATED = /^(core|aliases|recent|boot)\.[0-9a-f]{16}\.tsv$/;

/** Escribe el catálogo en `dir` (el *manifest*, el último) y borra los de una generación anterior. */
export function writeCatalog(dir: string, built: CatalogFiles): void {
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    if (name === 'manifest.json' || RE_GENERATED.test(name)) rmSync(join(dir, name));
  }
  for (const [name, text] of built.files) writeFileSync(join(dir, name), text, 'utf8');
  writeFileSync(join(dir, 'manifest.json'), built.manifestText, 'utf8');
}
