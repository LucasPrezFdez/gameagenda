// Prepara los ficheros D-08 (núcleo, núcleo de arranque, alias) y comprueba alias curados y consultas de humo.
// Uso: node prep.mjs <catalog_es.tsv> <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, brotliCompressSync, constants as Z } from 'node:zlib';
import { loadDerived, buildAliases, coreTsv, aliasesTsv, CURATED } from './catalog.mjs';
import { buildIndex, createSearcher, fromObjects } from './search-core.mjs';

const [tsv, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const games = loadDerived(tsv);
const A = buildAliases(games);
console.log('games', games.length, 'aliases', A.aliases.length, 'generated', A.generated, 'curated', A.curated, 'dropped', A.dropped, 'missing', JSON.stringify(A.missing));
const byAppid = new Map(games.map((g) => [g.appid, g]));
for (const [a, ap] of CURATED) console.log('  cur', a, ap, '→', byAppid.get(ap)?.name ?? '(NO ESTÁ)');
const files = { 'core.tsv': coreTsv(games), 'core-boot20k.tsv': coreTsv(games, '20261028.1', 20000), 'aliases.tsv': aliasesTsv(A.aliases) };
const sizes = [];
for (const [f, txt] of Object.entries(files)) {
  const buf = Buffer.from(txt, 'utf8');
  fs.writeFileSync(path.join(outDir, f), buf);
  const records = txt.split('\n').filter((l) => l && l[0] !== '#').length;
  const s = { file: f, records, raw: buf.length, gzip9: gzipSync(buf, { level: 9 }).length,
    br11: brotliCompressSync(buf, { params: { [Z.BROTLI_PARAM_QUALITY]: 11, [Z.BROTLI_PARAM_LGWIN]: 24, [Z.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length,
    br5: brotliCompressSync(buf, { params: { [Z.BROTLI_PARAM_QUALITY]: 5, [Z.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length,
    gzip6: gzipSync(buf, { level: 6 }).length };
  sizes.push(s); console.log(JSON.stringify(s));
}
fs.writeFileSync(path.join(outDir, 'sizes_files.json'), JSON.stringify(sizes, null, 1));
fs.writeFileSync(path.join(outDir, 'aliases_debug.json'), JSON.stringify(A.aliases.slice(0, 400).map(([a, ap]) => [a, ap, byAppid.get(ap)?.name])));
const ix = buildIndex(fromObjects(games), A.aliases);
const S = createSearcher(ix);
for (const q of ['hollow knight', 'baldurs gate', 'counter strike', 'elden', 'cs2', 'rdr2', 'gta 5', 'ff7', 'witcher 3', 'hades', 'los sims 4', 'pokemon', 'zelda', '2077', '1942', 'witchr', 'cyberpnk', 'eldenring', 'stalker 2', 'mafia edicion definitiva', '三国志', 'ドラゴン', 's', 'the', 'appid:730']) {
  const r = S.query(q, { limit: 5 });
  console.log(q.padEnd(26), r.ids.map((g, i) => `${games[g].name} [${r.tiers[i]}]`).join(' | '));
}
