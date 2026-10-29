// Motores para comparar en las mismas condiciones: D-09 (índice) y el escaneo del borrador. Módulo puro.
import { normalize, compact, buildIndex, createSearcher, fromObjects, F, TIER } from './search-core.mjs';
const ENV = (typeof process !== 'undefined' && process.env) || {};

// Nivel difuso (uFuzzy) diferido: se llama aparte, tras la pausa de tecleo, si hay <5 resultados en niveles 0–2
export function createFuzzy(ix, uFuzzy, { minLen = 4 } = {}) {
  const uf = new uFuzzy({ intraMode: 1, interLft: 1 });
  return (q, have = [], { limit = 5, showAdult = false } = {}) => {
    const qn = normalize(q);
    if (qn.length < minLen || /[^\x00-\x7F]/.test(qn)) return [];
    const idxs = uf.filter(ix.kBase, qn);
    const out = []; const seen = new Set(have);
    if (!idxs) return out;
    for (let i = 0; i < idxs.length && out.length < limit; i++) { const g = idxs[i]; if (seen.has(g) || (!showAdult && (ix.cat.flags[g] & F.ADULT))) continue; out.push(g); }
    return out; // idxs ya viene en orden de rango (el pajar está ordenado por rango)
  };
}

export function d09Engine(games, aliases, uFuzzy) {
  const ix = buildIndex(fromObjects(games), aliases);
  const S = createSearcher(ix, { substrMin: +(ENV.SUBSTR_MIN || 8), score: ENV.SCORE === '1' ? true : ENV.SCORE === '2' ? 'exactFirst' : false });
  const fz = uFuzzy ? createFuzzy(ix, uFuzzy) : null;
  return {
    ix,
    reset: S.reset,
    query: (q, o) => S.query(q, o),
    // lista final como la vería el usuario: niveles 0–3 y, si hay <5 en 0–2, el bloque difuso detrás
    full: (q, o = {}) => {
      const r = S.query(q, o); const strong = r.tiers.filter((t) => t <= TIER.WORDS).length;
      if (fz && strong < 5) { const more = fz(q, r.ids, { limit: 3, showAdult: o.showAdult }); const main = r.ids.slice(0, 8 - more.length); return { ids: [...main, ...more], tiers: [...r.tiers.slice(0, main.length), ...more.map(() => TIER.FUZZY)], fuzzy: true }; }
      return r;
    },
    fuzzy: fz,
  };
}

// Motor de escaneo del borrador (indexOf sobre un único string en orden de rango, 100 candidatos,
// reordenación por clase + 0,5·log10(reseñas) y alias), con la normalización corregida.
export function scanEngine(games, aliases, uFuzzy) {
  const N = games.length;
  const nn = games.map((g) => normalize(g.name));
  const pops = games.map((g) => (g.reviews != null ? g.reviews : Math.pow(2, (g.pop || 0) / 2) - 1)); // reseñas ≈ 2^(pop/2)
  const flags = Uint8Array.from(games.map((g) => g.flags || 0));
  const offs = new Int32Array(N + 1); const chunks = new Array(N); let pos = 0;
  for (let i = 0; i < N; i++) { offs[i] = pos; const rec = ' ' + nn[i] + '\n'; chunks[i] = rec; pos += rec.length; }
  offs[N] = pos; const hay = chunks.join('');
  const posOf = new Map(games.map((g, i) => [g.appid, i]));
  const akeys = []; for (const [a, ap] of aliases) { const g = posOf.get(ap); if (g !== undefined) akeys.push([a, g]); }
  akeys.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const keys = akeys.map((e) => e[0]);
  const aliasLookup = (qn) => {
    const qc = compact(qn); if (qc.length < 2 || qc.length > 8) return [];
    let lo = 0, hi = keys.length; while (lo < hi) { const m = (lo + hi) >> 1; if (keys[m] < qc) lo = m + 1; else hi = m; }
    const out = []; for (let i = lo; i < keys.length && keys[i].startsWith(qc) && out.length < 50; i++) out.push(akeys[i][1]); return out;
  };
  const scan = (qn, k, showAdult = false) => {
    const toks = qn.split(' ').filter(Boolean); if (!toks.length) return [];
    let anchor = toks[0]; for (const x of toks) if (x.length > anchor.length) anchor = x;
    const pat = ' ' + anchor, out = []; let from = 0;
    while (out.length < k) {
      const p = hay.indexOf(pat, from); if (p < 0) break;
      let lo = 0, hi = N - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (offs[m] <= p) lo = m; else hi = m - 1; }
      from = offs[lo + 1];
      if (toks.length > 1) { const h = ' ' + nn[lo]; let ok = true; for (const x of toks) if (x !== anchor && !h.includes(' ' + x)) { ok = false; break; } if (!ok) continue; }
      if (!showAdult && (flags[lo] & F.ADULT)) continue;
      out.push(lo);
    }
    return out;
  };
  const cls = (n, qn) => (n === qn ? 0 : n.startsWith(qn) ? 1 : (' ' + n).includes(' ' + qn) ? 2 : 3);
  let uf = null; if (uFuzzy) uf = new uFuzzy({ intraMode: 1, interLft: 1 });
  const query = (q, o = {}) => {
    const qn = normalize(q); if (!qn) return { ids: [], tiers: [] };
    const base = scan(qn, 100, o.showAdult); const al = aliasLookup(qn); const alSet = new Set(al);
    const set = new Set(base); for (const g of al) if (o.showAdult || !(flags[g] & F.ADULT)) set.add(g);
    const ranked = [...set].map((id, p) => { let c = cls(nn[id], qn); if (alSet.has(id)) c = Math.min(c, 1.5); return { id, p, s: -c + 0.5 * Math.log10(1 + pops[id]), l: nn[id].length }; })
      .sort((a, b) => b.s - a.s || a.l - b.l || a.p - b.p).map((x) => x.id).slice(0, 20);
    return { ids: ranked, tiers: ranked.map(() => 2), nbase: base.length };
  };
  return {
    reset: () => {}, query,
    full: (q, o = {}) => {
      const r = query(q, o); const qn = normalize(q);
      if (uf && r.nbase < 5 && qn.length >= 3) { const [idxs, info, ord] = uf.search(nn, qn, 0, 1000); if (idxs) { const more = ord ? ord.map((i) => info.idx[i]) : [...idxs]; const seen = new Set(r.ids); for (const g of more) if (!seen.has(g) && !(flags[g] & F.ADULT)) { r.ids.push(g); seen.add(g); } } }
      return r;
    },
  };
}
