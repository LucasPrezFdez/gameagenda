// Catálogo publicable a partir de la copia congelada (`fixtures/catalog-frozen/`, ver §8.10):
// `manifest.json` firmado + `core`, `recent` y `aliases` en TSV + *shards* de detalles (§7.6), en
// dos sitios:
// - `pipeline/out/`: el catálogo completo (196 665 juegos), para medir la app con
//   `CATALOG_DIR=pipeline/out` (no se versiona);
// - `fixtures/catalog/`: el mini-catálogo de ≈300 juegos con los casos difíciles de la §13.5, que
//   sirven `npm run dev`, `npm run preview` y los E2E (se versiona).
//
// Desde M2 (§7.6):
// - El *manifest* va firmado con la clave **de desarrollo** (`dev-1`,
//   `fixtures/signing/dev-catalog-key.pem`): lo aceptan los modos `development` y `e2e`, nunca un
//   *build* de producción.
// - `recent` son las filas con el `appid` más alto (las altas más nuevas), como si el pipeline
//   las hubiera visto en los últimos 14 días: ≈4 000 en el completo (§4.3) y 8 en el mini. Son
//   las mismas filas del núcleo, como el `recent` del mismo día que el núcleo, así que aplicarlas
//   no cambia el catálogo (el recuento sigue siendo `counts.core`).
// - Los detalles son **sintéticos**: la copia congelada no trae nada de `appdetails`. Cada juego
//   lleva un `asset_url_format` falso (`steam/apps/<appid>/${FILENAME}`, sin `?t=`), las portadas
//   `library_600x900.jpg` y `header.jpg`, el lanzamiento a 1 de enero de `year` (precisión
//   `year`), unas reseñas que dan su `pop`, un porcentaje que sale del `appid`, `plat` 1
//   (Windows) y `deck` 0 (desconocido). No sirven para comprobar datos reales: solo el formato,
//   la descarga y la interfaz.
//
// PROVISIONAL: cuando exista el pipeline de la §4.8, el mini-catálogo lo generará
// `npm run catalog:build -- --source=fixtures` a partir de `fixtures/steam/` (con los nombres
// vacíos y la lista negra exacta, que aquí no se pueden reproducir) y este *script* desaparecerá.
//
// Uso: npm run catalog:frozen  (determinista: regenerarlo da los mismos bytes; la firma ed25519
// también lo es, RFC 8032).
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {
  type AliasPair,
  CATALOG_SIGNING_KEYS,
  CatalogFlag,
  type CatalogManifest,
  type CoreRow,
  catalogManifestSchema,
  coreRowAt,
  DETAIL_SHARDS,
  type DetailShard,
  type DetailsIndex,
  detailShardOf,
  detailShardPath,
  detailShardSchema,
  detailsIndexSchema,
  fromBase64Url,
  type GameDetails,
  manifestSigningBytes,
  parseAliases,
  parseCore,
  serializeAliases,
  serializeCore,
  toBase64Url,
} from '@gameagenda/core/catalog-format';

const root = fileURLToPath(new URL('..', import.meta.url));
const FROZEN = `${root}fixtures/catalog-frozen/`;
const FROZEN_VERSION = '20261028.1';
const SIGNING_KEY = `${root}fixtures/signing/dev-catalog-key.pem`;
const SIGNING_KID = 'dev-1';

/** Filas más populares del núcleo que entran en el mini-catálogo, en su orden. */
const TOP_ROWS = 240;

/** Filas de `recent`: ≈4 000 en el catálogo completo (§7.6) y unas pocas en el mini. */
const RECENT_ROWS = { full: 4000, mini: 8 } as const;

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

/** Las `count` filas de `appid` más alto, en el orden del núcleo: las altas más nuevas. */
function newestRows(rows: readonly CoreRow[], count: number): CoreRow[] {
  const newest = new Set(
    rows
      .map((r) => r.appid)
      .sort((a, b) => b - a)
      .slice(0, count),
  );
  return rows.filter((r) => newest.has(r.appid));
}

// --- Detalles sintéticos -----------------------------------------------------

/** `review_score` de Steam (0 = sin puntuación, con menos de 10 reseñas; 1–9). */
function reviewScore(pct: number, reviews: number): number {
  if (reviews < 10) return 0;
  if (pct >= 80) return pct >= 95 && reviews >= 500 ? 9 : reviews >= 50 ? 8 : 7;
  if (pct >= 70) return 6;
  if (pct >= 40) return 5;
  if (pct >= 20) return 4;
  return reviews >= 500 ? 1 : reviews >= 50 ? 2 : 3;
}

/** Detalles sintéticos de una fila (ver la cabecera): deterministas y válidos para el esquema. */
function syntheticDetails(row: CoreRow): GameDetails {
  const flags = row.flags ?? 0;
  const year = row.year ?? 0;
  const pop = row.pop ?? 0;
  // Lo mínimo que da ese `pop` = floor(2·log2(reseñas + 1)).
  const reviews = pop === 0 ? 0 : Math.ceil(2 ** (pop / 2)) - 1;
  const pct = 50 + ((row.appid * 7) % 51);
  const release: GameDetails[3] =
    (flags & CatalogFlag.tba) !== 0 || year === 0
      ? [null, (flags & CatalogFlag.soon) !== 0 && (flags & CatalogFlag.tba) === 0 ? 'soon' : 'tba']
      : [Date.UTC(year, 0, 1) / 1000, 'year'];
  return [
    `steam/apps/${row.appid}/\${FILENAME}`,
    'library_600x900.jpg',
    'header.jpg',
    release,
    [reviewScore(pct, reviews), reviews, reviews === 0 ? 0 : pct],
    1,
    0,
  ];
}

/** Los *shards* (`details/<nnnn>.<hash>.json`) y su índice (`details/index.<hash>.json`). */
function buildDetails(rows: readonly CoreRow[]): {
  index: { path: string; text: string };
  shards: Map<string, string>;
} {
  const byShard: DetailShard[] = Array.from({ length: DETAIL_SHARDS }, () => ({}));
  for (const row of rows) {
    (byShard[detailShardOf(row.appid)] as DetailShard)[String(row.appid)] = syntheticDetails(row);
  }
  const shards = new Map<string, string>();
  const hashes = byShard.map((shard, n) => {
    if (Object.keys(shard).length === 0) return null;
    // Las claves son índices de *array*: `JSON.stringify` las escribe en orden numérico.
    const text = JSON.stringify(detailShardSchema.parse(shard));
    const hash = sha256(text).slice(0, 16);
    shards.set(detailShardPath(n, hash), text);
    return hash;
  });
  const index: DetailsIndex = detailsIndexSchema.parse({
    format: 'gacat-details-index',
    v: 1,
    version: FROZEN_VERSION,
    shards: hashes,
  });
  const text = JSON.stringify(index);
  return { index: { path: `details/index.${sha256(text).slice(0, 16)}.json`, text }, shards };
}

// --- Firma ---------------------------------------------------------------------

const privateKey = createPrivateKey(readFileSync(SIGNING_KEY, 'utf8'));

/** Firma ed25519 del JSON canónico sin `sig`; comprueba que la verifica la pública de `core`. */
function signManifest(unsigned: Readonly<Record<string, unknown>>): CatalogManifest['sig'] {
  const bytes = manifestSigningBytes(unsigned);
  const signature = sign(null, bytes, privateKey);
  const known = CATALOG_SIGNING_KEYS.find((key) => key.kid === SIGNING_KID);
  const raw = known && fromBase64Url(known.ed25519);
  if (!raw) throw new Error(`Falta la pública de «${SIGNING_KID}» en CATALOG_SIGNING_KEYS`);
  const publicKey = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: toBase64Url(raw) },
    format: 'jwk',
  });
  if (!verify(null, bytes, publicKey, signature)) {
    throw new Error(`${SIGNING_KEY} no es la privada de «${SIGNING_KID}»`);
  }
  return { kid: SIGNING_KID, ed25519: toBase64Url(new Uint8Array(signature)) };
}

// --- Catálogo ------------------------------------------------------------------

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function fileSpec(path: string, text: string) {
  return { path, sha256: sha256(text), bytes: Buffer.byteLength(text, 'utf8') };
}

interface Built {
  /** El *manifest* tal como se publica (firmado). */
  readonly manifest: CatalogManifest;
  readonly files: ReadonlyMap<string, string>;
}

function buildCatalog(
  rows: readonly CoreRow[],
  pairs: readonly AliasPair[],
  recentCount: number,
): Built {
  const recentRows = newestRows(rows, recentCount);
  const core = serializeCore(rows, { version: FROZEN_VERSION });
  const recent = serializeCore(recentRows, { version: FROZEN_VERSION, kind: 'recent' });
  const aliases = serializeAliases(pairs, { version: FROZEN_VERSION });
  const details = buildDetails(rows);
  const corePath = `core.${sha256(core).slice(0, 16)}.tsv`;
  const recentPath = `recent.${sha256(recent).slice(0, 16)}.tsv`;
  const aliasPath = `aliases.${sha256(aliases).slice(0, 16)}.tsv`;
  const aliasCount = aliases.split('\n').length - 2;
  // El orden de las claves es el que se escribe; la firma no depende de él (JSON canónico).
  const unsigned = {
    format: 'gacat',
    v: 1,
    version: FROZEN_VERSION,
    generatedAt: GENERATED_AT,
    counts: { core: rows.length, aliases: aliasCount, recent: recentRows.length },
    files: {
      core: fileSpec(corePath, core),
      recent: fileSpec(recentPath, recent),
      aliases: fileSpec(aliasPath, aliases),
      details: fileSpec(details.index.path, details.index.text),
    },
    enrichmentAgeDays: 0,
    minClientVersion: MIN_CLIENT_VERSION,
    killSwitches: { covers: false, details: false },
  };
  const signed = { ...unsigned, sig: signManifest(unsigned) };
  catalogManifestSchema.parse(signed);
  return {
    manifest: signed as CatalogManifest,
    files: new Map([
      [corePath, core],
      [recentPath, recent],
      [aliasPath, aliases],
      [details.index.path, details.index.text],
      ...details.shards,
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
  rmSync(`${dir}details`, { recursive: true, force: true });
  mkdirSync(`${dir}details`);
  for (const [name, text] of built.files) writeFileSync(`${dir}${name}`, text, 'utf8');
  writeFileSync(`${dir}manifest.json`, `${JSON.stringify(built.manifest, null, 2)}\n`, 'utf8');
  const { core, aliases, recent } = built.manifest.counts;
  const shards = [...built.files.keys()].filter((name) => /^details\/\d{4}\./.test(name)).length;
  console.log(
    `✓ ${dir}: ${core} juegos, ${recent} recientes, ${aliases} alias y ${shards} shards (${built.manifest.files.core.path})`,
  );
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

  writeCatalog(`${root}pipeline/out/`, buildCatalog(allRows, aliasList.pairs, RECENT_ROWS.full));

  const wanted = new Set(Object.values(HARD_CASES).flat());
  const known = new Set(allRows.map((r) => r.appid));
  const missing = [...wanted].filter((appid) => !known.has(appid));
  if (missing.length > 0) throw new Error(`Faltan en la copia congelada: ${missing.join(', ')}`);
  const picked = allRows.filter((row, g) => g < TOP_ROWS || wanted.has(row.appid));
  const mini = insertRows(picked, EXTRA_ROWS);
  const inMini = new Set(mini.map((r) => r.appid));
  const miniPairs = aliasList.pairs.filter(([, appid]) => inMini.has(appid));
  writeCatalog(`${root}fixtures/catalog/`, buildCatalog(mini, miniPairs, RECENT_ROWS.mini));
}

main();
