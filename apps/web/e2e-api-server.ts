// La micro-API real en la vista previa de los E2E (solo `vite preview --mode e2e`; lo monta
// `e2e-api-plugin.ts`). Cada petición a `/api/*` pasa de Node a un `Request` y llega a la misma
// `createApp()` que el Worker de producción, con una D1 sobre `node:sqlite` (la de las pruebas de
// `worker/test/`) nueva en cada arranque, sin límites por IP y con `SYNC_ENABLED` a `'1'`.
//
// Mundos: las pruebas corren en paralelo contra la misma vista previa, así que cada una lleva su
// propia D1 y su propio reloj con la *cookie* `ga-e2e-api` (la pone el `test` de
// `e2e/sync-server.ts`, con `joinWorld()`; los contextos con el mismo valor comparten agenda).
// Sin ella, el mundo `default`. La *cookie* no llega a la micro-API: en producción no existe. Así
// el mantenimiento o el reloj de una prueba no tocan las agendas de otra.
//
// Rutas de apoyo, solo aquí y nunca en el Worker (`worker/index.ts` no las conoce), todas del
// mundo de la petición y con JSON:
// - `GET /__e2e/state`: `{ world, now, offsetMs, syncEnabled, minAge }`.
// - `POST /__e2e/clock` con `{ advanceMs }` o `{ offsetMs }`: mueve el reloj de la micro-API.
// - `POST /__e2e/config` con `{ syncEnabled?, minAge? }`: el interruptor y la edad (`SYNC_ENABLED`
//   y `MIN_AGE`), para el 503 `sync_disabled` y el 409 `age_policy_changed`.
// - `POST /__e2e/maintenance` con `{ afterDays?, at?, monday? }`: el mantenimiento diario
//   (`worker/maintenance.ts`) en el primer lunes a las 03:17 UTC desde `at` (o desde ahora más
//   `afterDays` días); con `monday: false`, en ese instante tal cual. No mueve el reloj.
// - `GET /__e2e/agenda?device=<id>` o `?agenda=<id>` (y `&entries=1`): la agenda del dispositivo,
//   su `seq` y `purged_seq`, cuántas filas tiene en cada tabla y, con `entries=1`, sus entradas
//   tal como las reconstruye el servidor. Por `agenda`, para comprobar que «Borrar todos mis
//   datos» la ha vaciado (CA4.7): tras borrarla, el dispositivo ya no existe.
// - `POST /__e2e/snapshot` y `POST /__e2e/restore`: una copia de la D1 del mundo y su vuelta atrás,
//   como un restore con Time Travel (lo escrito después de la copia desaparece). Con
//   `{ newEpoch: false }`, sin el paso del *runbook* que cambia la época
//   (`UPDATE agenda SET epoch = lower(hex(randomblob(8)))`).
// - `POST /__e2e/hold` con `{ pattern, mode? }`: la siguiente petición a la micro-API cuya ruta
//   case con la expresión `pattern` espera, antes de llegar a ella, hasta `POST /__e2e/release`
//   (`mode: 'hold'`); con `mode: 'fail'`, todas cortan la conexión (como sin servidor) hasta
//   entonces. `GET /__e2e/hold` dice si hay una retenida (`waiting`). Sirve en los dos motores:
//   el `page.route()` de Playwright no ve las peticiones de una página con Service Worker en WebKit.
// - `POST /__e2e/steam` con `{ names: { "<appid>": "<nombre>" } }`: el Steam falso de `resolve`
//   (`GetItems`). Los E2E nunca llaman al de verdad: sin nombre, Steam «no lo conoce». Es uno para
//   todos los mundos, como Steam, porque la app pide `resolve` sin cookies (tampoco la del mundo):
//   cada prueba usa sus propios `appid`. `GET /__e2e/steam?appid=<n>` dice cuántas veces se ha
//   preguntado por ese `appid`.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SQLInputValue } from 'node:sqlite';
import type { TLSSocket } from 'node:tls';
import { DEFAULT_MIN_AGE } from '@gameagenda/core/api';
import type { Entry } from '@gameagenda/core/entries';
import { E2E_API_COOKIE, E2E_ROUTES_PREFIX } from './e2e-api-plugin.ts';
import { createApp } from './worker/app.ts';
import type { Env, RateLimit, SteamFetch } from './worker/env.ts';
import { runMaintenance } from './worker/maintenance.ts';
import { counterOpIds, entriesFromRows, type OpRow } from './worker/sync-plan.ts';
import { SqliteD1 } from './worker/test/d1-sqlite.ts';

const API_PREFIX = '/api/';
const DEFAULT_WORLD = 'default';
const RE_WORLD = /^[A-Za-z0-9_-]{1,64}$/;
const DAY_MS = 86_400_000;
/** Tope de lo que se lee aquí: la micro-API aplica después el suyo (1 KiB, o 1 MiB en `sync`). */
const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** Cabeceras que no pasan de Node al `Request`: las de la conexión y las seudocabeceras de h2. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'http2-settings',
  'host',
]);

const unlimited: RateLimit = { limit: async () => ({ success: true }) };

interface World {
  readonly id: string;
  readonly db: SqliteD1;
  readonly env: Env;
  readonly app: ReturnType<typeof createApp>;
  offsetMs: number;
  /** La copia de `POST /__e2e/snapshot`: las filas de cada tabla. */
  snapshot: Map<string, Record<string, SQLInputValue>[]> | null;
  /** La retención de `POST /__e2e/hold`, hasta que una petición case (o hasta `release`). */
  hold: Hold | null;
  /** La petición retenida ahora mismo, si la hay. */
  held: Hold | null;
}

interface Hold {
  readonly pattern: RegExp;
  readonly mode: 'hold' | 'fail';
  readonly released: Promise<void>;
  readonly release: () => void;
}

function newHold(pattern: RegExp, mode: 'hold' | 'fail'): Hold {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { pattern, mode, released, release: () => release() };
}

const worlds = new Map<string, World>();

/** El Steam falso de `resolve`, uno para todos los mundos (`POST /__e2e/steam`). */
const steam = { names: new Map<number, string>(), calls: new Map<number, number>() };

/** `GetItems` falso: lo que haya en `steam.names`; si no, «no lo conoce» (`success` 15). */
const fakeSteam: SteamFetch = async (url) => {
  const input = JSON.parse(new URL(url).searchParams.get('input_json') ?? '{}') as {
    ids?: Array<{ appid?: number }>;
  };
  const appid = input.ids?.[0]?.appid ?? 0;
  steam.calls.set(appid, (steam.calls.get(appid) ?? 0) + 1);
  const name = steam.names.get(appid);
  const item =
    name === undefined
      ? { id: appid, success: 15, visible: false, name: '', appid: 0 }
      : { id: appid, success: 1, visible: true, name, appid, type: 0 };
  return Response.json({ response: { store_items: [item] } });
};

function world(id: string): World {
  const existing = worlds.get(id);
  if (existing) return existing;
  const db = new SqliteD1();
  const created: World = {
    id,
    db,
    env: {
      DB: db,
      // Con `run_worker_first: ["/api/*"]` no se usa; si llegara algo, como un fichero que falta.
      ASSETS: { fetch: async () => new Response('No encontrado', { status: 404 }) },
      RL_AGENDA: unlimited,
      RL_REDEEM: unlimited,
      RL_INBOX: unlimited,
      RL_RESOLVE: unlimited,
      SYNC_ENABLED: '1',
      MIN_AGE: String(DEFAULT_MIN_AGE),
    },
    app: createApp({ now: () => Date.now() + created.offsetMs, steamFetch: fakeSteam }),
    offsetMs: 0,
    snapshot: null,
    hold: null,
    held: null,
  };
  worlds.set(id, created);
  return created;
}

/** El mundo de la *cookie* `ga-e2e-api` y la cabecera `Cookie` sin ella. */
export function splitWorldCookie(header: string | undefined): {
  world: string;
  cookie: string | null;
} {
  let id = DEFAULT_WORLD;
  const rest: string[] = [];
  for (const part of (header ?? '').split(';')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const eq = trimmed.indexOf('=');
    const name = eq < 0 ? trimmed : trimmed.slice(0, eq);
    const value = eq < 0 ? '' : trimmed.slice(eq + 1);
    if (name === E2E_API_COOKIE) {
      if (RE_WORLD.test(value)) id = value;
    } else {
      rest.push(trimmed);
    }
  }
  return { world: id, cookie: rest.length > 0 ? rest.join('; ') : null };
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new Error('Cuerpo demasiado grande para la vista previa');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function originOf(req: IncomingMessage): string {
  const secure = (req.socket as TLSSocket).encrypted === true;
  const authority = req.headers[':authority'] ?? req.headers.host ?? '127.0.0.1';
  return `${secure ? 'https' : 'http'}://${String(authority)}`;
}

/** La petición de Node como la recibiría el Worker: con `CF-Connecting-IP` del *socket*. */
export async function toRequest(req: IncomingMessage, cookie: string | null): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || name.startsWith(':') || HOP_BY_HOP.has(name)) continue;
    if (name === 'cookie' || name === 'cf-connecting-ip') continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  if (cookie !== null) headers.set('Cookie', cookie);
  // Como Cloudflare: la IP es la del cliente, nunca la que diga la petición.
  headers.set('CF-Connecting-IP', req.socket.remoteAddress ?? '127.0.0.1');
  const method = req.method ?? 'GET';
  const init: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') init.body = new Uint8Array(await readBody(req));
  return new Request(new URL(req.url ?? '/', originOf(req)), init);
}

/** Escribe la `Response` tal cual: estado, cabeceras, cada `Set-Cookie` por separado y cuerpo. */
export async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  // Fuera lo que hayan puesto los *middlewares* de Vite (CORS): el Worker no lo envía.
  for (const name of res.getHeaderNames()) res.removeHeader(name);
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader('Set-Cookie', cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  for (const name of res.getHeaderNames()) res.removeHeader(name);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const text = (await readBody(req)).toString('utf8');
  if (text.trim() === '') return {};
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('El cuerpo tiene que ser un objeto JSON');
  }
  return parsed as Record<string, unknown>;
}

function finiteNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} tiene que ser un número`);
  }
  return value;
}

/** El primer lunes a las 03:17 UTC (la hora del Cron Trigger) en `ms` o después. */
export function nextMondayRun(ms: number): number {
  const d = new Date(ms);
  const run = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3, 17);
  const daysToMonday = (8 - new Date(run).getUTCDay()) % 7;
  const candidate = run + daysToMonday * DAY_MS;
  return candidate >= ms ? candidate : candidate + 7 * DAY_MS;
}

/** Respuesta de `GET /__e2e/state` (y de `clock` y `config`). */
export interface E2eState {
  world: string;
  /** La hora de la micro-API de este mundo, en ISO 8601. */
  now: string;
  offsetMs: number;
  syncEnabled: boolean;
  minAge: number;
}

/** Respuesta de `GET /__e2e/agenda`. */
export interface E2eAgendaReport {
  agendaId: string;
  /** `false` si ya no está (borrada con «Borrar todos mis datos» o por los 13 meses). */
  exists: boolean;
  seq: number | null;
  purgedSeq: number | null;
  /** La época de la agenda (`agenda.epoch`, migración 0002), que cambia con un restore. */
  epoch: string | null;
  /** Filas de cada tabla con el `agenda_id` de esta agenda. */
  rows: { device: number; op: number; pairingToken: number; inboxItem: number };
  /** Con `entries=1`: las entradas que reconstruye el servidor con sus filas de `op`, por id. */
  entries?: Entry[];
}

function state(w: World): E2eState {
  return {
    world: w.id,
    now: new Date(Date.now() + w.offsetMs).toISOString(),
    offsetMs: w.offsetMs,
    syncEnabled: w.env.SYNC_ENABLED === '1',
    minAge: Number(w.env.MIN_AGE),
  };
}

function count(w: World, table: string, agendaId: string): number {
  const [row] = w.db.rows<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE agenda_id = ?`,
    agendaId,
  );
  return row?.n ?? 0;
}

function agendaReport(w: World, params: URLSearchParams): E2eAgendaReport | null {
  const device = params.get('device');
  let agendaId = params.get('agenda');
  if (device !== null) {
    const [row] = w.db.rows<{ agenda_id: string }>(
      'SELECT agenda_id FROM device WHERE id = ?',
      device,
    );
    agendaId = row?.agenda_id ?? null;
  }
  if (agendaId === null) return null;
  const [agenda] = w.db.rows<{ seq: number; purged_seq: number; epoch: string }>(
    'SELECT seq, purged_seq, epoch FROM agenda WHERE id = ?',
    agendaId,
  );
  const report: E2eAgendaReport = {
    agendaId,
    exists: agenda !== undefined,
    seq: agenda?.seq ?? null,
    purgedSeq: agenda?.purged_seq ?? null,
    epoch: agenda?.epoch ?? null,
    rows: {
      device: count(w, 'device', agendaId),
      op: count(w, 'op', agendaId),
      pairingToken: count(w, 'pairing_token', agendaId),
      inboxItem: count(w, 'inbox_item', agendaId),
    },
  };
  if (params.get('entries') === '1') {
    const rows = w.db.rows<OpRow>(
      'SELECT entry_id, field, value, hlc FROM op WHERE agenda_id = ?',
      agendaId,
    );
    report.entries = [...entriesFromRows(rows, counterOpIds()).values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
  }
  return report;
}

/** Las tablas de la D1, de padres a hijas (así se insertan; se borran al revés). */
const SNAPSHOT_TABLES = ['agenda', 'device', 'pairing_token', 'op', 'inbox_item', 'resolve_cache'];

function takeSnapshot(w: World): void {
  w.snapshot = new Map(
    SNAPSHOT_TABLES.map((table) => [
      table,
      w.db.rows<Record<string, SQLInputValue>>(`SELECT * FROM ${table}`),
    ]),
  );
}

/** Vuelve a la copia, como Time Travel: lo escrito después desaparece; los dispositivos, no. */
function restoreSnapshot(w: World, newEpoch: boolean): void {
  const snapshot = w.snapshot;
  if (snapshot === null) throw new TypeError('Antes de restore hace falta un snapshot');
  const { sqlite } = w.db;
  sqlite.exec('BEGIN');
  try {
    for (const table of [...SNAPSHOT_TABLES].reverse()) sqlite.exec(`DELETE FROM ${table}`);
    for (const table of SNAPSHOT_TABLES) {
      for (const row of snapshot.get(table) ?? []) {
        const columns = Object.keys(row);
        const marks = columns.map(() => '?').join(', ');
        sqlite
          .prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${marks})`)
          .run(...columns.map((c) => row[c] ?? null));
      }
    }
    if (newEpoch) sqlite.exec('UPDATE agenda SET epoch = lower(hex(randomblob(8)))');
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}

async function e2eRoute(req: IncomingMessage, res: ServerResponse, w: World): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const route = `${req.method ?? 'GET'} ${url.pathname}`;
  switch (route) {
    case 'GET /__e2e/state':
      return sendJson(res, 200, state(w));
    case 'POST /__e2e/clock': {
      const body = await readJson(req);
      const advance = finiteNumber(body.advanceMs, 'advanceMs');
      const offset = finiteNumber(body.offsetMs, 'offsetMs');
      if (offset !== undefined) w.offsetMs = offset;
      if (advance !== undefined) w.offsetMs += advance;
      return sendJson(res, 200, state(w));
    }
    case 'POST /__e2e/config': {
      const body = await readJson(req);
      if (body.syncEnabled !== undefined) {
        if (typeof body.syncEnabled !== 'boolean') throw new TypeError('syncEnabled: booleano');
        w.env.SYNC_ENABLED = body.syncEnabled ? '1' : '0';
      }
      const minAge = finiteNumber(body.minAge, 'minAge');
      if (minAge !== undefined) w.env.MIN_AGE = String(minAge);
      return sendJson(res, 200, state(w));
    }
    case 'POST /__e2e/maintenance': {
      const body = await readJson(req);
      const afterDays = finiteNumber(body.afterDays, 'afterDays') ?? 0;
      let base = Date.now() + w.offsetMs + afterDays * DAY_MS;
      if (body.at !== undefined) {
        const at = typeof body.at === 'string' ? Date.parse(body.at) : Number.NaN;
        if (Number.isNaN(at)) throw new TypeError('at: instante ISO 8601');
        base = at;
      }
      const ranAt = body.monday === false ? base : nextMondayRun(base);
      await runMaintenance(w.db, ranAt);
      return sendJson(res, 200, { ranAt: new Date(ranAt).toISOString() });
    }
    case 'POST /__e2e/hold': {
      const body = await readJson(req);
      if (typeof body.pattern !== 'string') throw new TypeError('pattern: expresión regular');
      const mode = body.mode ?? 'hold';
      if (mode !== 'hold' && mode !== 'fail') throw new TypeError("mode: 'hold' o 'fail'");
      w.hold?.release();
      w.hold = newHold(new RegExp(body.pattern), mode);
      return sendJson(res, 200, { ok: true });
    }
    case 'GET /__e2e/hold':
      return sendJson(res, 200, { armed: w.hold !== null, waiting: w.held !== null });
    case 'POST /__e2e/release':
      w.hold?.release();
      w.held?.release();
      w.hold = null;
      return sendJson(res, 200, { ok: true });
    case 'POST /__e2e/snapshot':
      takeSnapshot(w);
      return sendJson(res, 200, { ok: true });
    case 'POST /__e2e/restore': {
      const body = await readJson(req);
      if (body.newEpoch !== undefined && typeof body.newEpoch !== 'boolean') {
        throw new TypeError('newEpoch: booleano');
      }
      restoreSnapshot(w, body.newEpoch !== false);
      return sendJson(res, 200, { ok: true });
    }
    case 'POST /__e2e/steam': {
      const body = await readJson(req);
      const names = body.names ?? {};
      if (typeof names !== 'object' || names === null) throw new TypeError('names: objeto');
      for (const [appid, name] of Object.entries(names)) {
        if (!/^[1-9][0-9]*$/.test(appid) || typeof name !== 'string') {
          throw new TypeError('names: { "<appid>": "<nombre>" }');
        }
        steam.names.set(Number(appid), name);
      }
      return sendJson(res, 200, { ok: true });
    }
    case 'GET /__e2e/steam':
      return sendJson(res, 200, {
        calls: steam.calls.get(Number(url.searchParams.get('appid'))) ?? 0,
      });
    case 'GET /__e2e/agenda': {
      const report = agendaReport(w, url.searchParams);
      return report === null
        ? sendJson(res, 404, { error: 'Ni el dispositivo ni la agenda existen' })
        : sendJson(res, 200, report);
    }
    default:
      return sendJson(res, 404, { error: `No hay ruta de apoyo para ${route}` });
  }
}

type Next = (error?: unknown) => void;

/** El *middleware* de Connect: `/api/*` a la micro-API, `/__e2e/*` a las rutas de apoyo. */
export function e2eApiMiddleware(): (
  req: IncomingMessage,
  res: ServerResponse,
  next: Next,
) => void {
  return (req, res, next) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const isApi = path.startsWith(API_PREFIX);
    if (!isApi && !path.startsWith(E2E_ROUTES_PREFIX)) return next();
    const { world: id, cookie } = splitWorldCookie(req.headers.cookie);
    const w = world(id);
    const hold = isApi && w.hold?.pattern.test(path) === true ? w.hold : null;
    if (hold?.mode === 'fail') {
      res.destroy();
      return;
    }
    if (hold !== null) {
      w.hold = null;
      w.held = hold;
    }
    const handle = isApi
      ? (hold?.released ?? Promise.resolve())
          .then(() => {
            if (w.held === hold) w.held = null;
            return toRequest(req, cookie);
          })
          .then((request) => w.app.fetch(request, w.env))
          .then((response) => writeResponse(res, response))
      : e2eRoute(req, res, w);
    handle.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, isApi ? 500 : 400, { error: message });
    });
  };
}
