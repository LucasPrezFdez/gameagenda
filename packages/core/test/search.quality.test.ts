// Puertas de calidad de búsqueda (§8.10) sobre la copia congelada del catálogo real, en el
// índice completo (`full`) y en el puente de escaneo (`scan`), más sus tiempos en Node.

import { beforeAll, describe, expect, it } from 'vitest';
import { parseAliases, parseCore, serializeCore } from '../src/catalog-format/index.ts';
import { normalize } from '../src/normalize/index.ts';
import {
  canSuggest,
  createIndexBuilder,
  type FuzzyMatcher,
  loadFuzzy,
  type Searcher,
  Tier,
} from '../src/search/index.ts';
import {
  type GoldenQuery,
  mulberry32,
  rankOf,
  readFrozen,
  readGolden,
  realisticFinals,
  stats,
  typedSequences,
  visibleList,
} from './helpers/frozen.ts';

const SLOW = { timeout: 240_000 };
const pct = (k: number, n: number): number => +((100 * k) / n).toFixed(1);

let full: Searcher;
let scan: Searcher;
let fuzzy: FuzzyMatcher;
let names: readonly string[];
let appidAt: Uint32Array;
let golden: GoldenQuery[];
let coreText: string;
const build: Record<string, number> = {};

beforeAll(async () => {
  const { core, aliases } = readFrozen();
  coreText = core;
  let t = performance.now();
  const cat = parseCore(core);
  build.parseMs = performance.now() - t;
  const al = parseAliases(aliases);
  names = cat.name;
  appidAt = cat.appid;
  // Como en el Worker: bloques de ≤8 ms con el reloj del entorno.
  t = performance.now();
  const b = createIndexBuilder(cat, al.pairs, { now: () => performance.now() });
  let maxBlock = 0;
  let blocks = 0;
  for (;;) {
    const a = performance.now();
    const done = b.step(a + 8);
    maxBlock = Math.max(maxBlock, performance.now() - a);
    blocks++;
    if (!build.scanMs && b.state === 'scan') {
      build.scanMs = performance.now() - t;
      scan = b.searcher as Searcher;
    }
    if (done) break;
  }
  build.fullMs = performance.now() - t;
  build.blocks = blocks;
  build.maxBlockMs = maxBlock;
  full = b.result as Searcher;
  fuzzy = await loadFuzzy();
  golden = readGolden();
  console.log(
    'construcción (Node):',
    JSON.stringify(build, (_, v) => (typeof v === 'number' ? +v.toFixed(1) : v)),
  );
}, 240_000);

describe('catálogo congelado', () => {
  it('se lee entero y se vuelve a escribir con los mismos bytes', SLOW, () => {
    expect(full.count).toBe(196_665);
    expect(full.version).toBe('20261028.1');
    expect(serializeCore(parseCore(coreText), { version: '20261028.1' })).toBe(coreText);
  });
});

interface GateReport {
  golden: { n: number; top1: number; top5: number; top1NoFuzzy: number; top5NoFuzzy: number };
  exact2000: number;
  prefix4Top10: number;
  prefix4Top8Visible: number;
  notTop1: [string, number, string][];
  negatives: Record<string, string[]>;
}
const reports: Record<string, GateReport> = {};

function runGates(engine: 'full' | 'scan'): void {
  describe(`puertas (${engine})`, () => {
    const s = (): Searcher => (engine === 'full' ? full : scan);

    it('dorado: top-1 ≥90 % y top-5 ≥95 % en la lista visible (con el nivel 4)', SLOW, () => {
      let t1 = 0;
      let t5 = 0;
      let t1n = 0;
      let t5n = 0;
      const notTop1: [string, number, string][] = [];
      for (const g of golden) {
        const items = visibleList(s(), fuzzy, g.q);
        const k = rankOf(items, g.appids);
        const k0 = rankOf(visibleList(s(), null, g.q), g.appids);
        if (k === 1) t1++;
        else notTop1.push([g.q, k, items[0]?.name ?? '']);
        if (k >= 1 && k <= 5) t5++;
        if (k0 === 1) t1n++;
        if (k0 >= 1 && k0 <= 5) t5n++;
      }
      const n = golden.length;
      const r = {
        n,
        top1: pct(t1, n),
        top5: pct(t5, n),
        top1NoFuzzy: pct(t1n, n),
        top5NoFuzzy: pct(t5n, n),
      };
      reports[engine] = { ...(reports[engine] as GateReport), golden: r, notTop1 };
      expect(n).toBeGreaterThanOrEqual(60);
      expect(r.top1).toBeGreaterThanOrEqual(90);
      expect(r.top5).toBeGreaterThanOrEqual(95);
    });

    it('2 000 exactos al azar (semilla 42): ≥99 % en el top-5, con +18 visible', SLOW, () => {
      const rnd = mulberry32(42);
      const sample = new Set<number>();
      while (sample.size < 2000) sample.add(Math.floor(rnd() * names.length));
      let hits = 0;
      // Sin el nivel 4: sus sugerencias van detrás de la 5.ª fila y no cambian el top-5.
      for (const g of sample) {
        const items = visibleList(s(), null, names[g] as string, { showAdult: true });
        const k = rankOf(items, [appidAt[g] as number]);
        if (k >= 1 && k <= 5) hits++;
      }
      const r = pct(hits, 2000);
      reports[engine] = { ...(reports[engine] as GateReport), exact2000: r };
      expect(r).toBeGreaterThanOrEqual(99);
    });

    it(
      'prefijos de 4 letras de los 1 000 más populares: ≥90 % en el top-10, con +18 visible',
      SLOW,
      () => {
        let top10 = 0;
        let top8 = 0;
        // Niveles 0–3 con limit 10, como el prototipo; el top-8 es la lista de la paleta.
        for (let g = 0; g < 1000; g++) {
          const q = Array.from(normalize(names[g] as string))
            .slice(0, 4)
            .join('')
            .trim();
          const k = rankOf(visibleList(s(), null, q, { limit: 10, showAdult: true }), [
            appidAt[g] as number,
          ]);
          if (k >= 1 && k <= 10) top10++;
          if (k >= 1 && k <= 8) top8++;
        }
        reports[engine] = {
          ...(reports[engine] as GateReport),
          prefix4Top10: pct(top10, 1000),
          prefix4Top8Visible: pct(top8, 1000),
        };
        expect(top10 / 10).toBeGreaterThanOrEqual(90);
      },
    );

    it('negativas: «pokemon», «zelda» y «mario kart» sin resultados de nivel 0–1', SLOW, () => {
      const negatives: Record<string, string[]> = {};
      for (const q of ['pokemon', 'pokémon', 'zelda', 'mario kart', 'fortnite', 'valorant']) {
        const items = visibleList(s(), fuzzy, q);
        negatives[q] = items.slice(0, 3).map((i) => `${i.name} [${i.tier}]`);
        if (['pokemon', 'zelda', 'mario kart'].includes(q)) {
          expect(
            items.filter((i) => i.tier <= Tier.title),
            q,
          ).toEqual([]);
        }
      }
      reports[engine] = { ...(reports[engine] as GateReport), negatives };
    });

    it('consultas de humo (§4.6)', SLOW, () => {
      const top = (q: string, k: number): number[] =>
        visibleList(s(), fuzzy, q)
          .slice(0, k)
          .map((i) => i.appid);
      expect(top('hollow knight', 1)).toEqual([367520]);
      expect(top('baldurs gate', 3)).toContain(1086940);
      expect(top('elden', 3)).toContain(1245620);
      expect(top('counter strike', 3)).toContain(730);
      expect(top('counter strike', 1)).toEqual([10]);
    });
  });
}

runGates('full');
runGates('scan');

describe('escaneo frente a índice', () => {
  it('dan la misma lista en el dorado, en nombres exactos y en prefijos', SLOW, () => {
    const queries = new Set<string>(golden.map((g) => g.q));
    const rnd = mulberry32(7);
    while (queries.size < 600) queries.add(names[Math.floor(rnd() * names.length)] as string);
    for (let g = 0; g < 1000; g++) {
      queries.add(
        Array.from(normalize(names[g] as string))
          .slice(0, 4)
          .join('')
          .trim(),
      );
    }
    const diffs: string[] = [];
    for (const q of queries) {
      for (const showAdult of [false, true]) {
        full.reset();
        scan.reset();
        const a = full.query(q, { showAdult, limit: 10 });
        const b = scan.query(q, { showAdult, limit: 10 });
        if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(q);
      }
    }
    console.log(`escaneo = índice en ${queries.size} consultas ×2: ${diffs.length} diferencias`);
    expect(diffs.slice(0, 10)).toEqual([]);
  });

  it('informe de calidad', SLOW, () => {
    console.log('calidad:', JSON.stringify(reports, null, 1));
  });
});

describe('tecleo realista (150 nombres, carácter a carácter)', () => {
  it('escaneo e índice coinciden en cada pulsación; tiempos en Node (informativo)', SLOW, () => {
    const seqs = typedSequences(realisticFinals(names));
    const out: Record<string, unknown> = { keystrokes: seqs.reduce((a, q) => a + q.length, 0) };
    const times: Record<'full' | 'scan', { cold: number[]; warm: number[] }> = {
      full: { cold: [], warm: [] },
      scan: { cold: [], warm: [] },
    };
    let diffs = 0;
    // Pasada 0 en frío y pasada 1 en caliente; las dos con el mismo orden que la paleta.
    for (let rep = 0; rep <= 1; rep++) {
      for (const seq of seqs) {
        full.reset();
        scan.reset();
        for (const q of seq) {
          let a = performance.now();
          const rf = full.query(q, { limit: 8 });
          const tf = performance.now() - a;
          a = performance.now();
          const rs = scan.query(q, { limit: 8 });
          const ts = performance.now() - a;
          times.full[rep === 0 ? 'cold' : 'warm'].push(tf);
          times.scan[rep === 0 ? 'cold' : 'warm'].push(ts);
          if (rep === 0 && JSON.stringify(rf) !== JSON.stringify(rs)) diffs++;
        }
      }
    }
    for (const k of ['full', 'scan'] as const) {
      out[k] = { cold: stats(times[k].cold), warm: stats(times[k].warm) };
    }
    // Nivel 4 diferido: la tarea entera, en las consultas que lo activan.
    const fz: number[] = [];
    const fzBlock: number[] = [];
    for (const q of [...golden.map((g) => g.q), ...realisticFinals(names)]) {
      const r = full.query(q);
      if (!canSuggest(q, r.strong)) continue;
      const a = performance.now();
      const task = full.suggest(q, fuzzy, { exclude: r.items.map((i) => i.appid) });
      for (;;) {
        const b = performance.now();
        const done = task.step();
        fzBlock.push(performance.now() - b);
        if (done) break;
      }
      fz.push(performance.now() - a);
    }
    out.fuzzyTask = stats(fz);
    out.fuzzyBlock = stats(fzBlock);
    console.log(`escaneo = índice en ${out.keystrokes} pulsaciones: ${diffs} diferencias`);
    console.log('latencias (ms, Node):', JSON.stringify(out));
    expect(diffs).toBe(0);
    expect(fz.length).toBeGreaterThan(0);
  });
});
