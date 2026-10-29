import fs from 'node:fs';
import { parseAliasesTsv } from './catalog.mjs';
import { parseCore, buildIndex, normalize } from './search-core.mjs';
const text = fs.readFileSync(process.argv[2] + '/core.tsv', 'utf8');
const aliases = parseAliasesTsv(fs.readFileSync(process.argv[2] + '/aliases.tsv', 'utf8'));
for (let i = 0; i < 3; i++) {
  let t = performance.now(); const cat = parseCore(text); const tp = performance.now() - t;
  t = performance.now(); let x = 0; for (const s of cat.name) x += normalize(s).length; const tn = performance.now() - t;
  t = performance.now(); buildIndex(cat, aliases, { haystack: false }); const tb = performance.now() - t;
  console.log('parse', tp.toFixed(0), 'normalize', tn.toFixed(0), 'build', tb.toFixed(0));
}
