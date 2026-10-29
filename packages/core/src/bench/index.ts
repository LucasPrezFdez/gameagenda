// Conjunto realista del banco de pruebas de búsqueda (§8.11): 150 nombres del núcleo tecleados
// carácter a carácter. Lo usan las puertas de calidad (Vitest) y la página de prueba de
// `npm run perf` (§12.4), que corre en el navegador: sin E/S.

import { normalize } from '../normalize/index.ts';

/** Generador pseudoaleatorio con semilla (mulberry32), el del prototipo medido. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semilla del conjunto realista medido el 28-10-2026. */
export const REALISTIC_SEED = 20261028;

/**
 * 50 nombres populares (fila <5 000), 50 intermedios (5 000–50 000) y 50 de la cola, hasta
 * 25 caracteres, elegidos con `seed` entre los nombres del núcleo en su orden.
 */
export function realisticFinals(names: readonly string[], seed = REALISTIC_SEED): string[] {
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

export interface LatencyStats {
  readonly n: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

/** p50, p95 y máximo por el método del rango más cercano (el del banco de pruebas). */
export function latencyStats(samples: readonly number[]): LatencyStats {
  const s = Float64Array.from(samples).sort();
  const q = (f: number): number =>
    s.length === 0
      ? 0
      : (s[Math.min(s.length - 1, Math.max(0, Math.ceil(f * s.length) - 1))] as number);
  return {
    n: s.length,
    p50: q(0.5),
    p95: q(0.95),
    max: s.length === 0 ? 0 : (s[s.length - 1] as number),
  };
}
