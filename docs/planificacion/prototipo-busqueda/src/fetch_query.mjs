// Descarga el catálogo de juegos con IStoreQueryService/Query (sin clave).
// Un solo hilo, >=3 s entre inicios de petición, Accept-Encoding: gzip.
// Guarda cada página (JSON descomprimido) en <dataDir>/page_<start>.json y un log NDJSON.
// Uso: node fetch_query.mjs <dataDir>
import https from 'node:https';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = process.argv[2];
if (!dataDir) { console.error('falta dataDir'); process.exit(2); }
fs.mkdirSync(dataDir, { recursive: true });
const logPath = path.join(dataDir, 'fetch_log.ndjson');
const MIN_GAP_MS = 3000;
const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });

function buildUrl(start) {
  const input = {
    query: { start, count: 1000, sort: 2, filters: { type_filters: { include_games: true } } },
    context: { language: 'spanish', country_code: 'ES' },
    data_request: { include_basic_info: true, include_release: true, include_reviews: true },
  };
  return 'https://api.steampowered.com/IStoreQueryService/Query/v1/?input_json=' + encodeURIComponent(JSON.stringify(input));
}

function get(url) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const req = https.get(url, { agent, headers: { 'Accept-Encoding': 'gzip', 'User-Agent': 'GameAgenda-bench/0.1', 'Accept': 'application/json' }, timeout: 60000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const wire = Buffer.concat(chunks);
        let body = wire;
        const enc = res.headers['content-encoding'] || '';
        try { if (enc.includes('gzip')) body = zlib.gunzipSync(wire); } catch (e) { resolve({ status: -2, error: 'gunzip ' + e.message, ms: performance.now() - t0 }); return; }
        resolve({ status: res.statusCode, enc, wireBytes: wire.length, rawBytes: body.length, body, ms: performance.now() - t0, retryAfter: res.headers['retry-after'] });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => resolve({ status: -1, error: e.message, ms: performance.now() - t0 }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastStart = 0;
async function paced(url) {
  const wait = lastStart + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastStart = Date.now();
  return get(url);
}

const tAll = Date.now();
let total = null;
let start = 0;
let consecutive429 = 0;
let pages = 0, fails = 0;
while (true) {
  const file = path.join(dataDir, `page_${String(start).padStart(6, '0')}.json`);
  if (fs.existsSync(file) && total !== null) {
    start += 950; if (start >= total) break; continue;
  }
  let r = null, attempt = 0;
  while (true) {
    r = await paced(buildUrl(start));
    const entry = { start, status: r.status, wireBytes: r.wireBytes, rawBytes: r.rawBytes, enc: r.enc, ms: Math.round(r.ms), t: new Date().toISOString(), error: r.error };
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
    if (r.status === 200) { consecutive429 = 0; break; }
    if (r.status === 429) {
      consecutive429++;
      if (consecutive429 >= 2) { fs.appendFileSync(logPath, JSON.stringify({ stop: 'two consecutive 429', start }) + '\n'); console.log('STOP 429x2 at', start); process.exit(3); }
      await sleep(30000 + Math.random() * 5000); continue;
    }
    attempt++; fails++;
    if (attempt >= 4) { fs.appendFileSync(logPath, JSON.stringify({ stop: 'too many failures', start }) + '\n'); console.log('STOP failures at', start); process.exit(4); }
    await sleep(2000 * 2 ** attempt + Math.random() * 1000);
  }
  let json;
  try { json = JSON.parse(r.body.toString('utf8')); } catch (e) { console.log('bad json at', start); process.exit(5); }
  const resp = json.response || {};
  const meta = resp.metadata || {};
  if (total === null) total = meta.total_matching_records;
  fs.writeFileSync(file, r.body);
  pages++;
  const n = (resp.store_items || []).length;
  if (pages % 10 === 1) console.log(`page start=${start} items=${n} total=${meta.total_matching_records} wire=${r.wireBytes} raw=${r.rawBytes} ms=${Math.round(r.ms)}`);
  if (n === 0) break;
  start += 950;
  if (start >= (meta.total_matching_records ?? total)) break;
}
const secs = (Date.now() - tAll) / 1000;
fs.appendFileSync(logPath, JSON.stringify({ done: true, pages, fails, total, seconds: secs }) + '\n');
console.log('DONE pages', pages, 'total', total, 'secs', secs);
