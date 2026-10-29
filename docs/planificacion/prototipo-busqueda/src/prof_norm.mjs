import fs from 'node:fs';
import { parseCoreTsv } from './catalog.mjs';
import { normalize } from './search-core.mjs';
const games = parseCoreTsv(fs.readFileSync(process.argv[2] + '/core.tsv', 'utf8'));
const names = games.map(g => g.name);
const RE_NON_ASCII = /[^\x00-\x7F]/, RE_ASCII_SEP = /[^a-z0-9]+/g, RE_AP = /['`]/g;
function nA(s) {
  if (!RE_NON_ASCII.test(s)) { let t = s.toLowerCase(); if (t.indexOf("'") >= 0 || t.indexOf('`') >= 0) t = t.replace(RE_AP, ''); if (t.indexOf('&') >= 0) t = t.replace(/&/g, ' and '); return t.replace(RE_ASCII_SEP, ' ').trim(); }
  return normalize(s);
}
function nB(s) { // bucle manual
  let ascii = true; for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) { ascii = false; break; }
  if (!ascii) return normalize(s);
  let out = ''; let pendingSpace = false;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 65 && c <= 90) c += 32;
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) { if (pendingSpace && out.length) out += ' '; pendingSpace = false; out += String.fromCharCode(c); }
    else if (c === 39 || c === 96) { }
    else if (c === 38) { if (out.length) out += ' '; out += 'and'; pendingSpace = true; }
    else pendingSpace = true;
  }
  return out;
}
for (const [nm, f] of [['actual', normalize], ['regexAscii', nA], ['loop', nB], ['actual', normalize], ['regexAscii', nA], ['loop', nB]]) {
  const t = performance.now(); let x = 0; for (const s of names) x += f(s).length; console.log(nm, (performance.now() - t).toFixed(1), x);
}
let diff = 0; for (const s of names) { if (nA(s) !== normalize(s)) diff++; } console.log('diff A', diff);
let diffB = 0; const ex = []; for (const s of names) { if (nB(s) !== normalize(s)) { diffB++; if (ex.length < 3) ex.push([s, nB(s), normalize(s)]); } } console.log('diff B', diffB, ex);
const na = names.filter(s => RE_NON_ASCII.test(s)).length; console.log('non-ascii names', na, (100*na/names.length).toFixed(1)+'%');
