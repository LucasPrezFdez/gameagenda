// El calentamiento al arrancar (CA4.6; DECISIONES §10.60): no le falta ningún esquema, no hace E/S
// (en el ámbito global, `workerd` no lo deja) y la micro-API sigue respondiendo igual después.

import { readdirSync, readFileSync } from 'node:fs';
import * as api from '@gameagenda/core/api';
import * as schemas from '@gameagenda/core/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.ts';
import { WARM_SCHEMAS, warmUp } from '../warm-up.ts';
import { createAgenda, createHarness } from './harness.ts';

const WORKER = new URL('../', import.meta.url);

/** Los nombres de los esquemas que la micro-API usa para validar: `parseBody(c, x…)` y `x.safeParse(`. */
function schemasInUse(): Set<string> {
  const files = [
    ...readdirSync(WORKER).filter((f) => f.endsWith('.ts')),
    ...readdirSync(new URL('routes/', WORKER)).map((f) => `routes/${f}`),
  ].filter((f) => f !== 'warm-up.ts');
  const names = new Set<string>();
  for (const file of files) {
    const source = readFileSync(new URL(file, WORKER), 'utf8');
    for (const m of source.matchAll(/parseBody\(\s*c,\s*(\w+)/g)) names.add(m[1] as string);
    for (const m of source.matchAll(/\b(\w+Schema)\.safeParse\(/g)) names.add(m[1] as string);
  }
  return names;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('warmUp', () => {
  it('prepara todos los esquemas con los que valida la micro-API', () => {
    const exported: Record<string, unknown> = { ...api, ...schemas };
    const names = schemasInUse();
    expect(names.size).toBeGreaterThan(10);
    for (const name of names) {
      expect(exported[name], name).toBeDefined();
      expect(WARM_SCHEMAS.includes(exported[name] as never), name).toBe(true);
    }
  });

  it('no hace E/S ni pide números aleatorios', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch en el ámbito global');
    });
    const random = vi.spyOn(crypto, 'getRandomValues').mockImplementation(() => {
      throw new Error('getRandomValues en el ámbito global');
    });
    const uuid = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('randomUUID en el ámbito global');
    });
    expect(() => warmUp(createApp())).not.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
  });

  it('después, la micro-API responde igual', async () => {
    const h = createHarness();
    warmUp(h.app);
    warmUp(h.app);
    const client = h.client();
    await createAgenda(client);
    expect((await client.get('/api/v1/devices')).status).toBe(200);
    expect((await client.post('/api/v1/agenda', { ageConfirmed: 'sí' })).status).toBe(400);
    expect((await client.post('/api/v1/no-existe', {})).status).toBe(404);
  });
});
