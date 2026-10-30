// Recientes sobre el núcleo (§7.6): altas y renombrados de 14 días que cubren el hueco hasta que el
// núcleo local se renueva, a los 7 días. Cada fila sustituye a la de su `appid` en su sitio o, si
// es un alta, se inserta delante de la primera fila con menor `pop`, o con igual `pop` y menor
// `appid`. Un alta retirada va al final. Varias altas en el mismo hueco van por `pop` y `appid`
// descendentes.
//
// Se trabaja sobre las columnas, sin un objeto por fila: se aplica en cada arranque, con 197 031
// filas, y el reinicio con caché tiene presupuesto (CA1.11).

import { CatalogFlag, type CoreCatalog } from './tsv.ts';

interface Insert {
  readonly from: number;
  readonly at: number;
}

/** Primera fila de `[lo, hi)` que cumple `ok`, si `ok` es falso y luego verdadero; si no, `hi`. */
function firstTrue(lo: number, hi: number, ok: (i: number) => boolean): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ok(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * El núcleo con los recientes aplicados, con la versión de `recent`. `core` no cambia. Si `recent`
 * repite un `appid`, vale su última fila.
 */
export function applyRecent(core: CoreCatalog, recent: CoreCatalog): CoreCatalog {
  if (recent.count === 0) return core;
  // `appid` → fila de `recent` (la última, si se repite).
  const fromRecent = new Map<number, number>();
  for (let r = 0; r < recent.count; r++) fromRecent.set(recent.appid[r] as number, r);

  // Sustituciones en su sitio; lo que no está en el núcleo son altas.
  const replace = new Map<number, number>();
  for (let g = 0; g < core.count; g++) {
    const r = fromRecent.get(core.appid[g] as number);
    if (r !== undefined) replace.set(g, r);
  }
  const replaced = new Set(replace.values());

  // Huecos de las altas, con el núcleo original: `pop` no crece en las filas no retiradas.
  const isRetired = (g: number) => ((core.flags[g] as number) & CatalogFlag.retired) !== 0;
  const firstRetired = firstTrue(0, core.count, isRetired);
  let blockMin: Uint32Array | null = null;
  const inserts: Insert[] = [];
  for (const r of fromRecent.values()) {
    if (replaced.has(r)) continue;
    if (((recent.flags[r] as number) & CatalogFlag.retired) !== 0) {
      inserts.push({ from: r, at: core.count });
      continue;
    }
    const p = recent.pop[r] as number;
    const a = recent.appid[r] as number;
    const start = firstTrue(0, firstRetired, (g) => (core.pop[g] as number) <= p);
    const end = firstTrue(start, firstRetired, (g) => (core.pop[g] as number) < p);
    if (start === end) {
      inserts.push({ from: r, at: start });
      continue;
    }
    // Mínimo acumulado del `appid` dentro de cada bloque de igual `pop`: no crece, así que la
    // primera fila del bloque con `appid` menor que `a` sale con una búsqueda binaria.
    if (blockMin === null) {
      blockMin = new Uint32Array(firstRetired);
      for (let g = 0; g < firstRetired; g++) {
        const sameBlock = g > 0 && core.pop[g] === core.pop[g - 1];
        const id = core.appid[g] as number;
        blockMin[g] = sameBlock ? Math.min(blockMin[g - 1] as number, id) : id;
      }
    }
    const mins = blockMin;
    inserts.push({ from: r, at: firstTrue(start, end, (g) => (mins[g] as number) < a) });
  }
  inserts.sort(
    (x, y) =>
      x.at - y.at ||
      (recent.pop[y.from] as number) - (recent.pop[x.from] as number) ||
      (recent.appid[y.from] as number) - (recent.appid[x.from] as number),
  );

  // Columnas nuevas: el núcleo con sus sustituciones y las altas en su hueco.
  const n = core.count + inserts.length;
  const appid = new Uint32Array(n);
  const name: string[] = new Array(n);
  const nameEs = new Map<number, string>();
  const flags = new Uint8Array(n);
  const year = new Uint16Array(n);
  const pop = new Uint8Array(n);
  const put = (out: number, src: CoreCatalog, row: number) => {
    appid[out] = src.appid[row] as number;
    name[out] = src.name[row] as string;
    const es = src.nameEs.get(row);
    if (es !== undefined) nameEs.set(out, es);
    flags[out] = src.flags[row] as number;
    year[out] = src.year[row] as number;
    pop[out] = src.pop[row] as number;
  };
  let out = 0;
  let next = 0;
  for (let g = 0; g <= core.count; g++) {
    while (next < inserts.length && (inserts[next] as Insert).at === g) {
      put(out++, recent, (inserts[next++] as Insert).from);
    }
    if (g === core.count) break;
    const r = replace.get(g);
    if (r === undefined) put(out++, core, g);
    else put(out++, recent, r);
  }
  return { kind: 'core', version: recent.version, count: n, appid, name, nameEs, flags, year, pop };
}
