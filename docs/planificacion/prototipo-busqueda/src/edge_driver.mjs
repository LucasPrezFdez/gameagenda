// Ejecuta browser/bench.html en Edge headless por CDP con estrangulamiento de CPU (Emulation.setCPUThrottlingRate).
// Uso: node edge_driver.mjs <t3Dir> <edgeExe> <uFuzzy.mjs> <outJson> '<escenarios JSON>'
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';

const [root, edgeExe, ufuzzyPath, outJson, scenJson] = process.argv.slice(2);
const scenarios = JSON.parse(scenJson);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.tsv': 'text/tab-separated-values; charset=utf-8' };
const MAP = [[/^\/browser\/(bench\.html|worker\.js)$/, (m) => join(root, 'browser', m[1])], [/^\/src\/(search-core|engines|golden)\.mjs$/, (m) => join(root, 'src', m[1] + '.mjs')],
  [/^\/files\/(core\.tsv|aliases\.tsv)$/, (m) => join(root, 'out', 'files', m[1])], [/^\/vendor\/uFuzzy\.mjs$/, () => ufuzzyPath]];
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const [re, f] of MAP) { const m = re.exec(p); if (m) { try { const buf = await readFile(f(m)); res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }); return res.end(buf); } catch { break; } } }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const HTTP = server.address().port;
const CDP = 9300 + Math.floor(Math.random() * 500);
const profile = join(root, 'out', 'edge-profile');
rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true });
const edge = spawn(edgeExe, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--enable-precise-memory-info', '--js-flags=--expose-gc', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let version = null;
for (let i = 0; i < 60 && !version; i++) { try { version = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); } catch { await sleep(500); } }
if (!version) { console.error('Edge no arrancó'); edge.kill(); process.exit(1); }
console.log('browser:', version.Browser);
async function run({ engine, mode, rate, reps }) {
  const target = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  if (rate > 1) await send('Emulation.setCPUThrottlingRate', { rate });
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/browser/bench.html?engine=${engine}&mode=${mode}&reps=${reps}` });
  let result = null; const t0 = Date.now();
  while (Date.now() - t0 < 900000) {
    await sleep(1000);
    const r = await send('Runtime.evaluate', { expression: 'window.__done === true ? JSON.stringify(window.__results) : null', returnByValue: true });
    const v = r.result && r.result.result && r.result.result.value;
    if (v) { result = JSON.parse(v); break; }
  }
  ws.close();
  await fetch(`http://127.0.0.1:${CDP}/json/close/${target.id}`).catch(() => {});
  return { engine, mode, rate, reps, ...(result || { error: 'timeout' }) };
}
const results = [];
for (const s of scenarios) {
  const r = await run(s); results.push(r);
  const f = (x) => (x == null ? -1 : +(+x).toFixed(2));
  console.log(JSON.stringify({ e: s.engine, m: s.mode, x: s.rate, ready: f(r.ready_ms), build: f(r.build_ms), hay: f(r.haystack_ms), heap: f(r.heap_mb), draft: r.draft?.warm, extra: r.extra?.warm, real: r.realistic?.warm, fz: r.fuzzy_deferred, rt: r.roundtrip, inner: r.inner, idb: f(r.idb_get_ms), deser: f(r.deserialize_ms), err: r.error }));
  writeFileSync(outJson, JSON.stringify({ browser: version.Browser, results }, null, 1));
}
edge.kill(); server.close();
setTimeout(() => process.exit(0), 500);
