// Utilidades de las pruebas del pipeline (no es un fichero de pruebas): reloj falso, transportes
// de prueba y *fixtures* de `fixtures/steam/`.

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURE_DIRS } from '../src/fixtures.ts';
import {
  SteamClient,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from '../steam/client.ts';
import { type FixtureRecord, fixtureTransport, readFixtures } from '../steam/transports.ts';

export const FIXTURES = fileURLToPath(new URL('../../fixtures/steam/', import.meta.url));

/** Reloj falso: `sleep` avanza el reloj al instante y apunta cuánto se esperó. */
export function fakeRuntime(start = 1_000_000): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  sleeps: number[];
} {
  let t = start;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    random: () => 0.5,
    sleeps,
  };
}

/** Respuestas grabadas que lee la construcción con `--source=fixtures`. */
export function recordedFixtures(): FixtureRecord[] {
  return readFixtures(FIXTURE_DIRS.map((d) => join(FIXTURES, d)));
}

export function syntheticFixtures(): FixtureRecord[] {
  return readFixtures([join(FIXTURES, 'synthetic')]);
}

export function statePath(): string {
  return join(FIXTURES, 'state/master.ndjson');
}

export type Step =
  | Partial<{ status: number; body: string; headers: Record<string, string> }>
  | Error;

/** Transporte que devuelve `steps` en orden (el último se repite) y apunta cada petición. */
export function scripted(steps: readonly Step[]): {
  transport: Transport;
  calls: TransportRequest[];
} {
  const calls: TransportRequest[] = [];
  let i = 0;
  const transport: Transport = async (req) => {
    calls.push(req);
    const s = steps[Math.min(i++, steps.length - 1)] as Step;
    if (s instanceof Error) throw s;
    const headers = new Map(Object.entries(s.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const res: TransportResponse = {
      status: s.status ?? 200,
      header: (name) => headers.get(name.toLowerCase()) ?? null,
      body: s.body ?? '{}',
      wireBytes: 0,
    };
    return res;
  };
  return { transport, calls };
}

/** Cliente sobre los *fixtures* grabados y un reloj falso. */
export function fixtureClient(records: readonly FixtureRecord[] = recordedFixtures()): SteamClient {
  return new SteamClient({ transport: fixtureTransport(records), ...fakeRuntime(), key: null });
}
