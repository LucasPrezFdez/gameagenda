import { parseCore, buildIndex, createSearcher } from '/src/search-core.mjs';
let S = null, ix = null;
self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    const t0 = performance.now();
    const [coreText, aliasText] = await Promise.all([fetch('/files/core.tsv').then((r) => r.text()), fetch('/files/aliases.tsv').then((r) => r.text())]);
    const t1 = performance.now();
    const cat = parseCore(coreText);
    const aliases = aliasText.split('\n').filter((l) => l && l[0] !== '#').map((l) => { const i = l.indexOf('\t'); return [l.slice(0, i), +l.slice(i + 1)]; });
    ix = buildIndex(cat, aliases);
    S = createSearcher(ix);
    self.postMessage({ type: 'ready', fetch_ms: t1 - t0, build_ms: performance.now() - t1 });
  } else if (m.type === 'reset') { S.reset(); }
  else if (m.type === 'q') {
    const t0 = performance.now();
    const r = S.query(m.q, { limit: 8 });
    const items = r.ids.map((g, i) => [ix.cat.appid[g], ix.cat.name[g], r.tiers[i]]);
    self.postMessage({ type: 'results', seq: m.seq, items, ms: performance.now() - t0 });
  }
};
