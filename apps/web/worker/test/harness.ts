// Arnés de las pruebas de la micro-API (§12: rutas con `app.request()` de Hono): D1 sobre
// `node:sqlite`, reloj inyectado, límites que cuentan de verdad y clientes con su tarro de cookies,
// que mandan `Origin` y `Content-Type` como lo haría la app.

import { DEFAULT_MIN_AGE } from '@gameagenda/core/api';
import { createApp } from '../app.ts';
import type { Env, RateLimit, SteamFetch } from '../env.ts';
import { SqliteD1 } from './d1-sqlite.ts';

export const ORIGIN = 'https://ga-web.test';
/** 06-11-2026 12:00 UTC. */
export const T0 = Date.UTC(2026, 10, 6, 12);

/** Límite falso: `max` peticiones por clave; guarda las claves que ha visto. */
export class CountingLimit implements RateLimit {
  readonly counts = new Map<string, number>();
  max: number;

  constructor(max = Number.POSITIVE_INFINITY) {
    this.max = max;
  }

  async limit({ key }: { key: string }): Promise<{ success: boolean }> {
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return { success: n <= this.max };
  }
}

export interface ApiResponse {
  status: number;
  // biome-ignore lint/suspicious/noExplicitAny: las pruebas miran el JSON tal cual llega.
  json: any;
  headers: Headers;
  setCookies: string[];
}

export interface CallOptions {
  /** Cuerpo: un objeto va como JSON; una cadena, tal cual. */
  body?: unknown;
  headers?: Record<string, string>;
  /** `null` quita la cabecera `Origin`. */
  origin?: string | null;
}

export class Client {
  readonly cookies = new Map<string, string>();
  readonly harness: Harness;
  readonly ip: string;

  constructor(harness: Harness, ip: string) {
    this.harness = harness;
    this.ip = ip;
  }

  async call(method: string, path: string, options: CallOptions = {}): Promise<ApiResponse> {
    const headers = new Headers(options.headers);
    headers.set('CF-Connecting-IP', this.ip);
    if (method !== 'GET' && method !== 'HEAD') {
      if (options.origin !== null) headers.set('Origin', options.origin ?? ORIGIN);
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    }
    if (this.cookies.size > 0) {
      headers.set(
        'Cookie',
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      );
    }
    let body: string | undefined;
    if (options.body !== undefined) {
      body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    } else if (method === 'POST') {
      body = '{}';
    }
    const response = await this.harness.app.request(
      `${ORIGIN}${path}`,
      { method, headers, body },
      this.harness.env,
    );
    const setCookies = response.headers.getSetCookie();
    for (const raw of setCookies) {
      const [pair = ''] = raw.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (/;\s*Max-Age=0\b/i.test(raw) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text === '' ? null : JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: response.status, json, headers: response.headers, setCookies };
  }

  post(path: string, body?: unknown, options: Omit<CallOptions, 'body'> = {}) {
    return this.call('POST', path, { ...options, body });
  }

  get(path: string, options: Omit<CallOptions, 'body'> = {}) {
    return this.call('GET', path, options);
  }
}

/**
 * Steam falso para `resolve`: `GetItems` de un juego, con los nombres de `names` (en España) y
 * `blockedInEs` (bloqueados en España, con su nombre en EE. UU.). `fail` hace que la llamada
 * falle (`'network'`, `'status'` o `'garbage'`). Guarda las URL que le piden.
 */
export class FakeSteam {
  readonly names = new Map<number, string>();
  readonly blockedInEs = new Map<number, string>();
  readonly calls: string[] = [];
  fail: 'network' | 'status' | 'garbage' | null = null;

  readonly fetch: SteamFetch = async (url) => {
    this.calls.push(url);
    if (this.fail === 'network') throw new TypeError('fetch failed');
    if (this.fail === 'status') return new Response('Bad gateway', { status: 502 });
    if (this.fail === 'garbage') return new Response('{"response":{"store_items":"no"}}');
    const input = JSON.parse(new URL(url).searchParams.get('input_json') ?? '{}') as {
      ids: Array<{ appid: number }>;
      context: { country_code: string };
    };
    const appid = input.ids[0]?.appid ?? 0;
    const country = input.context.country_code;
    const blocked = this.blockedInEs.get(appid);
    const name = this.names.get(appid) ?? (country === 'US' ? blocked : undefined);
    const item =
      name !== undefined
        ? { item_type: 0, id: appid, success: 1, visible: true, name, appid, type: 0 }
        : blocked !== undefined
          ? {
              item_type: 0,
              id: appid,
              success: 15,
              visible: false,
              unvailable_for_country_restriction: true,
              name: '',
              appid: 0,
            }
          : { item_type: 0, id: appid, success: 15, visible: false, name: '', appid: 0 };
    return Response.json({ response: { store_items: [item] } });
  };
}

export interface Harness {
  db: SqliteD1;
  env: Env;
  app: ReturnType<typeof createApp>;
  clock: { ms: number };
  limits: {
    agenda: CountingLimit;
    redeem: CountingLimit;
    inbox: CountingLimit;
    resolve: CountingLimit;
  };
  steam: FakeSteam;
  client(ip?: string): Client;
}

export interface HarnessOptions {
  /** Otra D1 (p. ej., una que simula escrituras concurrentes). */
  db?: SqliteD1;
  /** Cambios por página de `sync`. */
  pageSize?: number;
}

export function createHarness(overrides: Partial<Env> = {}, options: HarnessOptions = {}): Harness {
  const db = options.db ?? new SqliteD1();
  const clock = { ms: T0 };
  const limits = {
    agenda: new CountingLimit(),
    redeem: new CountingLimit(),
    inbox: new CountingLimit(),
    resolve: new CountingLimit(),
  };
  const steam = new FakeSteam();
  const env: Env = {
    DB: db,
    ASSETS: { fetch: async (request) => new Response(`asset ${new URL(request.url).pathname}`) },
    RL_AGENDA: limits.agenda,
    RL_REDEEM: limits.redeem,
    RL_INBOX: limits.inbox,
    RL_RESOLVE: limits.resolve,
    SYNC_ENABLED: '1',
    MIN_AGE: String(DEFAULT_MIN_AGE),
    ...overrides,
  };
  const app = createApp({
    now: () => clock.ms,
    steamFetch: steam.fetch,
    ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
  });
  let nextIp = 1;
  const harness: Harness = {
    db,
    env,
    app,
    clock,
    limits,
    steam,
    client: (ip) => new Client(harness, ip ?? `192.0.2.${nextIp++}`),
  };
  return harness;
}

/** Activa la sincronización desde `client`, como lo haría la app. */
export async function createAgenda(client: Client, label = 'Chrome en Windows') {
  const response = await client.post('/api/v1/agenda', {
    ageConfirmed: true,
    minAge: DEFAULT_MIN_AGE,
    label,
  });
  if (response.status !== 201) throw new Error(`createAgenda: ${response.status}`);
  return response.json as { deviceId: string; recoveryCode: string };
}

/** Todo el texto de todas las tablas, para comprobar que no hay secretos en claro (CA4.4). */
export function dumpAllText(db: SqliteD1): string {
  const tables = db.rows<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  return tables.map(({ name }) => JSON.stringify(db.rows(`SELECT * FROM ${name}`))).join('\n');
}
