// Copia congelada del catálogo real (fixtures/catalog-frozen) y utilidades de las puertas de
// calidad de búsqueda (§8.10), portadas del banco de pruebas del prototipo.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { normalize } from '../../src/normalize/index.ts';
import { type GoldenQuery, mulberry32, parseGolden } from '../../src/search/quality.ts';

export {
  type GoldenQuery,
  mulberry32,
  rankOf,
  visibleList,
} from '../../src/search/quality.ts';

const FIXTURES = new URL('../../../../fixtures/catalog-frozen/', import.meta.url);

/** Texto del núcleo y de los alias congelados el 28-10-2026. */
export function readFrozen(): { core: string; aliases: string } {
  return {
    core: gunzipSync(readFileSync(new URL('core.20261028.1.tsv.gz', FIXTURES))).toString('utf8'),
    aliases: readFileSync(new URL('aliases.20261028.1.tsv', FIXTURES), 'utf8'),
  };
}

/** Lee `golden.es.tsv` (consulta ⇥ appid esperados ⇥ categoría). */
export function readGolden(): GoldenQuery[] {
  return parseGolden(readFileSync(new URL('../golden.es.tsv', import.meta.url), 'utf8'));
}

/** Cada consulta tecleada carácter a carácter, sin repetir prefijos iguales tras normalizar. */
export function typedSequences(finals: readonly string[]): string[][] {
  return finals.map((f) => {
    const cps = Array.from(f);
    const seq: string[] = [];
    let prev: string | null = null;
    for (let i = 1; i <= cps.length; i++) {
      const raw = cps.slice(0, i).join('');
      const n = normalize(raw);
      if (!n || n === prev) continue;
      prev = n;
      seq.push(raw);
    }
    return seq;
  });
}

/**
 * Conjunto realista de la §8.11: 50 nombres populares (fila <5 000), 50 intermedios
 * (5 000–50 000) y 50 de la cola, hasta 25 caracteres.
 */
export function realisticFinals(names: readonly string[], seed = 20261028): string[] {
  const rnd = mulberry32(seed);
  const pick = (lo: number, hi: number, k: number): number[] => {
    const s = new Set<number>();
    while (s.size < k) s.add(lo + Math.floor(rnd() * (hi - lo)));
    return [...s];
  };
  const ids = [...pick(0, 5000, 50), ...pick(5000, 50000, 50), ...pick(50000, names.length, 50)];
  return ids.map((g) =>
    Array.from(names[g] as string)
      .slice(0, 25)
      .join(''),
  );
}

export interface Stats {
  readonly n: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

export function stats(samples: readonly number[]): Stats {
  const s = Float64Array.from(samples).sort();
  const q = (f: number): number =>
    s[Math.min(s.length - 1, Math.max(0, Math.ceil(f * s.length) - 1))] as number;
  return {
    n: s.length,
    p50: +q(0.5).toFixed(3),
    p95: +q(0.95).toFixed(3),
    max: +(s[s.length - 1] ?? 0).toFixed(3),
  };
}
