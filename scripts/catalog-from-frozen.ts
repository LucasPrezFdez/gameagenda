// Catálogo publicable a partir de la copia congelada (`fixtures/catalog-frozen/`, ver §8.10):
// `manifest.json` + `core.<hash>.tsv` + `aliases.<hash>.tsv` (§7.6), en dos sitios:
// - `pipeline/out/`: el catálogo completo (196 665 juegos), para medir la app con
//   `CATALOG_DIR=pipeline/out` (no se versiona);
// - `fixtures/catalog/`: el mini-catálogo de ≈300 juegos con los casos difíciles de la §13.5, que
//   sirven `npm run dev`, `npm run preview` y los E2E (se versiona).
//
// PROVISIONAL: cuando exista el pipeline de la §4.8, el mini-catálogo lo generará
// `npm run catalog:build -- --source=fixtures` a partir de `fixtures/steam/` (con los nombres
// vacíos y la lista negra exacta, que aquí no se pueden reproducir) y este *script* desaparecerá.
//
// Uso: npm run catalog:frozen  (determinista: regenerarlo da los mismos bytes).
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {
  type AliasPair,
  CatalogFlag,
  type CatalogManifest,
  type CoreRow,
  catalogManifestSchema,
  coreRowAt,
  parseAliases,
  parseCore,
  serializeAliases,
  serializeCore,
} from '@gameagenda/core/catalog-format';

const root = fileURLToPath(new URL('..', import.meta.url));
const FROZEN = `${root}fixtures/catalog-frozen/`;
const FROZEN_VERSION = '20261028.1';

/** Filas más populares del núcleo que entran en el mini-catálogo, en su orden. */
const TOP_ROWS = 240;

/**
 * Casos difíciles de la §13.5 que no están entre los más populares, por `appid` (los 5
 * centinelas —730, 570, 1245620, 1086940 y 367520— y casi todo el cliente falso ya lo están).
 */
const HARD_CASES: Readonly<Record<string, readonly number[]>> = {
  // Juegos del antiguo cliente falso y de la §12.3 (`baldurs`) que quedan fuera de los primeros.
  sample: [949230, 753640, 1030840, 228280, 257350],
  // Números romanos y arábigos: «final fantasy 7», «gta 4», «persona v», «mega man 10»…
  roman: [1462040, 2909400, 39150, 3837340, 1687950, 743890, 1889930, 12210, 1546970, 307780],
  // Nombre en español distinto del base.
  spanishName: [976310, 1295660, 360430, 1888930, 2215430, 972660, 920210, 1659420, 1490890],
  // Artículo inicial: «los sims 3» encuentra «The Sims™ 3».
  article: [47890, 3314060, 3314070],
  // CJK, kana y hangul.
  cjk: [1468810, 3167020, 1180320, 994280, 1859910, 3101040, 1457620, 4375230, 4711080, 4035300],
  // ™ y ®.
  marks: [1382330, 394510],
  // +18 (uno empieza por «celeste»: oculto por defecto).
  adult: [644560, 339800, 1002300, 3429040],
  // Próximamente y fecha por confirmar.
  comingSoon: [4354570, 3779560, 4018990, 4277200, 5507790],
  // Gratis (con apóstrofo) y acceso anticipado.
  freeAndEarly: [755800, 1609230],
  // Vecinos de las consultas del guion de la §12.3 y de la paleta.
  neighbours: [1170880, 1875580, 2123640, 715020, 2270750],
};

/**
 * Filas que no están en la copia congelada. La copia no trae ningún retirado (la clasificación
 * de la §4 llega con el pipeline), así que se añaden cuatro juegos que Steam sí ha retirado de la
 * tienda; su `pop` es aproximado. GTA V Legacy venía en el cliente falso.
 */
const EXTRA_ROWS: readonly CoreRow[] = [
  { appid: 271590, name: 'Grand Theft Auto V Legacy', year: 2015, pop: 39 },
  { appid: 1293830, name: 'Forza Horizon 4', flags: CatalogFlag.retired, year: 2021, pop: 34 },
  { appid: 50300, name: 'Spec Ops: The Line', flags: CatalogFlag.retired, year: 2012, pop: 31 },
  { appid: 241560, name: 'The Crew', flags: CatalogFlag.retired, year: 2014, pop: 30 },
  { appid: 224060, name: 'Deadpool', flags: CatalogFlag.retired, year: 2013, pop: 25 },
];

const GENERATED_AT = '2026-10-28T00:00:00Z';
const MIN_CLIENT_VERSION = '0.0.0';

function isRetired(row: CoreRow): boolean {
  return ((row.flags ?? 0) & CatalogFlag.retired) !== 0;
}

/** Rango estático (§7.6): vivos por `pop` descendente y, a igualdad, `appid` descendente. */
function ranksBefore(a: CoreRow, b: CoreRow): boolean {
  const pa = a.pop ?? 0;
  const pb = b.pop ?? 0;
  return pa > pb || (pa === pb && a.appid > b.appid);
}

/**
 * Inserta las altas como `recent` (§7.6): delante de la primera fila con menor `pop`, o con
 * igual `pop` y menor `appid`; los retirados van al final, con el mismo criterio.
 */
function insertRows(rows: readonly CoreRow[], extra: readonly CoreRow[]): CoreRow[] {
  const live = rows.filter((r) => !isRetired(r));
  const retired = rows.filter(isRetired);
  for (const row of extra) {
    const list = isRetired(row) ? retired : live;
    const at = list.findIndex((other) => ranksBefore(row, other));
    list.splice(at < 0 ? list.length : at, 0, row);
  }
  return [...live, ...retired];
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

interface Built {
  readonly manifest: CatalogManifest;
  readonly files: ReadonlyMap<string, string>;
}

function buildCatalog(rows: readonly CoreRow[], pairs: readonly AliasPair[]): Built {
  const core = serializeCore(rows, { version: FROZEN_VERSION });
  const aliases = serializeAliases(pairs, { version: FROZEN_VERSION });
  const coreHash = sha256(core);
  const aliasHash = sha256(aliases);
  const corePath = `core.${coreHash.slice(0, 16)}.tsv`;
  const aliasPath = `aliases.${aliasHash.slice(0, 16)}.tsv`;
  const aliasCount = aliases.split('\n').length - 2;
  const manifest = catalogManifestSchema.parse({
    format: 'gacat',
    v: 1,
    version: FROZEN_VERSION,
    generatedAt: GENERATED_AT,
    counts: { core: rows.length, aliases: aliasCount },
    files: {
      core: { path: corePath, sha256: coreHash, bytes: Buffer.byteLength(core, 'utf8') },
      aliases: { path: aliasPath, sha256: aliasHash, bytes: Buffer.byteLength(aliases, 'utf8') },
    },
    enrichmentAgeDays: 0,
    minClientVersion: MIN_CLIENT_VERSION,
  });
  return {
    manifest,
    files: new Map([
      [corePath, core],
      [aliasPath, aliases],
    ]),
  };
}

/** Escribe el catálogo en `dir` y borra los ficheros de una generación anterior. */
function writeCatalog(dir: string, built: Built): void {
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    if (name === 'manifest.json' || /^(core|aliases|recent|boot)\.[0-9a-f]{16}\.tsv$/.test(name)) {
      rmSync(`${dir}${name}`);
    }
  }
  for (const [name, text] of built.files) writeFileSync(`${dir}${name}`, text, 'utf8');
  writeFileSync(`${dir}manifest.json`, `${JSON.stringify(built.manifest, null, 2)}\n`, 'utf8');
  const { core, aliases } = built.manifest.counts;
  console.log(`✓ ${dir}: ${core} juegos y ${aliases} alias (${built.manifest.files.core.path})`);
}

function main(): void {
  const coreText = gunzipSync(readFileSync(`${FROZEN}core.${FROZEN_VERSION}.tsv.gz`)).toString(
    'utf8',
  );
  const catalog = parseCore(coreText);
  const aliasList = parseAliases(readFileSync(`${FROZEN}aliases.${FROZEN_VERSION}.tsv`, 'utf8'));
  if (catalog.version !== FROZEN_VERSION || aliasList.version !== FROZEN_VERSION) {
    throw new Error(`La copia congelada no es la versión ${FROZEN_VERSION}`);
  }
  const allRows = Array.from({ length: catalog.count }, (_, g) => coreRowAt(catalog, g));

  writeCatalog(`${root}pipeline/out/`, buildCatalog(allRows, aliasList.pairs));

  const wanted = new Set(Object.values(HARD_CASES).flat());
  const known = new Set(allRows.map((r) => r.appid));
  const missing = [...wanted].filter((appid) => !known.has(appid));
  if (missing.length > 0) throw new Error(`Faltan en la copia congelada: ${missing.join(', ')}`);
  const picked = allRows.filter((row, g) => g < TOP_ROWS || wanted.has(row.appid));
  const mini = insertRows(picked, EXTRA_ROWS);
  const inMini = new Set(mini.map((r) => r.appid));
  const miniPairs = aliasList.pairs.filter(([, appid]) => inMini.has(appid));
  writeCatalog(`${root}fixtures/catalog/`, buildCatalog(mini, miniPairs));
}

main();
