// *Fixtures* de Steam (`fixtures/steam/`, §12.2 y §13.5): qué carpetas lee la construcción,
// cómo se llaman los ficheros y la comprobación de que ninguno lleva la clave.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { endpointOf } from '../steam/endpoints.ts';

/** Carpetas que lee `catalog:build -- --source=fixtures` (las de `synthetic/` son de las pruebas). */
export const FIXTURE_DIRS = ['getapplist', 'query', 'getitems'] as const;

/** Una clave de la Web API son 32 dígitos hexadecimales en mayúsculas. */
const RE_KEY_SHAPE = /\b[0-9A-F]{32}\b/;
const RE_KEY_HEADER = /x-webapi-key/i;

/** `true` si el texto contiene la clave, algo con su forma o la cabecera que la lleva. */
export function containsKey(text: string, key: string | null): boolean {
  return Boolean(key && text.includes(key)) || RE_KEY_SHAPE.test(text) || RE_KEY_HEADER.test(text);
}

/** Ficheros de `dir` (recursivo) que contienen la clave (§12.2: `fixtures:record` falla). */
export function filesWithKey(dir: string, key: string | null): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesWithKey(p, key));
    else if (containsKey(readFileSync(p, 'utf8'), key)) out.push(p);
  }
  return out;
}

/** Nombre legible y estable de un *fixture* a partir de su URL. */
export function fixtureName(url: string): string {
  const endpoint = endpointOf(url);
  const h = createHash('sha256').update(url).digest('hex').slice(0, 10);
  const input = new URL(url).searchParams.get('input_json');
  if (!input) return `${endpoint}-${h}`;
  const j = JSON.parse(input) as {
    query?: { start: number; count: number };
    ids?: unknown[];
    context?: { language?: string; country_code?: string };
  };
  const ctx = `${j.context?.language ?? 'x'}-${(j.context?.country_code ?? 'x').toLowerCase()}`;
  if (endpoint === 'query' && j.query) {
    return `query-${ctx}-${String(j.query.start).padStart(6, '0')}-${j.query.count}`;
  }
  return `${endpoint}-${ctx}-${j.ids?.length ?? 0}-${h}`;
}
