// CA4.6 (§15.7 de prototipe.md): CPU de la micro-API por petición. En producción, CA4.6 pide la
// mediana (≤5 ms) y que no se corte ninguna, y lo dice el panel de Workers (DECISIONES §10.60).
// Esto estima cada ruta en local, antes de desplegar, con el p99 en caliente frente a 5 ms: con la
// misma `createApp()` que el Worker, en V8 (el motor de `workerd`).
//
// - Cada ruta se llama con `app.request()` sobre la D1 de las pruebas (`node:sqlite`). En Workers,
//   el tiempo de D1 no es CPU del Worker (es otra máquina), así que se mide aparte y se resta. Lo
//   que la D1 de las pruebas hace al montar las filas en JavaScript cuenta como D1: la estimación
//   peca de optimista en eso, y de pesimista en el `crypto.subtle` de Node, que va a otro hilo.
// - «En caliente»: 300 peticiones tras 30 de calentamiento, en un mismo proceso (un *isolate* que ya
//   ha atendido otras). «Primera»: la primera de esa ruta en un proceso nuevo, tras preparar los
//   datos con otras rutas (en «crear agenda» y «resolve que pregunta», la primera petición del
//   proceso). Antes se carga lo que solo Node carga tarde (`warmNodeOnly`). La carga del módulo
//   (Zod, Hono) es el arranque del *isolate*, aparte, y también `warmUp()`, que el Worker llama al
//   arrancar (el *router* y los esquemas; DECISIONES §10.60): el arnés lo llama igual.
//
// Uso: node scripts/api-cpu.ts            (todo; ≈20 s)
//      node scripts/api-cpu.ts --first=X  (solo la primera petición de X; lo usa el modo completo)
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STEAM_IMPORT_MAX_BYTES } from '@gameagenda/core/api';
import type { D1PreparedStatement, D1Result } from '../apps/web/worker/env.ts';
import { SqliteD1 } from '../apps/web/worker/test/d1-sqlite.ts';
import {
  type Client,
  createAgenda,
  createHarness,
  type Harness,
  ORIGIN,
  T0,
} from '../apps/web/worker/test/harness.ts';
import {
  begin,
  bigLibrary,
  callback,
  chunked,
  pkce,
} from '../apps/web/worker/test/steam-support.ts';
import { addOps, hlc } from '../apps/web/worker/test/sync-support.ts';
import { warmUp } from '../apps/web/worker/warm-up.ts';

/** El presupuesto del p99 en caliente, en ms (en producción, CA4.6 pide la mediana). */
export const BUDGET_MS = 5;
const WARMUP = 30;
const RUNS = 300;
/** La biblioteca de `redeem` (ADR-012): con 5 000 juegos, ≈1,7 MB. */
const STEAM_GAMES = 5000;

/** La D1 de las pruebas, contando el tiempo que pasa dentro (no es CPU del Worker). */
class TimedD1 extends SqliteD1 {
  spent = 0;

  override async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const start = performance.now();
    try {
      return await super.batch<T>(statements);
    } finally {
      this.spent += performance.now() - start;
    }
  }

  override execute(statement: Parameters<SqliteD1['execute']>[0]): D1Result {
    const start = performance.now();
    try {
      return super.execute(statement);
    } finally {
      this.spent += performance.now() - start;
    }
  }
}

interface Scenario {
  readonly name: string;
  readonly what: string;
  /** Prepara los datos (sin medir) y devuelve la petición que se mide. */
  setup(h: Harness): Promise<() => Promise<number>>;
  /** Presupuesto del p99, en ms; por defecto, el de CA4.6. */
  readonly budgetMs?: number;
}

let appidSeq = 1_000_000;

async function paired(h: Harness): Promise<{ pc: Client; agendaId: string }> {
  const pc = h.client();
  await createAgenda(pc);
  const agendaId = (h.db.rows<{ id: string }>('SELECT id FROM agenda ORDER BY created_at DESC')[0]
    ?.id ?? '') as string;
  return { pc, agendaId };
}

/** Una agenda con `entries` juegos (4 filas de `op` cada uno), subida por lotes de 200. */
async function filled(pc: Client, entries: number): Promise<number> {
  let cursor = 0;
  for (let i = 0; i < entries; i += 50) {
    const ops = [];
    for (let j = i; j < Math.min(entries, i + 50); j++) {
      ops.push(...addOps(`steam:${appidSeq++}`, `Juego ${j} con un nombre normal`, hlc(T0 - 1000)));
    }
    const r = await pc.post('/api/v1/sync', { cursor, purgedSeq: 0, ops });
    cursor = r.json.cursor;
  }
  return cursor;
}

export const SCENARIOS: Scenario[] = [
  {
    name: 'agenda',
    what: 'Activar la sincronización (crear agenda)',
    async setup(h) {
      return async () =>
        (
          await h.client().post('/api/v1/agenda', {
            ageConfirmed: true,
            minAge: 14,
            label: 'Chrome en Windows',
          })
        ).status;
    },
  },
  {
    name: 'pairing',
    what: 'Pedir un código de emparejamiento',
    async setup(h) {
      const { pc } = await paired(h);
      return async () => (await pc.post('/api/v1/pairing')).status;
    },
  },
  {
    name: 'redeem',
    what: 'Canjear un código de emparejamiento',
    async setup(h) {
      const { pc } = await paired(h);
      return async () => {
        const { code } = (await pc.post('/api/v1/pairing')).json;
        // El código se pide fuera de la medida: se descuenta con la vuelta siguiente.
        return (await h.client().post('/api/v1/pairing/redeem', { code, label: 'iPhone' })).status;
      };
    },
  },
  {
    name: 'devices',
    what: 'Lista de 6 dispositivos',
    async setup(h) {
      const { pc } = await paired(h);
      for (let i = 0; i < 5; i++) {
        const { code } = (await pc.post('/api/v1/pairing')).json;
        await h.client().post('/api/v1/pairing/redeem', { code, label: `Dispositivo ${i}` });
      }
      return async () => (await pc.get('/api/v1/devices')).status;
    },
  },
  {
    name: 'sync-idle',
    what: '`sync` sin cambios (agenda de 1 000 juegos, al día)',
    async setup(h) {
      const { pc } = await paired(h);
      const cursor = await filled(pc, 1000);
      return async () => (await pc.post('/api/v1/sync', { cursor, purgedSeq: 0, ops: [] })).status;
    },
  },
  {
    name: 'sync-upload',
    what: '`sync` que sube un lote de 200 operaciones (50 juegos nuevos)',
    async setup(h) {
      const { pc } = await paired(h);
      let cursor = await filled(pc, 500);
      return async () => {
        const ops = [];
        for (let j = 0; j < 50; j++) {
          ops.push(...addOps(`steam:${appidSeq++}`, `Juego nuevo ${j}`, hlc(T0 - 500)));
        }
        const r = await pc.post('/api/v1/sync', { cursor, purgedSeq: 0, ops });
        cursor = r.json.cursor;
        return r.status;
      };
    },
  },
  {
    name: 'sync-download',
    what: '`sync` que baja una página de 1 000 cambios',
    async setup(h) {
      const { pc } = await paired(h);
      await filled(pc, 1000);
      return async () =>
        (await pc.post('/api/v1/sync', { cursor: 0, purgedSeq: 0, ops: [] })).status;
    },
  },
  {
    name: 'inbox',
    what: 'El Atajo de iOS deja un enlace',
    async setup(h) {
      const { pc, agendaId } = await paired(h);
      const { token } = (await pc.post('/api/v1/inbox/token', { label: 'Atajo de iOS' })).json;
      const shortcut = h.client();
      return async () => {
        h.db.rows('DELETE FROM inbox_item WHERE agenda_id = ?', agendaId);
        return (
          await shortcut.post(
            '/api/v1/inbox',
            { url: `Mira esto: https://store.steampowered.com/app/${appidSeq++}/Un_Juego/` },
            { origin: null, headers: { Authorization: `Bearer ${token}` } },
          )
        ).status;
      };
    },
  },
  {
    name: 'steam-start',
    what: 'Importar desde Steam: empezar (`start`)',
    async setup(h) {
      const { challenge } = await pkce();
      return async () => (await h.client().post('/api/v1/steam/start', { challenge })).status;
    },
  },
  {
    name: 'steam-callback',
    what: 'La vuelta de Steam (`callback`, con `check_authentication` falso, sin esperar)',
    async setup(h) {
      const pc = h.client();
      const ready = await steamTickets(h, pc, false);
      return async () => {
        const next = ready.pop();
        if (next === undefined) throw new Error('sin tickets');
        return (await callback(pc, next.ticket, h.steam.openid.assertion(next.returnTo))).status;
      };
    },
  },
  {
    name: 'steam-redeem',
    // El del encargo de la parte 2 (ADR-012): el límite gratuito de Workers.
    budgetMs: 10,
    what: `El canje (\`redeem\`) con una biblioteca de ${STEAM_GAMES.toLocaleString('es-ES')} juegos, en *streaming*`,
    async setup(h) {
      h.steam.webapi.owned = bigLibrary(STEAM_GAMES);
      const pc = h.client();
      const ready = await steamTickets(h, pc, true);
      return async () => {
        const next = ready.pop();
        if (next === undefined) throw new Error('sin tickets');
        return readAll(h, pc, '/api/v1/steam/redeem', {
          ticket: next.ticket,
          verifier: next.verifier,
        });
      };
    },
  },
  {
    name: 'resolve-hit',
    what: '`resolve` con el nombre en la caché',
    async setup(h) {
      h.steam.names.set(4000001, 'Juego Nuevo');
      await h.client().get('/api/v1/resolve/4000001');
      return async () => (await h.client().get('/api/v1/resolve/4000001')).status;
    },
  },
  {
    name: 'resolve-miss',
    what: '`resolve` que pregunta a Steam (falso, sin esperar) y guarda',
    async setup(h) {
      return async () => {
        const appid = appidSeq++;
        h.steam.names.set(appid, `Juego ${appid}`);
        return (await h.client().get(`/api/v1/resolve/${appid}`)).status;
      };
    },
  },
];

/**
 * Tickets para medir una vuelta de Steam o un canje cada vez, preparados antes (sin medir): con
 * `loggedIn`, ya con su login.
 */
async function steamTickets(h: Harness, pc: Client, loggedIn: boolean) {
  const ready = [];
  for (let i = 0; i < WARMUP + RUNS + 5; i++) {
    const started = await begin(pc);
    if (loggedIn) await callback(pc, started.ticket, h.steam.openid.assertion(started.returnTo));
    ready.push(started);
  }
  return ready;
}

/**
 * Un POST que se lee entero sin descodificarlo ni parsearlo: eso lo hace la app, no el Worker. En
 * la medida cuenta pasar los trozos por el Worker (y el Steam falso, que solo los reparte).
 */
async function readAll(h: Harness, pc: Client, path: string, body: unknown): Promise<number> {
  const response = await h.app.request(
    `${ORIGIN}${path}`,
    {
      method: 'POST',
      headers: { 'CF-Connecting-IP': pc.ip, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    h.env,
  );
  const reader = response.body?.getReader();
  let bytes = 0;
  for (;;) {
    const chunk = await reader?.read();
    if (chunk === undefined || chunk.done) break;
    bytes += chunk.value.byteLength;
  }
  if (response.status === 200 && bytes < 1_000_000) throw new Error(`biblioteca corta: ${bytes}`);
  return response.status;
}

/**
 * Referencia: lo que cuesta en Node que el Steam falso reparta la biblioteca en trozos y leerla,
 * sin el Worker en medio. En `workerd`, la red y la respuesta son *streams* nativos.
 */
async function nodeStreamsBaseline(): Promise<number> {
  const body = bigLibrary(STEAM_GAMES);
  const samples: number[] = [];
  for (let i = 0; i < WARMUP + RUNS; i++) {
    const start = performance.now();
    const reader = chunked(body).getReader();
    while (!(await reader.read()).done) {}
    if (i >= WARMUP) samples.push(performance.now() - start);
  }
  return percentile(
    samples.sort((a, b) => a - b),
    50,
  );
}

/** El arnés de las pruebas, con el tope de `redeem` de producción (16 MiB). */
export function harness(): { h: Harness; db: TimedD1 } {
  const db = new TimedD1();
  const h = createHarness({}, { db, steamImportMaxBytes: STEAM_IMPORT_MAX_BYTES });
  // Como `index.ts` al arrancar el *isolate*.
  warmUp(h.app);
  return { h, db };
}

/** CPU de una petición: lo que tarda `app.request()` menos lo que pasa dentro de D1. */
export async function measure(db: TimedD1, call: () => Promise<number>): Promise<number> {
  db.spent = 0;
  const start = performance.now();
  const status = await call();
  const total = performance.now() - start;
  if (status >= 400) throw new Error(`respuesta ${status}`);
  return total - db.spent;
}

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

/**
 * Lo que Node carga la primera vez que se usa (`Request`, `Response` y `Headers` de undici, y
 * WebCrypto), ≈23 ms medidos: en `workerd` es nativo y no cuenta como CPU de la petición.
 */
async function warmNodeOnly(): Promise<void> {
  await new Response(JSON.stringify({ a: 1 }), {
    headers: { 'Content-Type': 'application/json' },
  }).json();
  new Request('https://x.test/a', { method: 'POST', body: '{}', headers: { Cookie: 'a=b' } });
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode('x'));
}

async function first(name: string): Promise<number> {
  const scenario = SCENARIOS.find((s) => s.name === name);
  if (scenario === undefined) throw new Error(`no hay escenario ${name}`);
  await warmNodeOnly();
  const { h, db } = harness();
  const call = await scenario.setup(h);
  return measure(db, call);
}

async function main(): Promise<void> {
  const arg = process.argv.find((a) => a.startsWith('--first='));
  if (arg !== undefined) {
    process.stdout.write(String(await first(arg.slice('--first='.length))));
    return;
  }
  const self = fileURLToPath(import.meta.url);
  const rows: string[] = [];
  let worst = 0;
  let over = false;
  for (const scenario of SCENARIOS) {
    const { h, db } = harness();
    const call = await scenario.setup(h);
    for (let i = 0; i < WARMUP; i++) await measure(db, call);
    const samples: number[] = [];
    for (let i = 0; i < RUNS; i++) samples.push(await measure(db, call));
    samples.sort((a, b) => a - b);
    const cold = Number(
      execFileSync(process.execPath, [self, `--first=${scenario.name}`]).toString(),
    );
    const p50 = percentile(samples, 50);
    const p99 = percentile(samples, 99);
    const budget = scenario.budgetMs ?? BUDGET_MS;
    if (budget === BUDGET_MS) worst = Math.max(worst, p99);
    if (p99 > budget) over = true;
    rows.push(
      `| ${scenario.what} | ${p50.toFixed(2)} | ${p99.toFixed(2)} | ${(samples.at(-1) ?? 0).toFixed(2)} | ${cold.toFixed(2)} |`,
    );
  }
  console.log('| Petición | p50 (ms) | p99 (ms) | Máx. (ms) | Primera (ms) |');
  console.log('|---|---|---|---|---|');
  for (const row of rows) console.log(row);
  console.log(
    `\nPeor p99 de las demás rutas: ${worst.toFixed(2)} ms (presupuesto en caliente: ≤${BUDGET_MS} ms). Node ${process.version}.`,
  );
  const streams = await nodeStreamsBaseline();
  console.log(
    `El canje de Steam, ≤10 ms. Ojo: en él cuenta repartir y leer la biblioteca con los *streams* de Node (p50 de ${streams.toFixed(2)} ms sin pasar por el Worker), que en \`workerd\` son nativos.`,
  );
  if (over) process.exitCode = 1;
}

// Solo al ejecutarlo: `api-cpu.test.ts` importa los escenarios.
if (import.meta.main) await main();
