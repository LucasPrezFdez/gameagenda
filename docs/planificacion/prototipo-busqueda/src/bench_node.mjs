// Benchmark en Node 24. Uso: node --expose-gc bench_node.mjs <modo: build|latency|quality> <filesDir> <outJson> [motor: d09|scan]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { gzipSync, brotliCompressSync, constants as Z } from 'node:zlib';
import { parseCoreTsv, parseAliasesTsv } from './catalog.mjs';
import { normalize, buildIndex, createSearcher, serializeIndex, deserializeIndex, parseCore, buildHaystack, TIER } from './search-core.mjs';
import { d09Engine, scanEngine } from './engines.mjs';
import { GOLDEN, NEGATIVE, DRAFT_FINALS, EXTRA_FINALS, TARGETS, typedSequences, realisticFinals, mulberry32 } from './golden.mjs';

const [mode, filesDir, outJson, engineName = 'd09'] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const UFZ = process.env.UFUZZY_PATH;
const uFuzzy = UFZ ? (await import('file:///' + UFZ.replace(/\\/g, '/'))).default : null;
const gc = () => { if (global.gc) { global.gc(); global.gc(); } };
const mem = () => { const m = process.memoryUsage(); return { heap: m.heapUsed, ab: m.arrayBuffers, ext: m.external }; };
const MB = (b) => +(b / 1048576).toFixed(2);
const stats = (arr) => { const s = Float64Array.from(arr).sort(); const p = (q) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]; return { n: s.length, p50: +p(0.5).toFixed(3), p95: +p(0.95).toFixed(3), p99: +p(0.99).toFixed(3), max: +s[s.length - 1].toFixed(3), mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3) }; };

const t0 = performance.now();
const coreText = fs.readFileSync(path.join(filesDir, 'core.tsv'), 'utf8');
const aliasText = fs.readFileSync(path.join(filesDir, 'aliases.tsv'), 'utf8');
const tRead = performance.now() - t0;
const R = { mode, engine: engineName, node: process.version, date: new Date().toISOString() };

if (mode === 'build') {
  gc(); const m0 = mem();
  let t = performance.now();
  const cat = parseCore(coreText); const aliases = parseAliasesTsv(aliasText);
  const tParse = performance.now() - t;
  gc(); const m1 = mem();
  t = performance.now();
  const ix = buildIndex(cat, aliases, { haystack: false });
  const tBuild = performance.now() - t;
  t = performance.now(); buildHaystack(ix); R.haystack_ms = +(performance.now() - t).toFixed(1);
  gc(); const m2 = mem();
  R.N = ix.N; R.tokens = ix.T; R.postings = ix.post.length; R.fwdTokensPerGame = +(ix.fwd.length / ix.N).toFixed(2); R.firstWordPostings = ix.fwp.length;
  R.bitsetsAll = ix.bsAll.size; R.bitsetsFirst = ix.bsFirst.size; R.haystackChars = ix.hayLat.hay.length + ix.hayUni.hay.length; R.aliasKeys = ix.aliasExact.size; R.esKeys = ix.kEs.size;
  R.parse_ms = +tParse.toFixed(1); R.build_ms = +tBuild.toFixed(1); R.read_ms = +tRead.toFixed(1);
  R.heap_rows_mb = MB(m1.heap - m0.heap); R.heap_index_mb = MB(m2.heap - m1.heap); R.arraybuffers_index_mb = MB(m2.ab - m1.ab); R.heap_total_mb = MB(m2.heap - m0.heap + m2.ab - m0.ab);
  // repetición de la construcción (JIT caliente)
  const reps = [];
  for (let i = 0; i < 3; i++) { const a = performance.now(); buildIndex(parseCore(coreText), aliases, { haystack: false }); reps.push(+(performance.now() - a).toFixed(1)); }
  R.parse_plus_build_ms_warm = reps;
    // serialización
  t = performance.now(); const buf = serializeIndex(ix); R.serialize_ms = +(performance.now() - t).toFixed(1);
  R.serialized = { raw: buf.length, gzip9: gzipSync(buf, { level: 9 }).length, br11: brotliCompressSync(buf, { params: { [Z.BROTLI_PARAM_QUALITY]: 11, [Z.BROTLI_PARAM_LGWIN]: 24, [Z.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length, br5: brotliCompressSync(buf, { params: { [Z.BROTLI_PARAM_QUALITY]: 5 } }).length };
  fs.writeFileSync(path.join(path.dirname(outJson), 'index.bin'), buf);
  const restores = [];
  let ix2;
  for (let i = 0; i < 4; i++) { const copy = new Uint8Array(buf); const a = performance.now(); ix2 = deserializeIndex(copy); restores.push(+(performance.now() - a).toFixed(1)); }
  R.restore_ms = restores;
  const noHay = []; for (let i = 0; i < 3; i++) { const copy = new Uint8Array(buf); const a = performance.now(); deserializeIndex(copy, { haystack: false }); noHay.push(+(performance.now() - a).toFixed(1)); }
  R.restore_ms_without_haystack = noHay;
  // el índice restaurado responde igual
  const S1 = createSearcher(ix), S2 = createSearcher(ix2); let diff = 0;
  for (const [q] of GOLDEN) { const a = S1.query(q).ids.join(','), b = S2.query(q).ids.join(','); if (a !== b) diff++; }
  R.restore_diff_queries = diff;
  // componentes del índice serializado
  const parts = {};
  const head = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + new DataView(buf.buffer).getUint32(0, true))));
  for (const [name, , , len] of head.parts) parts[name] = len;
  R.serialized_parts = parts;
}

if (mode === 'latency') {
  const games = parseCoreTsv(coreText); const aliases = parseAliasesTsv(aliasText);
  const E = engineName === 'scan' ? scanEngine(games, aliases, uFuzzy) : d09Engine(games, aliases, uFuzzy);
  const sets = {
    draft: typedSequences(DRAFT_FINALS, normalize),
    extra: typedSequences(EXTRA_FINALS, normalize),
    realistic: typedSequences(realisticFinals(games), normalize),
  };
  const REPS = +(process.env.REPS || 5);
  for (const [name, seqs] of Object.entries(sets)) {
    const cold = [], warm = [];
    for (let rep = 0; rep <= REPS; rep++) {
      for (const seq of seqs) { E.reset(); for (const q of seq) { const a = performance.now(); E.query(q, { limit: 20 }); const d = performance.now() - a; (rep === 0 ? cold : warm).push(d); } }
    }
    R[name] = { keystrokes: seqs.reduce((a, s) => a + s.length, 0), cold: stats(cold), warm: stats(warm), over16ms: warm.filter((x) => x > 16).length, over50ms: warm.filter((x) => x > 50).length };
  }
  // coste del nivel difuso (diferido) en las consultas finales donde se activaría
  if (E.fuzzy) {
    const fz = [];
    for (const f of [...DRAFT_FINALS, ...EXTRA_FINALS, ...GOLDEN.map((x) => x[0])]) {
      const r = E.query(f, { limit: 20 }); const strong = r.tiers.filter((t) => t <= TIER.WORDS).length;
      if (strong < 5) { const a = performance.now(); E.fuzzy(f, r.ids); fz.push(performance.now() - a); }
    }
    R.fuzzy_deferred = stats(fz);
  } else if (engineName === 'scan' && uFuzzy) {
    const fz = [];
    for (const seq of sets.draft) for (const q of seq) { const a = performance.now(); E.full(q); fz.push(performance.now() - a); }
    R.scan_hybrid_draft = stats(fz);
  }
  // peores consultas
  const worst = [];
  for (const seq of [...sets.draft, ...sets.extra, ...sets.realistic]) { E.reset(); for (const q of seq) { const a = performance.now(); E.query(q, { limit: 20 }); worst.push([performance.now() - a, q]); } }
  R.worst = worst.sort((a, b) => b[0] - a[0]).slice(0, 12).map(([d, q]) => [+d.toFixed(2), q]);
}

if (mode === 'quality') {
  const games = parseCoreTsv(coreText); const aliases = parseAliasesTsv(aliasText);
  const E = engineName === 'scan' ? scanEngine(games, aliases, uFuzzy) : d09Engine(games, aliases, uFuzzy);
  const pos = new Map(games.map((g, i) => [g.appid, i]));
  const rankOf = (ids, exp) => { const want = new Set(exp.map((a) => pos.get(a)).filter((x) => x !== undefined)); const k = ids.findIndex((g) => want.has(g)); return k < 0 ? 0 : k + 1; };
  // conjunto dorado
  const rows = []; let t1 = 0, t5 = 0, t1n = 0, t5n = 0, missingExp = [];
  for (const [q, exp, cat] of GOLDEN) {
    if (!exp.some((a) => pos.has(a))) { missingExp.push(q); continue; }
    E.reset(); const r = E.full(q, { limit: 20 }); const k = rankOf(r.ids, exp);
    E.reset(); const r0 = E.query(q, { limit: 20 }); const k0 = rankOf(r0.ids, exp);
    if (k === 1) t1++; if (k >= 1 && k <= 5) t5++;
    if (k0 === 1) t1n++; if (k0 >= 1 && k0 <= 5) t5n++;
    rows.push({ q, cat, rank: k, rankNoFuzzy: k0, top: r.ids.slice(0, 3).map((g) => games[g].name), tierOfHit: k ? r.tiers[k - 1] : null });
  }
  const G = rows.length;
  R.golden = { n: G, top1: t1, top5: t5, top1_pct: +(100 * t1 / G).toFixed(1), top5_pct: +(100 * t5 / G).toFixed(1), top1_noFuzzy: t1n, top5_noFuzzy: t5n, missingExpected: missingExp, fails: rows.filter((x) => x.rank === 0 || x.rank > 5), notTop1: rows.filter((x) => x.rank !== 1).map((x) => [x.q, x.rank, x.top[0]]) };
  const byCat = {}; for (const x of rows) { const c = byCat[x.cat] ||= { n: 0, top1: 0, top5: 0 }; c.n++; if (x.rank === 1) c.top1++; if (x.rank >= 1 && x.rank <= 5) c.top5++; }
  R.golden_by_category = byCat;
  // negativas
  R.negative = NEGATIVE.map((q) => { E.reset(); const r = E.full(q, { limit: 20 }); return { q, n: r.ids.length, strong: r.tiers.filter((t) => t <= 1).length, top: r.ids.slice(0, 3).map((g, i) => games[g].name + ' [' + r.tiers[i] + ']') }; });
  // 2 000 nombres exactos al azar (con +18 visible para no penalizar los ocultos por defecto)
  const rnd = mulberry32(42); const N = games.length; const sample = new Set(); while (sample.size < 2000) sample.add(Math.floor(rnd() * N));
  const nameCount = new Map(); for (const g of games) { const k = normalize(g.name); nameCount.set(k, (nameCount.get(k) || 0) + 1); }
  let ex5 = 0, exDupFail = 0; const exFails = [];
  for (const g of sample) { E.reset(); const r = E.query(games[g].name, { limit: 20, showAdult: true }); const k = r.ids.indexOf(g) + 1; if (k >= 1 && k <= 5) ex5++; else { if ((nameCount.get(normalize(games[g].name)) || 0) >= 5) exDupFail++; if (exFails.length < 15) exFails.push([games[g].name, k, nameCount.get(normalize(games[g].name))]); } }
  R.exact2000 = { top5: ex5, top5_pct: +(100 * ex5 / 2000).toFixed(2), fails_with_5plus_duplicates: exDupFail, sample_fails: exFails };
  // prefijos de 4 letras de los 1 000 más populares (top-10)
  let p10 = 0; const pFails = [];
  for (let g = 0; g < 1000; g++) {
    const n = normalize(games[g].name); const q = Array.from(n).slice(0, 4).join('').trim();
    E.reset(); const r = E.query(q, { limit: 20, showAdult: true }); const k = r.ids.indexOf(g) + 1;
    if (k >= 1 && k <= 10) p10++; else if (pFails.length < 15) pFails.push([q, games[g].name, k]);
  }
  R.prefix4_top1000 = { top10: p10, top10_pct: +(p10 / 10).toFixed(1), sample_fails: pFails };
  // pulsaciones hasta top-5 / top-1
  R.keystrokes_to_hit = TARGETS.map(([f, exp]) => {
    const seq = typedSequences([f], normalize)[0]; let c5 = -1, c1 = -1; E.reset();
    seq.forEach((q, i) => { const r = E.query(q, { limit: 20 }); const k = rankOf(r.ids, exp); if (c5 < 0 && k >= 1 && k <= 5) c5 = i + 1; if (c1 < 0 && k === 1) c1 = i + 1; });
    return `${f}: ${c5}/${c1}`;
  });
  R.golden_rows = rows;
}

fs.writeFileSync(outJson, JSON.stringify(R, null, 1));
const brief = { ...R }; delete brief.golden_rows; delete brief.serialized_parts;
console.log(JSON.stringify(brief, null, 0).slice(0, 6000));
