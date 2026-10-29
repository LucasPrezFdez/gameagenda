// `npm run fixtures:freeze` (§13.3 y §8.10): copia a `fixtures/catalog-frozen/` el núcleo de
// `pipeline/out/`, comprimido con gzip -9, y sus alias, como `core.<versión>.tsv.gz` y
// `aliases.<versión>.tsv`; borra la copia anterior. Como mucho una vez por hito: las puertas de
// calidad del CI se miden sobre esta copia. Después hay que apuntar a la versión nueva las
// pruebas que la leen (`packages/core/test/helpers/frozen.ts` y `search.quality.test.ts`).

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { catalogManifestSchema, parseAliases, parseCore } from '@gameagenda/core/catalog-format';
import { sha256 } from './src/catalog-files.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'pipeline/out');
const FROZEN = join(ROOT, 'fixtures/catalog-frozen');

function main(): void {
  const manifestPath = join(OUT, 'manifest.json');
  if (!existsSync(manifestPath))
    throw new Error('No hay catálogo en pipeline/out/: ejecuta catalog:build');
  const manifest = catalogManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const core = readFileSync(join(OUT, manifest.files.core.path), 'utf8');
  const aliases = readFileSync(join(OUT, manifest.files.aliases.path), 'utf8');
  if (
    sha256(core) !== manifest.files.core.sha256 ||
    sha256(aliases) !== manifest.files.aliases.sha256
  ) {
    throw new Error('Los ficheros de pipeline/out/ no casan con su manifest');
  }
  // Que se lean enteros antes de congelarlos.
  const n = parseCore(core).count;
  parseAliases(aliases);
  for (const name of readdirSync(FROZEN)) {
    if (/^(core\..+\.tsv\.gz|aliases\..+\.tsv)$/.test(name)) rmSync(join(FROZEN, name));
  }
  const v = manifest.version;
  writeFileSync(join(FROZEN, `core.${v}.tsv.gz`), gzipSync(core, { level: 9 }));
  writeFileSync(join(FROZEN, `aliases.${v}.tsv`), aliases, 'utf8');
  console.log(`✓ fixtures/catalog-frozen/: núcleo ${v} (${n} juegos) y sus alias`);
  console.log(
    '  Actualiza la versión congelada en packages/core/test (helpers/frozen.ts y search.quality.test.ts).',
  );
}

main();
