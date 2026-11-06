// Arnés de las pruebas de la micro-API (§12: rutas con `app.request()` de Hono): D1 sobre
// `node:sqlite`, reloj inyectado, límites que cuentan de verdad y clientes con su tarro de cookies,
// que mandan `Origin` y `Content-Type` como lo haría la app.

import { DEFAULT_MIN_AGE } from '@gameagenda/core/api';
import { createApp } from '../app.ts';
import type { Env, RateLimit } from '../env.ts';
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

export interface Harness {
  db: SqliteD1;
  env: Env;
  app: ReturnType<typeof createApp>;
  clock: { ms: number };
  limits: { agenda: CountingLimit; redeem: CountingLimit };
  client(ip?: string): Client;
}

export function createHarness(overrides: Partial<Env> = {}): Harness {
  const db = new SqliteD1();
  const clock = { ms: T0 };
  const limits = { agenda: new CountingLimit(), redeem: new CountingLimit() };
  const env: Env = {
    DB: db,
    ASSETS: { fetch: async (request) => new Response(`asset ${new URL(request.url).pathname}`) },
    RL_AGENDA: limits.agenda,
    RL_REDEEM: limits.redeem,
    SYNC_ENABLED: '1',
    MIN_AGE: String(DEFAULT_MIN_AGE),
    ...overrides,
  };
  const app = createApp({ now: () => clock.ms });
  let nextIp = 1;
  const harness: Harness = {
    db,
    env,
    app,
    clock,
    limits,
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
