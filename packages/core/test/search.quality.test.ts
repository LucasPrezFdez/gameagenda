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
} from '../src/search/index.ts';
import {
  evaluateExact,
  evaluateGolden,
  evaluateNegatives,
  evaluatePrefix,
  evaluateSmoke,
  QUALITY_THRESHOLDS,
} from '../src/search/quality.ts';
import {
  type GoldenQuery,
  mulberry32,
  readFrozen,
  readGolden,
  realisticFinals,
  stats,
  typedSequences,
  visibleList,
} from './helpers/frozen.ts';

const SLOW = { timeout: 240_000 };

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
      const { notTop1, ok: _, ...r } = evaluateGolden(s(), fuzzy, golden);
      reports[engine] = { ...(reports[engine] as GateReport), golden: r, notTop1 };
      expect(r.n).toBeGreaterThanOrEqual(QUALITY_THRESHOLDS.goldenMinQueries);
      expect(r.top1).toBeGreaterThanOrEqual(QUALITY_THRESHOLDS.goldenTop1);
      expect(r.top5).toBeGreaterThanOrEqual(QUALITY_THRESHOLDS.goldenTop5);
    });

    it('2 000 exactos al azar (semilla 42): ≥99 % en el top-5, con +18 visible', SLOW, () => {
      const r = evaluateExact(s(), names, appidAt);
      reports[engine] = { ...(reports[engine] as GateReport), exact2000: r.pct };
      expect(r.n).toBe(2000);
      expect(r.pct).toBeGreaterThanOrEqual(QUALITY_THRESHOLDS.exactTop5);
    });

    it(
      'prefijos de 4 letras de los 1 000 más populares: ≥90 % en el top-10, con +18 visible',
      SLOW,
      () => {
        const r = evaluatePrefix(s(), names, appidAt);
        reports[engine] = {
          ...(reports[engine] as GateReport),
          prefix4Top10: r.pct,
          prefix4Top8Visible: r.top8,
        };
        expect(r.n).toBe(1000);
        expect(r.pct).toBeGreaterThanOrEqual(QUALITY_THRESHOLDS.prefixTop10);
      },
    );

    it('negativas: «pokemon», «zelda» y «mario kart» sin resultados de nivel 0–1', SLOW, () => {
      const r = evaluateNegatives(s(), fuzzy, ['pokémon', 'fortnite', 'valorant']);
      reports[engine] = { ...(reports[engine] as GateReport), negatives: r.top3 };
      expect(r.failed).toEqual([]);
    });

    it('consultas de humo (§4.6)', SLOW, () => {
      const r = evaluateSmoke(s(), fuzzy);
      expect(r.checks.filter((c) => !c.ok)).toEqual([]);
      expect(r.checks.map((c) => c.q)).toEqual([
        'hollow knight',
        'baldurs gate',
        'elden',
        'counter strike',
      ]);
      // El 1.º de «counter strike» es la coincidencia exacta «Counter-Strike» (10).
      expect(visibleList(s(), fuzzy, 'counter strike')[0]?.appid).toBe(10);
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
