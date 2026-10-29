// Deriva un TSV compacto del catálogo a partir de las páginas de Query (solo se parsean como JSON).
// Uso: node derive_tsv.mjs <dirPaginas> <games_appid.json (GetAppList)> <salida.tsv> <stats.json>
import fs from 'node:fs';
import path from 'node:path';

const [dir, appListPath, outTsv, outStats] = process.argv.slice(2);
const base = new Map();
const al = JSON.parse(fs.readFileSync(appListPath, 'utf8'));
const apps = Array.isArray(al) ? al : (al.applist?.apps || al.apps || al.response?.apps || Object.values(al)[0]);
for (const a of apps) if (a && Number.isInteger(a.appid)) base.set(a.appid, typeof a.name === 'string' ? a.name : '');
const files = fs.readdirSync(dir).filter((f) => f.startsWith('page_')).sort();
const items = new Map();
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const it of j.response?.store_items || []) if (Number.isInteger(it.appid) && !items.has(it.appid)) items.set(it.appid, it);
}
const clean = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ').trim();
const rows = [];
let nameEsDiff = 0, notInAppList = 0, emptyName = 0;
const st = { query_unique: items.size, applist: base.size };
for (const [appid, it] of items) {
  const qn = clean(it.name);
  let b = base.has(appid) ? clean(base.get(appid)) : null;
  if (b === null) notInAppList++;
  if (!b) b = qn;
  if (!b) { emptyName++; continue; }
  const nameEs = qn && qn !== b ? qn : '';
  if (nameEs) nameEsDiff++;
  const r = it.release || {};
  const soon = !!(it.is_coming_soon || r.is_coming_soon);
  const early = !!(it.is_early_access || r.is_early_access);
  const d = it.content_descriptorids || [];
  const adult = d.includes(3) || d.includes(4);
  const free = !!it.is_free;
  const ts = r.steam_release_date || r.original_release_date || 0;
  const tba = soon && (r.coming_soon_display === 'text_tba' || r.coming_soon_display === 'text_comingsoon' || !ts);
  const year = ts && !tba ? new Date(ts * 1000).getUTCFullYear() : '';
  const rc = it.reviews?.summary_filtered?.review_count ?? 0;
  rows.push([appid, b, nameEs, it.type ?? '', soon ? 1 : 0, early ? 1 : 0, adult ? 1 : 0, free ? 1 : 0, tba ? 1 : 0, year, rc]);
}
const inAppListNotQuery = [...base.keys()].filter((a) => !items.has(a)).length;
rows.sort((a, b) => a[0] - b[0]);
const head = '#appid\tname\tnameEs\ttype\tcoming_soon\tearly_access\tadult\tfree\ttba\tyear\treview_count';
fs.writeFileSync(outTsv, head + '\n' + rows.map((r) => r.join('\t')).join('\n') + '\n');
Object.assign(st, { rows: rows.length, nameEsDiff, notInAppList, inAppListNotQuery, emptyName,
  soon: rows.filter((r) => r[4]).length, early: rows.filter((r) => r[5]).length, adult: rows.filter((r) => r[6]).length, free: rows.filter((r) => r[7]).length, tba: rows.filter((r) => r[8]).length,
  withReviews: rows.filter((r) => r[10] > 0).length, maxReviews: rows.reduce((m, r) => Math.max(m, r[10]), 0) });
fs.writeFileSync(outStats, JSON.stringify(st, null, 1));
console.log(JSON.stringify(st));
