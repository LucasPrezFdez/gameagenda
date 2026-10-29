// Prototipo del núcleo de búsqueda de GameAgenda (diseño D-09), versión optimizada.
// Módulo puro: sin APIs de Node ni del DOM; vale para Node 24, Web Workers y tests.

// ---------------------------------------------------------------- normalización
// 1) quitar ™ ℠ ® © y todas las formas de apóstrofo ANTES de NFKD
const RE_STRIP = /[™℠®©'‘’‛ʼʻ`´′＇]/g;
// 3) diacríticos (bloques de marcas combinantes latinas; no toca kana, hangul ni escrituras índicas)
const RE_MARKS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;
const LIG = { 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i' };
const RE_LIG = /[ßæœøłđðþı]/g;
const RE_SEP = /[^\p{L}\p{N}\p{M}]+/gu;

function normalizeSlow(s) {
  return s.replace(RE_STRIP, '').normalize('NFKD').replace(RE_MARKS, '').normalize('NFC').toLowerCase()
    .replace(RE_LIG, (c) => LIG[c]).replace(/&/g, ' and ').replace(RE_SEP, ' ').trim();
}
// Ruta rápida ASCII (92 % de los nombres): produce exactamente lo mismo que normalizeSlow.
export function normalize(s) {
  const L = s.length;
  for (let i = 0; i < L; i++) if (s.charCodeAt(i) > 127) return normalizeSlow(s);
  let out = '', pend = false;
  for (let i = 0; i < L; i++) {
    let c = s.charCodeAt(i);
    if (c >= 65 && c <= 90) c += 32;
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) { if (pend && out.length) out += ' '; pend = false; out += String.fromCharCode(c); }
    else if (c === 39 || c === 96) { /* apóstrofo: se elimina */ }
    else if (c === 38) { if (out.length) out += ' '; out += 'and'; pend = true; }
    else pend = true;
  }
  return out;
}
export const compact = (n) => n.replace(/ /g, '');
export const ARTICLES = new Set(['the', 'a', 'an', 'el', 'la', 'los', 'las']);
export function stripArticle(n) { const i = n.indexOf(' '); return i > 0 && ARTICLES.has(n.slice(0, i)) ? n.slice(i + 1) : n; }
function articleLen(n) { const i = n.indexOf(' '); return i > 0 && i <= 3 && ARTICLES.has(n.slice(0, i)) ? i + 1 : 0; }

// ---------------------------------------------------------------- tokens
const RE_CJK = /[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Hang}]/u;
function isAscii(s) { for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false; return true; }
// CJK/kana/hangul: bigramas solapados + último carácter suelto (en consultas, solo bigramas)
export function tokenize(n, isQuery = false) {
  const out = [];
  if (!n) return out;
  const ascii = isAscii(n);
  for (const w of n.split(' ')) {
    if (!w) continue;
    if (ascii || !RE_CJK.test(w)) { out.push(w); continue; }
    const cps = Array.from(w); let i = 0;
    while (i < cps.length) {
      const cjk = RE_CJK.test(cps[i]); let j = i + 1;
      while (j < cps.length && RE_CJK.test(cps[j]) === cjk) j++;
      if (!cjk) out.push(cps.slice(i, j).join(''));
      else if (j - i === 1) out.push(cps[i]);
      else { for (let k = i; k < j - 1; k++) out.push(cps[k] + cps[k + 1]); if (!isQuery) out.push(cps[j - 1]); }
      i = j;
    }
  }
  return out;
}
const ROMAN = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx'];
const ARABIC = ROMAN.map((_, i) => String(i));
const ROMAN_TO = new Map(ROMAN.map((r, i) => [r, i]).slice(1));
// romanos 1–20 ↔ arábigos como token extra; solo palabras aisladas que no son la primera
export function numberExtra(t) {
  const c = t.charCodeAt(0);
  if ((c === 105 || c === 118 || c === 120) && t.length <= 5) { const r = ROMAN_TO.get(t); return r ? ARABIC[r] : null; }
  if (c >= 49 && c <= 57 && t.length <= 2) { const v = +t; return v >= 1 && v <= 20 && ARABIC[v] === t ? ROMAN[v] : null; }
  return null;
}

// ---------------------------------------------------------------- siglas generadas
const RE_SUBTITLE = /\s*(?::|\s[-–—|]\s)\s*/;
function acronymOf(n) {
  const w = n.split(' ').filter(Boolean);
  if (w.length < 2) return [];
  let a = '', b = '', letters = 0;
  for (let i = 0; i < w.length; i++) {
    const t = w[i];
    if (/^\d+$/.test(t)) { a += t; b += t; continue; }
    const r = i > 0 ? ROMAN_TO.get(t) : undefined;
    if (r) { a += t; b += String(r); continue; }
    if (RE_CJK.test(t)) return [];
    a += t[0]; b += t[0]; letters++;
  }
  const out = [];
  for (const x of new Set([a, b])) if (letters >= 2 && x.length >= 3 && x.length <= 10) out.push(x);
  return out;
}
export function generateAcronyms(name) {
  const set = new Set();
  const full = normalize(name);
  const main = normalize(name.split(RE_SUBTITLE)[0]);
  for (const n of new Set([full, main, stripArticle(full), stripArticle(main)])) for (const x of acronymOf(n)) set.add(x);
  const mw = main.split(' ');
  for (let i = 1; i < mw.length; i++) if (/^\d+$/.test(mw[i]) || ROMAN_TO.has(mw[i])) { for (const x of acronymOf(mw.slice(0, i + 1).join(' '))) set.add(x); break; }
  return [...set];
}

// ---------------------------------------------------------------- códec del núcleo (TSV de D-08)
export const F = { SOON: 1, EARLY: 2, ADULT: 4, FREE: 8, RETIRED: 16, TBA: 32 };
export function parseCore(text) {
  let N = 0; for (let p = text.indexOf('\n') + 1; p > 0 && p < text.length; p = text.indexOf('\n', p) + 1) N++;
  const cat = { N, appid: new Uint32Array(N), name: new Array(N), nameEs: new Map(), flags: new Uint8Array(N), year: new Uint16Array(N), pop: new Uint8Array(N) };
  let p = text.indexOf('\n') + 1;
  const num = (a, b) => { let v = 0; for (let i = a; i < b; i++) v = v * 10 + (text.charCodeAt(i) - 48); return v; };
  for (let g = 0; g < N; g++) {
    const e = text.indexOf('\n', p);
    const t1 = text.indexOf('\t', p), t2 = text.indexOf('\t', t1 + 1), t3 = text.indexOf('\t', t2 + 1), t4 = text.indexOf('\t', t3 + 1), t5 = text.indexOf('\t', t4 + 1);
    cat.appid[g] = num(p, t1); cat.name[g] = text.slice(t1 + 1, t2);
    if (t3 > t2 + 1) cat.nameEs.set(g, text.slice(t2 + 1, t3));
    cat.flags[g] = num(t3 + 1, t4); cat.year[g] = num(t4 + 1, t5); cat.pop[g] = num(t5 + 1, e);
    p = e + 1;
  }
  return cat;
}
export function fromObjects(games) {
  const N = games.length;
  const cat = { N, appid: new Uint32Array(N), name: new Array(N), nameEs: new Map(), flags: new Uint8Array(N), year: new Uint16Array(N), pop: new Uint8Array(N) };
  games.forEach((g, i) => { cat.appid[i] = g.appid; cat.name[i] = g.name; if (g.nameEs) cat.nameEs.set(i, g.nameEs); cat.flags[i] = g.flags || 0; cat.year[i] = g.year || 0; cat.pop[i] = g.pop || 0; });
  return cat;
}

// ---------------------------------------------------------------- construcción
// cat: columnas en orden de rango estático (fila 0 = la más popular). aliases: [[aliasCompacto, appid], ...]
export function buildIndex(cat, aliases = [], { bitsetMin = 1500, haystack = true } = {}) {
  const N = cat.N;
  const kBase = new Array(N), artLen = new Uint8Array(N), kEs = new Map();
  const tokId = new Map(), tokList = [];
  let fwd = new Int32Array(N * 4), fwdLen = 0; const fwdStart = new Uint32Array(N + 1);
  let fw = new Int32Array(N * 2), fwLen = 0; const fwStart = new Uint32Array(N + 1);
  const { byAppid, sortedAppid } = appidOrder(cat.appid);
  const ix = { N, cat, kBase, artLen, kEs, byAppid, sortedAppid };
  const aliasOf = new Map(), aliasExact = new Map();
  for (const [a, ap] of aliases) {
    const g = gOfAppid(ix, ap); if (g < 0) continue;
    let l = aliasOf.get(g); if (!l) aliasOf.set(g, l = []); l.push(a);
    const v = aliasExact.get(a); if (!v) aliasExact.set(a, [g]); else if (!v.includes(g)) v.push(g);
  }
  for (const v of aliasExact.values()) v.sort((x, y) => x - y);
  let gStart = 0, fStart = 0;
  const addTok = (t) => {
    let id = tokId.get(t);
    if (id === undefined) { id = tokList.length; tokId.set(t, id); tokList.push(t); }
    for (let p = gStart; p < fwdLen; p++) if (fwd[p] === id) return id;
    if (fwdLen === fwd.length) { const n2 = new Int32Array(fwd.length * 2); n2.set(fwd); fwd = n2; }
    fwd[fwdLen++] = id; return id;
  };
  const addFirst = (id) => {
    for (let p = fStart; p < fwLen; p++) if (fw[p] === id) return;
    if (fwLen === fw.length) { const n2 = new Int32Array(fw.length * 2); n2.set(fw); fw = n2; }
    fw[fwLen++] = id;
  };
  const addKey = (n) => {
    if (isAscii(n)) {
      let i = 0, w = 0, art = false;
      for (;;) {
        let j = n.indexOf(' ', i); if (j < 0) j = n.length;
        const t = n.slice(i, j);
        if (t) {
          const id = addTok(t);
          if (w === 0) { addFirst(id); art = ARTICLES.has(t); } else { if (w === 1 && art) addFirst(id); const x = numberExtra(t); if (x) addTok(x); }
          w++;
        }
        if (j >= n.length) break; i = j + 1;
      }
      return;
    }
    const toks = tokenize(n, false);
    if (toks.length) addFirst(addTok(toks[0]));
    for (let k = 1; k < toks.length; k++) addTok(toks[k]);
    const words = n.split(' ');
    if (words.length > 1 && ARTICLES.has(words[0])) { const t2 = tokenize(words.slice(1).join(' '), false)[0]; if (t2) addFirst(addTok(t2)); }
    for (let k = 1; k < words.length; k++) { const x = numberExtra(words[k]); if (x) addTok(x); }
  };
  for (let g = 0; g < N; g++) {
    const nb = normalize(cat.name[g]);
    kBase[g] = nb; artLen[g] = articleLen(nb);
    gStart = fwdLen; fStart = fwLen; fwdStart[g] = fwdLen; fwStart[g] = fwLen;
    addKey(nb);
    const es = cat.nameEs.get(g);
    if (es !== undefined) { const ne = normalize(es); if (ne && ne !== nb) { kEs.set(g, ne); addKey(ne); } }
    const al = aliasOf.get(g); if (al) for (const a of al) addTok(a);
  }
  fwdStart[N] = fwdLen; fwStart[N] = fwLen;
  // diccionario ordenado (orden de unidades UTF-16, el mismo que usa `<` en la búsqueda binaria)
  const T = tokList.length;
  const tokens = tokList.slice().sort();
  const remap = new Uint32Array(T);
  for (let r = 0; r < T; r++) remap[tokId.get(tokens[r])] = r;
  const fwdArr = new Uint32Array(fwdLen); for (let p = 0; p < fwdLen; p++) fwdArr[p] = remap[fwd[p]];
  const fwArr = new Uint32Array(fwLen); for (let p = 0; p < fwLen; p++) fwArr[p] = remap[fw[p]];
  Object.assign(ix, { T, tokens, fwd: fwdArr, fwdStart, aliasExact }, invert(fwdArr, fwdStart, N, T, 'post'), invert(fwArr, fwStart, N, T, 'fwp'));
  buildBitsets(ix, bitsetMin);
  if (haystack) buildHaystack(ix);
  return ix;
}
function appidOrder(appid) {
  const N = appid.length;
  const key = new Float64Array(N); for (let i = 0; i < N; i++) key[i] = appid[i] * 4194304 + i; // appid·2^22 + fila: exacto en float64
  key.sort();
  const byAppid = new Uint32Array(N), sortedAppid = new Uint32Array(N);
  for (let i = 0; i < N; i++) { const k = key[i]; const r = k % 4194304; byAppid[i] = r; sortedAppid[i] = (k - r) / 4194304; }
  return { byAppid, sortedAppid };
}
export function gOfAppid(ix, ap) {
  const s = ix.sortedAppid; let lo = 0, hi = s.length - 1;
  while (lo <= hi) { const m = (lo + hi) >>> 1; if (s[m] < ap) lo = m + 1; else if (s[m] > ap) hi = m - 1; else return ix.byAppid[m]; }
  return -1;
}
function invert(arr, start, N, T, name) {
  const st = new Uint32Array(T + 1);
  for (let p = 0; p < arr.length; p++) st[arr[p] + 1]++;
  for (let t = 0; t < T; t++) st[t + 1] += st[t];
  const post = new Uint32Array(arr.length); const cur = st.slice(0, T);
  for (let g = 0; g < N; g++) for (let p = start[g]; p < start[g + 1]; p++) post[cur[arr[p]]++] = g;
  return { [name]: post, [name + 'Start']: st };
}
function buildBitsets(ix, min) {
  const W = (ix.N + 31) >>> 5; ix.W = W; ix.bsAll = new Map(); ix.bsFirst = new Map();
  let t = 0;
  while (t < ix.T) {
    const c = String.fromCodePoint(ix.tokens[t].codePointAt(0));
    const [lo, hi] = prefixRange(ix.tokens, c);
    for (const [name, map] of [['post', ix.bsAll], ['fwp', ix.bsFirst]]) {
      const st = ix[name + 'Start'], post = ix[name];
      if (st[hi] - st[lo] >= min) { const bs = new Uint32Array(W); for (let p = st[lo]; p < st[hi]; p++) { const g = post[p]; bs[g >>> 5] |= 1 << (g & 31); } map.set(c, bs); }
    }
    t = hi;
  }
}
// pajar de claves compactas (sin espacios) para el nivel de subcadena: uno de 1 byte/carácter y otro para el resto
export function buildHaystack(ix) {
  const lat = [], latIds = [], uni = [], uniIds = [];
  const add = (c, g) => { let wide = false; for (let i = 0; i < c.length; i++) if (c.charCodeAt(i) > 255) { wide = true; break; } if (wide) { uni.push(c); uniIds.push(g); } else { lat.push(c); latIds.push(g); } };
  for (let g = 0; g < ix.N; g++) { const c = compact(ix.kBase[g]); add(c, g); const e = ix.kEs.get(g); if (e !== undefined) { const ce = compact(e); if (ce !== c) add(ce, g); } }
  const mk = (arr, ids) => { const offs = new Uint32Array(arr.length + 1); let pos = 0; for (let i = 0; i < arr.length; i++) { offs[i] = pos; pos += arr[i].length + 1; } offs[arr.length] = pos; return { hay: arr.join('\n') + '\n', offs, ids: Uint32Array.from(ids) }; };
  ix.hayLat = mk(lat, latIds); ix.hayUni = mk(uni, uniIds);
}

// ---------------------------------------------------------------- búsqueda
export function prefixRange(tokens, p) {
  let lo = 0, hi = tokens.length;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (tokens[m] < p) lo = m + 1; else hi = m; }
  const a = lo; hi = tokens.length;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (tokens[m].startsWith(p)) lo = m + 1; else hi = m; }
  return [a, lo];
}
function exactToken(tokens, t) { const [lo, hi] = prefixRange(tokens, t); return lo < hi && tokens[lo] === t ? lo : -1; }
export const TIER = { LINK: -1, EXACT: 0, TITLE: 1, WORDS: 2, SUBSTR: 3, FUZZY: 4 };

// Recorre en orden ascendente (= rango) la unión de postings de un rango de tokens; cb devuelve false para parar
function forEachInRange(ix, name, lo, hi, prefix, scratch, cb) {
  const st = ix[name + 'Start'], post = ix[name];
  const a = st[lo], b = st[hi];
  if (b === a) return;
  if (hi - lo === 1) { for (let p = a; p < b; p++) if (cb(post[p]) === false) return; return; }
  const single = prefix.length === 1 || (prefix.length === 2 && prefix.codePointAt(0) > 0xFFFF);
  const pre = single ? (name === 'post' ? ix.bsAll : ix.bsFirst).get(prefix) : undefined;
  if (pre) { for (let w = 0; w < pre.length; w++) { let v = pre[w]; while (v) { const bit = 31 - Math.clz32(v & -v); v &= v - 1; if (cb((w << 5) | bit) === false) return; } } return; }
  if (b - a <= 64) { const tmp = Array.from(post.subarray(a, b)).sort((x, y) => x - y); let prev = -1; for (const g of tmp) { if (g === prev) continue; prev = g; if (cb(g) === false) return; } return; }
  const bs = scratch.bs, touched = scratch.touched; touched.length = 0;
  for (let p = a; p < b; p++) { const g = post[p], w = g >>> 5; if (bs[w] === 0) touched.push(w); bs[w] |= 1 << (g & 31); }
  touched.sort((x, y) => x - y);
  let stop = false;
  for (let i = 0; i < touched.length; i++) {
    const w = touched[i];
    if (!stop) { let v = bs[w]; while (v) { const bit = 31 - Math.clz32(v & -v); v &= v - 1; if (cb((w << 5) | bit) === false) { stop = true; break; } } }
    bs[w] = 0;
  }
}

export function createSearcher(ix, { substrMin = 8, substrCap = 200, substrRows = 3, score = false } = {}) {
  const scratch = { bs: new Uint32Array(ix.W), touched: [] };
  let subCache = null; // { qc, ids, complete }
  const kB = ix.kBase, aL = ix.artLen, kEs = ix.kEs;
  function hasTokenIn(g, lo, hi) { const f = ix.fwd; for (let p = ix.fwdStart[g], e = ix.fwdStart[g + 1]; p < e; p++) { const t = f[p]; if (t >= lo && t < hi) return true; } return false; }
  function keyStarts(k, al, qn, qa) { return k.startsWith(qn) || (al > 0 && k.startsWith(qa, al)) || (qa !== qn && k.startsWith(qa)); }
  function keyEquals(k, al, qn, qa) { return k === qn || (qa !== qn && k === qa) || (al > 0 && k.length - al === qa.length && k.startsWith(qa, al)); }
  function isTitleStart(g, qn, qa) { if (keyStarts(kB[g], aL[g], qn, qa)) return true; const e = kEs.get(g); return e !== undefined && keyStarts(e, articleLen(e), qn, qa); }
  function isExact(g, qn, qa) { if (keyEquals(kB[g], aL[g], qn, qa)) return true; const e = kEs.get(g); return e !== undefined && keyEquals(e, articleLen(e), qn, qa); }
  function query(q, { limit = 20, showAdult = false } = {}) {
    const out = [], tiers = [], inOut = new Set();
    const qn = normalize(q);
    if (!qn) return { ids: out, tiers, qn };
    const flags = ix.cat.flags;
    const push = (g, tier) => { if (inOut.has(g) || (!showAdult && (flags[g] & F.ADULT))) return; inOut.add(g); out.push(g); tiers.push(tier); };
    const m = /^appid:\s*(\d{1,10})$/i.exec(q.trim()); // appid solo con prefijo explícito (o enlace, fuera de este módulo)
    if (m) { const g = gOfAppid(ix, +m[1]); if (g >= 0) push(g, TIER.LINK); return { ids: out, tiers, qn }; }
    const qa = stripArticle(qn), qc = compact(qn);
    let qt = tokenize(qn, true);
    if (qt.length > 1 && ARTICLES.has(qt[0])) qt = qt.slice(1);
    // nivel 0: exacto (nombre base, nombre ES, con o sin artículo) o alias exacto
    const ex = [];
    for (const f of new Set([tokenize(qn, true)[0], tokenize(qa, true)[0]])) {
      const t = exactToken(ix.tokens, f); if (t < 0) continue;
      for (let p = ix.fwpStart[t], e = ix.fwpStart[t + 1]; p < e; p++) { const g = ix.fwp[p]; if (isExact(g, qn, qa)) ex.push(g); }
    }
    const av = ix.aliasExact.get(qc); if (av) for (const g of av) ex.push(g);
    ex.sort((a, b) => a - b); for (const g of ex) push(g, TIER.EXACT);
    const ranges = qt.map((t) => prefixRange(ix.tokens, t));
    const anyEmpty = ranges.some(([lo, hi]) => lo === hi);
    // nivel 1: empieza por el título (con o sin artículo)
    if (out.length < limit && !anyEmpty && qt.length) {
      if (qt.length === 1) {
        const [lo, hi] = ranges[0];
        const cap1 = score ? out.length + limit : limit;
        forEachInRange(ix, 'fwp', lo, hi, qt[0], scratch, (g) => { if (!inOut.has(g) && isTitleStart(g, qn, qa)) push(g, TIER.TITLE); return out.length < cap1; });
      } else {
        const cand = [];
        for (const f of new Set([tokenize(qn, true)[0], tokenize(qa, true)[0]])) { const t = exactToken(ix.tokens, f); if (t >= 0) for (let p = ix.fwpStart[t], e = ix.fwpStart[t + 1]; p < e; p++) cand.push(ix.fwp[p]); }
        cand.sort((a, b) => a - b);
        let prev = -1;
        for (const g of cand) { if (g === prev) continue; prev = g; if (!inOut.has(g) && isTitleStart(g, qn, qa)) { push(g, TIER.TITLE); if (out.length >= limit) break; } }
      }
    }
    // nivel 2: todos los tokens como prefijos de palabra (conductor = el token más selectivo)
    const cap2 = score ? out.length + limit : limit;
    if (out.length < cap2 && !anyEmpty && qt.length) {
      let d = 0, best = Infinity;
      for (let j = 0; j < ranges.length; j++) { const [lo, hi] = ranges[j]; const c = ix.postStart[hi] - ix.postStart[lo]; if (c < best) { best = c; d = j; } }
      const others = ranges.filter((_, j) => j !== d);
      const [dlo, dhi] = ranges[d];
      forEachInRange(ix, 'post', dlo, dhi, qt[d], scratch, (g) => {
        if (inOut.has(g)) return true;
        for (let j = 0; j < others.length; j++) if (!hasTokenIn(g, others[j][0], others[j][1])) return true;
        push(g, TIER.WORDS);
        return out.length < cap2;
      });
    }
    // nivel 3: subcadena sobre la clave compacta, solo si faltan resultados
    if (out.length < substrMin && qc.length >= 3 && ix.hayLat) {
      let ids;
      if (subCache && subCache.complete && qc.includes(subCache.qc)) ids = subCache.ids.filter((g) => matchesCompact(g, qc));
      else ids = scanHaystacks(qc, substrCap);
      subCache = { qc, ids, complete: ids.length < substrCap };
      let rows = 0;
      for (const g of ids) { if (out.length >= limit || rows >= substrRows) break; const n0 = out.length; push(g, TIER.SUBSTR); if (out.length > n0) rows++; }
    }
    if (score) { // variante experimental (no es D-09): popularidad + bonificación por nivel
      const B = score === 'exactFirst' ? [1000, 6, 0, -6] : [12, 6, 0, -6]; const pop = ix.cat.pop;
      const ord = out.map((g, i) => [g, tiers[i]]).sort((a, b) => (pop[b[0]] + (B[b[1]] ?? 0)) - (pop[a[0]] + (B[a[1]] ?? 0)) || a[1] - b[1] || a[0] - b[0]);
      return { ids: ord.map((x) => x[0]), tiers: ord.map((x) => x[1]), qn };
    }
    return { ids: out, tiers, qn };
  }
  function matchesCompact(g, qc) { if (compact(kB[g]).includes(qc)) return true; const e = kEs.get(g); return e !== undefined && compact(e).includes(qc); }
  function scanOne(H, qc, k, res) {
    let from = 0;
    while (res.length < k) {
      const p = H.hay.indexOf(qc, from); if (p < 0) break;
      let lo = 0, hi = H.ids.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >>> 1; if (H.offs[mid] <= p) lo = mid; else hi = mid - 1; }
      res.push(H.ids[lo]); from = H.offs[lo + 1];
    }
    return res;
  }
  function scanHaystacks(qc, k) {
    let wide = false; for (let i = 0; i < qc.length; i++) if (qc.charCodeAt(i) > 255) { wide = true; break; }
    const a = wide ? [] : scanOne(ix.hayLat, qc, k, []);
    const b = scanOne(ix.hayUni, qc, k, []);
    const all = a.concat(b).sort((x, y) => x - y); const res = []; let prev = -1;
    for (const g of all) { if (g !== prev) res.push(g); prev = g; if (res.length >= k) break; }
    return res;
  }
  return { query, reset: () => { subCache = null; } };
}

// ---------------------------------------------------------------- persistencia (typed arrays en un ArrayBuffer)
export function serializeIndex(ix) {
  const enc = new TextEncoder();
  const esIdx = [], esKey = []; for (const [g, k] of ix.kEs) { esIdx.push(g); esKey.push(k); }
  const aliasK = [], aliasV = []; for (const [k, v] of ix.aliasExact) for (const g of v) { aliasK.push(k); aliasV.push(g); }
  const c = ix.cat; const nameEsIdx = [], nameEsVal = []; for (const [g, s] of c.nameEs) { nameEsIdx.push(g); nameEsVal.push(s); }
  const parts = {
    appid: c.appid, flags: c.flags, year: c.year, pop: c.pop, names: enc.encode(c.name.join('\n')), nameEsIdx: Uint32Array.from(nameEsIdx), nameEs: enc.encode(nameEsVal.join('\n')),
    kBase: enc.encode(ix.kBase.join('\n')), artLen: ix.artLen, esIdx: Uint32Array.from(esIdx), esKey: enc.encode(esKey.join('\n')),
    tokens: enc.encode(ix.tokens.join('\n')), fwd: ix.fwd, fwdStart: ix.fwdStart, post: ix.post, postStart: ix.postStart, fwp: ix.fwp, fwpStart: ix.fwpStart,
    byAppid: ix.byAppid, sortedAppid: ix.sortedAppid, aliasK: enc.encode(aliasK.join('\n')), aliasV: Uint32Array.from(aliasV),
  };
  const head = { v: 1, N: ix.N, T: ix.T, parts: [] };
  let off = 0;
  for (const [name, arr] of Object.entries(parts)) { head.parts.push([name, arr.constructor.name, off, arr.byteLength]); off += (arr.byteLength + 3) & ~3; }
  const hb = enc.encode(JSON.stringify(head)); const H = (hb.length + 4 + 3) & ~3;
  const buf = new Uint8Array(H + off);
  new DataView(buf.buffer).setUint32(0, hb.length, true); buf.set(hb, 4);
  for (const [name, , o, len] of head.parts) buf.set(new Uint8Array(parts[name].buffer, parts[name].byteOffset, len), H + o);
  return buf;
}
const CTORS = { Uint32Array, Uint8Array, Int32Array, Uint16Array };
export function deserializeIndex(buf, { bitsetMin = 1500, haystack = true } = {}) {
  const dec = new TextDecoder();
  const hl = new DataView(buf.buffer, buf.byteOffset).getUint32(0, true);
  const head = JSON.parse(dec.decode(buf.subarray(4, 4 + hl))); const H = (hl + 4 + 3) & ~3;
  const P = {};
  for (const [name, ctor, o, len] of head.parts) { const C = CTORS[ctor]; P[name] = C === Uint8Array ? buf.subarray(H + o, H + o + len) : new C(buf.buffer, buf.byteOffset + H + o, len / C.BYTES_PER_ELEMENT); }
  const split = (u8) => (u8.length ? dec.decode(u8).split('\n') : []);
  const cat = { N: head.N, appid: P.appid, flags: P.flags, year: P.year, pop: P.pop, name: split(P.names), nameEs: new Map() };
  const ne = split(P.nameEs); for (let i = 0; i < P.nameEsIdx.length; i++) cat.nameEs.set(P.nameEsIdx[i], ne[i]);
  const ix = { N: head.N, T: head.T, cat, kBase: split(P.kBase), artLen: P.artLen, kEs: new Map(), tokens: split(P.tokens), fwd: P.fwd, fwdStart: P.fwdStart, post: P.post, postStart: P.postStart, fwp: P.fwp, fwpStart: P.fwpStart, byAppid: P.byAppid, sortedAppid: P.sortedAppid, aliasExact: new Map() };
  const ek = split(P.esKey); for (let i = 0; i < P.esIdx.length; i++) ix.kEs.set(P.esIdx[i], ek[i]);
  const ak = split(P.aliasK); for (let i = 0; i < ak.length; i++) { const v = ix.aliasExact.get(ak[i]); if (v) v.push(P.aliasV[i]); else ix.aliasExact.set(ak[i], [P.aliasV[i]]); }
  buildBitsets(ix, bitsetMin);
  if (haystack) buildHaystack(ix);
  return ix;
}
