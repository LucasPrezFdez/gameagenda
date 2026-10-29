// `npm run fixtures:record -- --appids=730,570,…` (§12.2 y §13.5): graba en `fixtures/steam/`
// las respuestas reales que pide `catalog:build -- --source=fixtures`, con y sin clave, para
// esos juegos: dos páginas de Query (perfil de *fixtures*) y los lotes de `GetItems` (huecos en
// ES y US y nombres base en inglés). Cada fichero guarda URL, estado, fecha y cuerpo, nunca
// cabeceras; si alguno contiene la clave (o algo con su forma), falla.
//
// Graba sin clave. `GetAppList` exige clave, así que su respuesta es sintética: los juegos
// pedidos que GetAppList listaría (ni retirados ni inexistentes) con su nombre en inglés de
// `GetItems`, más los de las páginas de Query. Los retirados y los inexistentes van al estado
// de partida (`state/master.ndjson`), para que la construcción los clasifique como H2.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { realRuntime } from './src/clock.ts';
import { cleanName, type StateRow } from './src/derive.ts';
import { filesWithKey, fixtureName } from './src/fixtures.ts';
import { getItems } from './src/get-items.ts';
import { queryPass } from './src/query-pass.ts';
import { collectInputs, FIXTURES_PROFILE } from './src/run.ts';
import { serializeState } from './src/state.ts';
import { SteamClient, type Transport, type TransportResponse } from './steam/client.ts';
import { appListUrl, endpointOf } from './steam/endpoints.ts';
import { type FixtureRecord, fixtureTransport, httpsTransport } from './steam/transports.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const { values: args } = parseArgs({
  options: {
    appids: { type: 'string' },
    out: { type: 'string', default: join(ROOT, 'fixtures/steam') },
  },
  strict: true,
});

/** Transporte que graba cada 200 y sirve de memoria lo ya grabado (no repite peticiones). */
function recording(inner: Transport, store: Map<string, FixtureRecord>): Transport {
  return async (req) => {
    const done = store.get(req.url);
    if (done) {
      return { status: 200, header: () => null, body: JSON.stringify(done.json), wireBytes: 0 };
    }
    const res: TransportResponse = await inner(req);
    if (res.status === 200) {
      store.set(req.url, {
        url: req.url,
        status: res.status,
        date: new Date().toISOString(),
        json: JSON.parse(res.body) as unknown,
      });
    }
    return res;
  };
}

async function main(): Promise<void> {
  const appids = (args.appids ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (appids.length === 0 || appids.length > 200) {
    throw new Error('Uso: npm run fixtures:record -- --appids=730,570,… (de 1 a 200)');
  }
  const out = args.out;
  const log = (l: string): void => console.log(l);
  const store = new Map<string, FixtureRecord>();
  const live = recording(httpsTransport(), store);
  const client = (t: Transport): SteamClient =>
    new SteamClient({ transport: t, ...realRuntime, key: null, log });

  // 1. Las dos páginas de Query del perfil de fixtures.
  const c1 = client(live);
  const q = await queryPass(c1, {
    pageSize: FIXTURES_PROFILE.pageSize,
    overlap: FIXTURES_PROFILE.overlap,
    maxPages: FIXTURES_PROFILE.maxPages ?? 2,
  });
  // 2. Nombres en inglés (US: también los bloqueados en ES) para la lista sintética.
  const names = await getItems(c1, appids, { language: 'english', country: 'US' });
  const now = new Date().toISOString();
  const listed: Array<{ appid: number; name: string }> = [];
  const seed: StateRow[] = [];
  for (const appid of appids) {
    const it = names.get(appid);
    const name = cleanName(it?.name);
    const deleted = !it || (it.success === 15 && !it.appid && !name);
    if (deleted || it.unlisted) {
      seed.push({
        appid,
        name: name || `Juego ${appid}`,
        cls: 'visible',
        flags: 0,
        year: 0,
        reviews: 0,
        enrichedOn: now.slice(0, 10),
      });
    } else listed.push({ appid, name });
  }
  for (const [appid, it] of q.items) {
    if (it.type === 0 && !listed.some((l) => l.appid === appid)) {
      listed.push({ appid, name: cleanName(it.name) });
    }
  }
  listed.sort((a, b) => a.appid - b.appid);
  const size = FIXTURES_PROFILE.listPageSize;
  const synthetic: FixtureRecord[] = [];
  for (let i = 0, last = 0; i < listed.length; i += size) {
    const page = listed.slice(i, i + size);
    const more = i + size < listed.length;
    synthetic.push({
      url: appListUrl(last, size),
      status: 200,
      date: now,
      synthetic: 'GetAppList exige clave: lista generada con los nombres de GetItems en inglés',
      json: {
        response: {
          apps: page,
          ...(more ? { have_more_results: true, last_appid: page[page.length - 1]?.appid } : {}),
        },
      },
    });
    last = page[page.length - 1]?.appid ?? last;
  }
  const state = new Map(seed.map((r) => [r.appid, r]));

  // 3. Las etapas 1–3 con clave (lista sintética) y sin clave, grabando lo que pidan.
  const synth = fixtureTransport(synthetic);
  const mixed: Transport = (req) => (endpointOf(req.url) === 'getapplist' ? synth(req) : live(req));
  for (const keyless of [false, true]) {
    await collectInputs(client(mixed), {
      keyless,
      profile: FIXTURES_PROFILE,
      state,
      dump: null,
      now: realRuntime.now,
      log,
    });
  }

  // 4. Escribir: las grabaciones sustituyen a las anteriores; los sintéticos de las pruebas,
  //    en `synthetic/`, no se tocan.
  for (const dir of ['query', 'getitems', 'getapplist', 'state']) {
    rmSync(join(out, dir), { recursive: true, force: true });
    mkdirSync(join(out, dir), { recursive: true });
  }
  for (const rec of [...store.values(), ...synthetic]) {
    const dir = endpointOf(rec.url);
    writeFileSync(
      join(out, dir, `${fixtureName(rec.url)}.json`),
      `${JSON.stringify(rec, null, 1)}\n`,
    );
  }
  writeFileSync(join(out, 'state/master.ndjson'), serializeState(seed));
  const leaked = filesWithKey(out, process.env.STEAM_WEB_API_KEY?.trim() || null);
  if (leaked.length > 0) {
    for (const f of leaked) rmSync(f);
    throw new Error(`Ficheros con la clave (borrados): ${leaked.join(', ')}`);
  }
  log(`✓ ${store.size} respuestas grabadas y ${synthetic.length} sintéticas en ${out}`);
}

main().catch((e: unknown) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exitCode = 1;
});
