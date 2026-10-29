// Transportes del cliente: HTTPS real (un solo *socket*, gzip y tiempo máximo) y *fixtures*
// grabados en `fixtures/steam/` (§12.2), que fallan ante cualquier petición sin grabar.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import https from 'node:https';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  MissingFixtureError,
  type Transport,
  TransportError,
  type TransportResponse,
} from './client.ts';

/** HTTPS con `keepAlive` y un único *socket*: el ritmo lo pone el cliente. */
export function httpsTransport(): Transport {
  const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });
  return (req) =>
    new Promise<TransportResponse>((resolve, reject) => {
      let settled = false;
      const fail = (e: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        reject(e);
      };
      const r = https.get(
        req.url,
        { agent, headers: req.headers, timeout: req.timeoutMs },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('error', (e) => fail(new TransportError(e.message)));
          res.on('end', () => {
            if (settled) return;
            const wire = Buffer.concat(chunks);
            let body: Buffer = wire;
            try {
              if ((res.headers['content-encoding'] ?? '').includes('gzip')) body = gunzipSync(wire);
            } catch (e) {
              fail(new TransportError(`gzip no válido: ${(e as Error).message}`));
              return;
            }
            settled = true;
            clearTimeout(deadline);
            const headers = res.headers;
            resolve({
              status: res.statusCode ?? 0,
              header: (name) => {
                const v = headers[name.toLowerCase()];
                return v === undefined ? null : Array.isArray(v) ? v.join(', ') : v;
              },
              body: body.toString('utf8'),
              wireBytes: wire.length,
            });
          });
        },
      );
      // Tiempo máximo de la petición entera (el `timeout` del *socket* solo mide la inactividad).
      const deadline = setTimeout(() => {
        r.destroy(new TransportError(`tiempo agotado (${req.timeoutMs} ms)`, true));
      }, req.timeoutMs);
      r.on('timeout', () => r.destroy(new TransportError('tiempo agotado', true)));
      r.on('error', (e) => fail(e instanceof TransportError ? e : new TransportError(e.message)));
    });
}

/**
 * Una respuesta grabada (§12.2): URL, estado, fecha y cuerpo, nunca cabeceras de la petición.
 * El cuerpo va como `json` si se leyó bien o como `text` (JSON roto). Los casos sintéticos
 * (429, 5xx…) pueden llevar `headers` de respuesta de una lista cerrada (`retry-after`,
 * `x-eresult`).
 */
export interface FixtureRecord {
  readonly url: string;
  readonly status: number;
  readonly date: string;
  readonly json?: unknown;
  readonly text?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly synthetic?: string;
}

export const FIXTURE_RESPONSE_HEADERS: ReadonlySet<string> = new Set(['retry-after', 'x-eresult']);

/** Cuerpo de una respuesta grabada, tal como lo devolvería Steam. */
export function fixtureBody(f: FixtureRecord): string {
  return f.json !== undefined ? JSON.stringify(f.json) : (f.text ?? '');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
}

/** Lee los *fixtures* de `dirs` (recursivo) en orden de ruta. */
export function readFixtures(dirs: readonly string[]): FixtureRecord[] {
  const out: FixtureRecord[] = [];
  for (const dir of dirs) {
    for (const file of walk(dir)) out.push(JSON.parse(readFileSync(file, 'utf8')) as FixtureRecord);
  }
  return out;
}

/**
 * Transporte de *fixtures*: sirve cada URL con sus grabaciones en orden (la última se repite) y
 * lanza `MissingFixtureError` ante una URL sin grabar, sin tocar la red.
 */
export function fixtureTransport(records: readonly FixtureRecord[]): Transport {
  const byUrl = new Map<string, FixtureRecord[]>();
  for (const r of records) {
    const list = byUrl.get(r.url) ?? [];
    list.push(r);
    byUrl.set(r.url, list);
  }
  const served = new Map<string, number>();
  return async (req) => {
    const list = byUrl.get(req.url);
    if (!list || list.length === 0) throw new MissingFixtureError(req.url);
    const i = served.get(req.url) ?? 0;
    served.set(req.url, i + 1);
    const f = list[Math.min(i, list.length - 1)] as FixtureRecord;
    const headers = new Map<string, string>();
    for (const [k, v] of Object.entries(f.headers ?? {})) {
      if (FIXTURE_RESPONSE_HEADERS.has(k.toLowerCase())) headers.set(k.toLowerCase(), v);
    }
    const body = fixtureBody(f);
    return {
      status: f.status,
      header: (name) => headers.get(name.toLowerCase()) ?? null,
      body,
      wireBytes: 0,
    };
  };
}
