// Recientes sobre el núcleo (§7.6): altas y renombrados de 14 días que cubren el hueco hasta que el
// núcleo local se renueva, a los 7 días. Cada fila sustituye a la de su `appid` en su sitio o, si
// es un alta, se inserta delante de la primera fila con menor `pop`, o con igual `pop` y menor
// `appid`. Un alta retirada va al final. Varias altas en el mismo hueco van por `pop` y `appid`
// descendentes.
//
// Se trabaja sobre las columnas, sin un objeto por fila: se aplica en cada arranque, con ≈199 000
// filas, y el reinicio con caché tiene presupuesto (CA1.11). Se ejecuta una sola vez, casi todo
// antes de que el motor lo optimice, así que lo que recorre todas las filas va en operaciones
// nativas: las columnas del núcleo se copian en bloques entre los huecos de las altas (`set` y
// `slice`), y las sustituciones y los nombres en español se colocan después, sin consultar un
// `Map` por fila. Con 4 000 recientes y CPU ×1, la primera llamada pasó de ≈21 a ≈10 ms
// (06-11-2026).

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
 * `appid` → última fila de `recent` con ese `appid` (-1 si no está): una tabla abierta con sondeo
 * lineal y carga ≤¼, porque se consulta una vez por cada fila del núcleo.
 */
interface AppidTable {
  readonly keys: Uint32Array;
  readonly rows: Int32Array;
  readonly mask: number;
  readonly shift: number;
}

function appidTable(recent: CoreCatalog): AppidTable {
  let bits = 4;
  while (1 << bits < recent.count * 4) bits++;
  const mask = (1 << bits) - 1;
  const shift = 32 - bits;
  const keys = new Uint32Array(mask + 1);
  const rows = new Int32Array(mask + 1).fill(-1);
  for (let r = 0; r < recent.count; r++) {
    const id = recent.appid[r] as number;
    let i = Math.imul(id, 0x9e3779b1) >>> shift;
    while (rows[i] !== -1 && keys[i] !== id) i = (i + 1) & mask;
    keys[i] = id;
    rows[i] = r;
  }
  return { keys, rows, mask, shift };
}

function rowOf({ keys, rows, mask, shift }: AppidTable, id: number): number {
  let i = Math.imul(id, 0x9e3779b1) >>> shift;
  while (rows[i] !== -1 && keys[i] !== id) i = (i + 1) & mask;
  return rows[i] as number;
}

/**
 * El núcleo con los recientes aplicados, con la versión de `recent`. `core` no cambia. Si `recent`
 * repite un `appid`, vale su última fila.
 */
export function applyRecent(core: CoreCatalog, recent: CoreCatalog): CoreCatalog {
  if (recent.count === 0) return core;
  const table = appidTable(recent);

  // Sustituciones en su sitio, por orden de fila del núcleo; lo que no está en el núcleo son altas.
  const replaceAt: number[] = [];
  const replaceFrom: number[] = [];
  const replaced = new Uint8Array(recent.count);
  for (let g = 0; g < core.count; g++) {
    const r = rowOf(table, core.appid[g] as number);
    if (r === -1) continue;
    replaceAt.push(g);
    replaceFrom.push(r);
    replaced[r] = 1;
  }

  // Huecos de las altas, con el núcleo original: `pop` no crece en las filas no retiradas.
  const isRetired = (g: number) => ((core.flags[g] as number) & CatalogFlag.retired) !== 0;
  const firstRetired = firstTrue(0, core.count, isRetired);
  let blockMin: Uint32Array | null = null;
  const inserts: Insert[] = [];
  for (let r = 0; r < recent.count; r++) {
    // Ya está en el núcleo, o es un `appid` repetido que vale por una fila posterior.
    if (replaced[r] === 1 || rowOf(table, recent.appid[r] as number) !== r) continue;
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

  // Columnas nuevas. La fila `g` del núcleo baja tantas filas como altas van en su hueco o antes,
  // y la alta `i` (en orden) va en `at + i`.
  const n = core.count + inserts.length;
  const appid = new Uint32Array(n);
  const flags = new Uint8Array(n);
  const year = new Uint16Array(n);
  const pop = new Uint8Array(n);
  const put = (out: number, row: number) => {
    appid[out] = recent.appid[row] as number;
    flags[out] = recent.flags[row] as number;
    year[out] = recent.year[row] as number;
    pop[out] = recent.pop[row] as number;
  };
  // Los nombres, en trozos que se juntan con `concat`, también nativo.
  const nameParts: (readonly string[])[] = [];
  const insertAt = new Int32Array(inserts.length);
  let from = 0;
  for (let i = 0; i <= inserts.length; i++) {
    const to = i < inserts.length ? (inserts[i] as Insert).at : core.count;
    if (to > from) {
      // Las filas `[from, to)` del núcleo, de una vez, `i` filas más abajo.
      appid.set(core.appid.subarray(from, to), from + i);
      flags.set(core.flags.subarray(from, to), from + i);
      year.set(core.year.subarray(from, to), from + i);
      pop.set(core.pop.subarray(from, to), from + i);
      nameParts.push(core.name.slice(from, to));
    }
    if (i < inserts.length) {
      const insert = inserts[i] as Insert;
      insertAt[i] = to;
      put(to + i, insert.from);
      nameParts.push([recent.name[insert.from] as string]);
    }
    from = to;
  }
  // `concat` por tandas: con un solo `concat(...nameParts)`, muchísimas altas pasarían del límite
  // de argumentos.
  let name: string[] = [];
  for (let k = 0; k < nameParts.length; k += 4096) {
    name = name.concat(...nameParts.slice(k, k + 4096));
  }
  /** Fila nueva de la fila `g` del núcleo: las altas con `at` ≤ `g` van delante. */
  const shifted = (g: number) =>
    g + firstTrue(0, inserts.length, (i) => (insertAt[i] as number) > g);

  // Sustituciones, en la fila que le toca a la del núcleo, y los nombres en español de cada fila,
  // en orden de fila, como si se hubieran copiado una a una.
  const esRows: number[] = [];
  const esNames: string[] = [];
  const keepEs = (out: number, es: string | undefined) => {
    if (es === undefined) return;
    esRows.push(out);
    esNames.push(es);
  };
  const replacedCore = new Set(replaceAt);
  for (const [g, es] of core.nameEs) if (!replacedCore.has(g)) keepEs(shifted(g), es);
  for (let k = 0; k < replaceAt.length; k++) {
    const out = shifted(replaceAt[k] as number);
    const r = replaceFrom[k] as number;
    put(out, r);
    name[out] = recent.name[r] as string;
    keepEs(out, recent.nameEs.get(r));
  }
  for (let i = 0; i < inserts.length; i++) {
    keepEs((insertAt[i] as number) + i, recent.nameEs.get((inserts[i] as Insert).from));
  }
  const order = esRows
    .map((_, k) => k)
    .sort((x, y) => (esRows[x] as number) - (esRows[y] as number));
  const nameEs = new Map<number, string>();
  for (const k of order) nameEs.set(esRows[k] as number, esNames[k] as string);

  return { kind: 'core', version: recent.version, count: n, appid, name, nameEs, flags, year, pop };
}
