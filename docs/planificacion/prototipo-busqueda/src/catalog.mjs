// Carga del catálogo derivado, orden por rango estático, alias y ficheros D-08.
import fs from 'node:fs';
import { normalize, compact, tokenize, generateAcronyms, ARTICLES, F } from './search-core.mjs';

export function loadDerived(tsvPath) {
  const lines = fs.readFileSync(tsvPath, 'utf8').split('\n');
  const games = [];
  for (const line of lines) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t');
    const [appid, name, nameEs, type, soon, early, adult, free, tba, year, rc] = c;
    if (type !== '0') continue; // solo juegos
    let flags = 0;
    if (soon === '1') flags |= F.SOON; if (early === '1') flags |= F.EARLY; if (adult === '1') flags |= F.ADULT; if (free === '1') flags |= F.FREE; if (tba === '1') flags |= F.TBA;
    games.push({ appid: +appid, name, nameEs: nameEs || undefined, flags, year: year ? +year : 0, reviews: +rc || 0 });
  }
  // rango estático: reseñas desc; empate → appid desc (más reciente primero); retirados al final
  games.sort((a, b) => ((a.flags & F.RETIRED) - (b.flags & F.RETIRED)) || b.reviews - a.reviews || b.appid - a.appid);
  for (const g of games) g.pop = Math.min(63, Math.floor(2 * Math.log2(g.reviews + 1)));
  return games;
}

// Alias curados (compactos) → appid. Se verifican contra el catálogo al cargarlos.
export const CURATED = [
  ['csgo', 730], ['ff7', 1462040], ['ff7', 39140], ['ff7', 2909400], ['ffvii', 1462040], ['ffvii', 39140], ['ff7remake', 1462040], ['ff7rebirth', 2909400],
  ['ff10', 359870], ['ffx', 359870], ['ff12', 595520], ['ff13', 292120], ['ff14', 39210], ['ffxiv', 39210], ['ff15', 637650], ['ffxv', 637650], ['ff16', 2515020], ['ffxvi', 2515020],
  ['ff9', 377840], ['ff8', 1026680], ['civ6', 289070], ['civ5', 8930], ['civ7', 1295660], ['aoe2', 813780], ['aoe4', 1466860], ['aoe3', 933110],
  ['re4', 2050650], ['re4', 254700], ['re2', 883710], ['re3', 952060], ['re8', 1196590], ['re7', 418370], ['tes5', 489830], ['tes5', 72850], ['tes4', 22330],
  ['fnaf', 319510], ['pvz', 3590], ['mhr', 1446780], ['poe', 238960], ['poe2', 2694490], ['tlou', 1888930], ['tlou2', 2531310], ['gow', 1593500],
  ['rdr', 2668510], ['kotor', 32370], ['bo3', 311210], ['gta5', 3240220], ['gtav', 3240220], ['lossims4', 1222670], ['sims4', 1222670],
];

export function buildAliases(games, { topK = 5000, minCommonToken = 20 } = {}) {
  // frecuencia de tokens en nombres base: una sigla generada que sea palabra común se descarta («the», «war»…)
  const freq = new Map();
  for (const g of games) for (const t of new Set(tokenize(normalize(g.name)))) freq.set(t, (freq.get(t) || 0) + 1);
  const byAppid = new Map(games.map((g) => [g.appid, g]));
  const gen = [];
  let dropped = 0;
  const top = games.filter((g) => g.reviews > 0).slice(0, topK);
  for (const g of top) {
    for (const a of generateAcronyms(g.name)) {
      if (ARTICLES.has(a) || (freq.get(a) || 0) >= minCommonToken) { dropped++; continue; }
      gen.push([a, g.appid, 'gen']);
    }
  }
  const cur = [];
  const missing = [];
  for (const [a, ap] of CURATED) { if (byAppid.has(ap)) cur.push([compact(normalize(a)), ap, 'cur']); else missing.push([a, ap]); }
  const seen = new Set(); const all = [];
  for (const x of [...cur, ...gen]) { const k = x[0] + '\t' + x[1]; if (seen.has(k)) continue; seen.add(k); all.push(x); }
  return { aliases: all.map(([a, ap]) => [a, ap]), generated: gen.length, curated: cur.length, dropped, missing };
}

export function coreTsv(games, version = '20261028.1', limit = Infinity) {
  const out = ['#gacat-core v1\t' + version + '\tappid\tname\tnameEs\tflags\tyear\tpop'];
  const n = Math.min(limit, games.length);
  for (let i = 0; i < n; i++) { const g = games[i]; out.push(`${g.appid}\t${g.name}\t${g.nameEs || ''}\t${g.flags || ''}\t${g.year || ''}\t${g.pop || ''}`); }
  return out.join('\n') + '\n';
}
export function aliasesTsv(aliases, version = '20261028.1') {
  const s = [...aliases].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  return '#gacat-aliases v1\t' + version + '\talias\tappid\n' + s.map(([a, ap]) => `${a}\t${ap}`).join('\n') + '\n';
}
export function parseCoreTsv(text) {
  const games = [];
  let i = text.indexOf('\n') + 1;
  while (i < text.length) {
    let j = text.indexOf('\n', i); if (j < 0) j = text.length;
    const c = text.slice(i, j).split('\t');
    games.push({ appid: +c[0], name: c[1], nameEs: c[2] || undefined, flags: +c[3] || 0, year: +c[4] || 0, pop: +c[5] || 0 });
    i = j + 1;
  }
  return games;
}
export function parseAliasesTsv(text) {
  const out = [];
  for (const line of text.split('\n')) { if (!line || line[0] === '#') continue; const t = line.indexOf('\t'); out.push([line.slice(0, t), +line.slice(t + 1)]); }
  return out;
}
