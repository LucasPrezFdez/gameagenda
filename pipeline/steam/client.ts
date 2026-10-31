// Cliente HTTP de Steam con la política de la §4.7: un único *worker*, una petición cada 3 s y
// nunca más de 0,4/s; código HTTP, `X-eresult` y contrato Zod en cada respuesta; 429 con pausa
// global y *backoff* (60 s–15 min, o `Retry-After`), abortando tras 5 seguidos; 5xx o tiempo
// agotado con 5 reintentos (2/4/8/16/32 s + *jitter*); 400 sin reintento; 403 con clave, parar.
// El transporte, el reloj, la espera y el azar se inyectan: las pruebas no esperan de verdad.

import type { z } from 'zod';
import { endpointOf, needsKey } from './endpoints.ts';

/** Petición que recibe el transporte (la clave, si la hay, va en `headers`). */
export interface TransportRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

/** Respuesta ya descomprimida. `wireBytes` es lo que viajó (gzip), si se sabe. */
export interface TransportResponse {
  readonly status: number;
  header(name: string): string | null;
  readonly body: string;
  readonly wireBytes: number;
}

/** `fetch` del pipeline: HTTPS de verdad, *fixtures* o un doble de prueba. */
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

export type SteamErrorKind =
  | 'bad-request'
  | 'forbidden'
  | 'key-rejected'
  | 'http'
  | 'rate-limited'
  | 'server'
  | 'network'
  | 'eresult'
  | 'contract'
  | 'missing-fixture';

/** Error de la etapa: se aborta (no se publica) y el proceso sale con error (§4.6). */
export class SteamError extends Error {
  readonly kind: SteamErrorKind;
  readonly url: string;
  readonly status: number | null;
  constructor(kind: SteamErrorKind, message: string, url: string, status: number | null = null) {
    super(`${message} [${endpointOf(url)}]`);
    this.name = 'SteamError';
    this.kind = kind;
    this.url = url;
    this.status = status;
  }
}

/** Fallo del transporte que se reintenta como un 5xx (red caída, tiempo agotado). */
export class TransportError extends Error {
  readonly timeout: boolean;
  constructor(message: string, timeout = false) {
    super(message);
    this.name = 'TransportError';
    this.timeout = timeout;
  }
}

/** Petición sin *fixture* con `STEAM_MODE=fixtures` (§12.2): nunca se reintenta. */
export class MissingFixtureError extends Error {
  readonly url: string;
  constructor(url: string) {
    super(`Petición sin fixture (STEAM_MODE=fixtures): ${url}`);
    this.name = 'MissingFixtureError';
    this.url = url;
  }
}

/** Una petición hecha (o servida desde la caché de páginas crudas), para el informe. */
export interface RequestRecord {
  readonly endpoint: string;
  readonly name: string;
  readonly status: number;
  readonly attempt: number;
  readonly wireBytes: number;
  readonly bodyBytes: number;
  readonly ms: number;
  readonly cached: boolean;
  /** `true` si llevó la clave (solo `GetAppList`; CA2.1). */
  readonly keyed: boolean;
  /** Inicio de la petición (ms del reloj del cliente); 0 si vino de la caché. */
  readonly startedAt: number;
}

/** Respuesta guardada, con lo que se midió al descargarla. */
export interface CachedResponse {
  readonly body: string;
  readonly wireBytes: number;
  readonly ms: number;
}

/** Caché de respuestas correctas (las páginas crudas de `pipeline/state/raw-<fecha>/`). */
export interface ResponseCache {
  get(name: string, url: string): CachedResponse | null;
  put(name: string, url: string, response: CachedResponse): void;
}

export interface ClientOptions {
  readonly transport: Transport;
  /** Reloj en ms (`Date.now`). */
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** Azar en [0, 1) para el *jitter*. */
  readonly random: () => number;
  /**
   * Clave de la Web API: solo viaja en `x-webapi-key`, solo a `GetAppList` (§4.4), y nunca se
   * registra.
   */
  readonly key?: string | null;
  /** Intervalo entre inicios de petición (3 000 ms); nunca baja de 2 500 ms (0,4/s). */
  readonly intervalMs?: number;
  /** Tiempo máximo por petición. */
  readonly timeoutMs?: number;
  readonly cache?: ResponseCache | null;
  /** Solo la caché: una petición que no esté en ella falla sin tocar la red. */
  readonly offline?: boolean;
  readonly log?: (line: string) => void;
}

export const DEFAULT_INTERVAL_MS = 3000;
/** 0,4 peticiones/s como mucho, el límite que mide la comunidad (≈120 cada 5 min por IP). */
export const MIN_INTERVAL_MS = 2500;
export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_429_IN_A_ROW = 5;
export const MAX_RETRIES = 5;
const BACKOFF_429_MIN_MS = 60_000;
const BACKOFF_429_MAX_MS = 15 * 60_000;
const RETRY_BASE_MS = 2000;
const RETRY_JITTER_MS = 1000;
const EXPECTED_ERESULT = '1';
const ERESULT_RATE_LIMIT = '84';

/** Espera de un 429: `Retry-After` (segundos o fecha HTTP) o *backoff* exponencial. */
export function backoff429(
  n: number,
  random: number,
  retryAfter: string | null,
  now: number,
): number {
  if (retryAfter !== null && retryAfter.trim() !== '') {
    const s = Number(retryAfter);
    const ms = Number.isFinite(s) ? s * 1000 : Date.parse(retryAfter) - now;
    if (Number.isFinite(ms)) return Math.max(0, Math.ceil(ms));
  }
  const base = Math.min(BACKOFF_429_MAX_MS, BACKOFF_429_MIN_MS * 2 ** (n - 1));
  return Math.min(BACKOFF_429_MAX_MS, Math.round(base * (1 + 0.25 * random)));
}

/** Espera antes del reintento `n` (1–5) tras un 5xx o un tiempo agotado: 2, 4, 8, 16 y 32 s. */
export function backoffRetry(n: number, random: number): number {
  return RETRY_BASE_MS * 2 ** (n - 1) + Math.round(RETRY_JITTER_MS * random);
}

/** Cliente de un solo *worker*: las peticiones se encadenan, nunca van en paralelo. */
export class SteamClient {
  readonly records: RequestRecord[] = [];
  private readonly opts: ClientOptions;
  private readonly interval: number;
  private lastStart = Number.NEGATIVE_INFINITY;
  private pausedUntil = Number.NEGATIVE_INFINITY;
  private in429Row = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: ClientOptions) {
    this.opts = options;
    this.interval = Math.max(MIN_INTERVAL_MS, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  }

  /**
   * GET validado: comprueba el estado HTTP, `X-eresult` y el contrato `schema`. `name` identifica
   * la respuesta en la caché de páginas crudas (`query-000950`, `getitems-spanish-es-…`).
   */
  get<S extends z.ZodType>(url: string, schema: S, name: string): Promise<z.output<S>> {
    const run = this.queue.then(() => this.run(url, schema, name));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private log(line: string): void {
    this.opts.log?.(line);
  }

  private async pace(): Promise<void> {
    const at = Math.max(this.lastStart + this.interval, this.pausedUntil);
    const wait = at - this.opts.now();
    if (wait > 0) await this.opts.sleep(wait);
    this.lastStart = this.opts.now();
  }

  private validate<S extends z.ZodType>(url: string, body: string, schema: S): z.output<S> {
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw new SteamError('contract', 'JSON no válido', url, 200);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue ? `${issue.path.join('.')}: ${issue.message}` : '';
      throw new SteamError('contract', `La respuesta no cumple el contrato (${where})`, url, 200);
    }
    return parsed.data;
  }

  private async run<S extends z.ZodType>(
    url: string,
    schema: S,
    name: string,
  ): Promise<z.output<S>> {
    const { cache, offline, transport, now, sleep, random } = this.opts;
    const endpoint = endpointOf(url);
    const cached = cache?.get(name, url) ?? null;
    if (cached !== null) {
      const data = this.validate(url, cached.body, schema);
      this.records.push({
        endpoint,
        name,
        status: 200,
        attempt: 0,
        wireBytes: cached.wireBytes,
        bodyBytes: Buffer.byteLength(cached.body, 'utf8'),
        ms: cached.ms,
        cached: true,
        keyed: false,
        startedAt: 0,
      });
      return data;
    }
    if (offline) throw new SteamError('missing-fixture', `Sin página cruda «${name}»`, url);

    const headers: Record<string, string> = {
      'Accept-Encoding': 'gzip',
      Accept: 'application/json',
      'User-Agent': 'GameAgenda-catalog/0.1 (+https://github.com/LucasPrezFdez/gameagenda)',
    };
    const key = this.opts.key && needsKey(url) ? this.opts.key : null;
    if (key) headers['x-webapi-key'] = key;
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    for (let attempt = 1, retries = 0; ; attempt++) {
      await this.pace();
      const t0 = now();
      let res: TransportResponse;
      try {
        res = await transport({ url, headers, timeoutMs });
      } catch (e) {
        if (e instanceof MissingFixtureError)
          throw new SteamError('missing-fixture', e.message, url);
        const what = e instanceof TransportError && e.timeout ? 'tiempo agotado' : 'error de red';
        if (retries >= MAX_RETRIES) {
          throw new SteamError('network', `${what} tras ${MAX_RETRIES} reintentos`, url);
        }
        retries++;
        const wait = backoffRetry(retries, random());
        this.log(`  ${what} en ${name}: reintento ${retries} en ${Math.round(wait / 1000)} s`);
        await sleep(wait);
        continue;
      }
      const ms = now() - t0;
      const eresult = res.header('x-eresult');
      this.records.push({
        endpoint,
        name,
        status: res.status,
        attempt,
        wireBytes: res.wireBytes,
        bodyBytes: Buffer.byteLength(res.body, 'utf8'),
        ms,
        cached: false,
        keyed: key !== null,
        startedAt: t0,
      });

      if (res.status === 429 || eresult === ERESULT_RATE_LIMIT) {
        this.in429Row++;
        if (this.in429Row >= MAX_429_IN_A_ROW) {
          throw new SteamError(
            'rate-limited',
            `${MAX_429_IN_A_ROW} respuestas 429 seguidas`,
            url,
            429,
          );
        }
        const wait = backoff429(this.in429Row, random(), res.header('retry-after'), now());
        if (wait > BACKOFF_429_MAX_MS) {
          throw new SteamError(
            'rate-limited',
            `Retry-After de ${Math.round(wait / 1000)} s`,
            url,
            429,
          );
        }
        // Pausa global: ninguna petición sale antes, aunque la pida otra etapa.
        this.pausedUntil = now() + wait;
        this.log(
          `  429 en ${name} (${this.in429Row} seguidos): pausa de ${Math.round(wait / 1000)} s`,
        );
        continue;
      }
      this.in429Row = 0;

      if (res.status >= 500) {
        if (retries >= MAX_RETRIES) {
          throw new SteamError(
            'server',
            `HTTP ${res.status} tras ${MAX_RETRIES} reintentos`,
            url,
            res.status,
          );
        }
        retries++;
        const wait = backoffRetry(retries, random());
        this.log(
          `  HTTP ${res.status} en ${name}: reintento ${retries} en ${Math.round(wait / 1000)} s`,
        );
        await sleep(wait);
        continue;
      }
      if (res.status === 403) {
        throw key
          ? new SteamError(
              'key-rejected',
              'HTTP 403 con clave: clave revocada o cuenta limitada',
              url,
              403,
            )
          : new SteamError('forbidden', 'HTTP 403 sin clave: el endpoint pide clave', url, 403);
      }
      if (res.status === 400) throw new SteamError('bad-request', 'HTTP 400', url, 400);
      if (res.status !== 200) throw new SteamError('http', `HTTP ${res.status}`, url, res.status);
      if (eresult !== null && eresult !== EXPECTED_ERESULT) {
        throw new SteamError('eresult', `X-eresult ${eresult}`, url, 200);
      }
      const data = this.validate(url, res.body, schema);
      cache?.put(name, url, { body: res.body, wireBytes: res.wireBytes, ms });
      this.log(
        `  ${name}: ${res.status} · ${(res.wireBytes / 1024).toFixed(0)} KB gzip · ${(Buffer.byteLength(res.body) / 1024).toFixed(0)} KB · ${ms} ms`,
      );
      return data;
    }
  }
}
