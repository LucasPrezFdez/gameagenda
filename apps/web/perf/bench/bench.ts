// Página de prueba de `npm run perf`, parte 1 (§8.9 y §12.4): la búsqueda de `packages/core`
// (lectura del núcleo, índice y *ranking*) en el hilo principal, para poder estrangularla con
// CDP (`Emulation.setCPUThrottlingRate` no llega a los Workers dedicados). Usa el mismo
// `createSearchHost` y el mismo `createCatalogStore` que el Worker de búsqueda, con un
// planificador de `MessageChannel` como el suyo, sobre el catálogo de `/catalog-dev/`.
//
// No entra en el *build* de producción: tiene su propio `vite.config.ts` y sale en `dist-perf/`.
// La prueba (`perf/search.perf.ts`) llama a `globalThis.gaPerfBench` paso a paso, para fijar el
// estrangulamiento entre pasos.
import { latencyStats, realisticFinals, typedSequences } from '@gameagenda/core/bench';
import { parseCore } from '@gameagenda/core/catalog-format';
import { canSuggest, loadFuzzy } from '@gameagenda/core/search';
import golden from '../../../../packages/core/test/golden.es.tsv?raw';
import type {
  ResultsMessage,
  StatusMessage,
  WorkerToUiMessage,
} from '../../src/search-client/protocol.ts';
import { createCatalogStore } from '../../src/search-worker/catalog-store.ts';
import { createSearchHost, type SearchHost } from '../../src/search-worker/host.ts';
import type { BenchApi, TypingReport } from '../bench-api.ts';

export const BENCH_MARKER = 'gameagenda-perf-bench';

const store = createCatalogStore({
  fetch: (input, init) => fetch(input, init),
  caches: 'caches' in globalThis ? globalThis.caches : null,
  subtle: crypto.subtle,
  baseUrl: new URL('/catalog-dev/', location.origin).href,
  appVersion: '0.0.0',
});

interface Bench {
  readonly host: SearchHost;
  /** Cierra el planificador: el host anterior deja de trabajar y se puede liberar. */
  dispose(): void;
  status: StatusMessage | null;
  hold: 'scan' | null;
  /** Momento de `init` y de los primeros `status` en `scan` y en `full`. */
  readonly startedAt: number;
  scanAt: number | null;
  fullAt: number | null;
  readonly listeners: Set<(message: WorkerToUiMessage) => void>;
}

let current: Bench | null = null;
let names: readonly string[] = [];
let seq = 0;

function log(line: string): void {
  const out = document.getElementById('log');
  if (out) out.textContent += `${line}\n`;
}

/** Un `createSearchHost` en el hilo principal, como el del Worker (`src/search-worker/index.ts`). */
function createBench(hold: 'scan' | null): Bench {
  const tasks: Array<() => void> = [];
  const channel = new MessageChannel();
  channel.port1.onmessage = () => tasks.shift()?.();
  const listeners = new Set<(message: WorkerToUiMessage) => void>();
  const bench: Bench = {
    host: createSearchHost({
      post(message) {
        if (message.type === 'status') {
          bench.status = message;
          const now = performance.now();
          if (message.state === 'scan' && bench.scanAt === null) bench.scanAt = now;
          if (message.state === 'full' && bench.fullAt === null) {
            bench.fullAt = now;
            bench.scanAt ??= now;
          }
        }
        for (const listener of listeners) listener(message);
      },
      now: () => performance.now(),
      schedule(task) {
        tasks.push(task);
        channel.port2.postMessage(null);
      },
      store,
      loadFuzzy,
      testHooks: { hold: () => bench.hold, beforeLoad() {} },
    }),
    dispose() {
      tasks.length = 0;
      channel.port1.close();
      channel.port2.close();
    },
    status: null,
    hold,
    startedAt: performance.now(),
    scanAt: null,
    fullAt: null,
    listeners,
  };
  return bench;
}

function waitFor<T extends WorkerToUiMessage>(
  bench: Bench,
  match: (message: WorkerToUiMessage) => message is T,
  timeoutMs = 300_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bench.listeners.delete(listener);
      reject(new Error('El banco de pruebas no ha respondido a tiempo'));
    }, timeoutMs);
    const listener = (message: WorkerToUiMessage) => {
      if (!match(message)) return;
      clearTimeout(timer);
      bench.listeners.delete(listener);
      resolve(message);
    };
    bench.listeners.add(listener);
  });
}

const isState =
  (state: 'scan' | 'full') =>
  (m: WorkerToUiMessage): m is StatusMessage =>
    m.type === 'status' && (m.state === state || (state === 'scan' && m.state === 'full'));

/** Cede el turno: el `MessageChannel` del host y el de la página siguen su curso. */
const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function goldenQueries(): string[] {
  return golden
    .split('\n')
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('query\t'))
    .map((line) => line.split('\t')[0] as string);
}

const round = (ms: number) => Math.round(ms * 100) / 100;

const api: BenchApi = {
  marker: BENCH_MARKER,

  /** Primera visita, sin medir: guarda el catálogo en Cache Storage (`gacat-<versión>`). */
  async prime(): Promise<{ version: string; count: number }> {
    const manifest = await store.fetchManifest();
    const texts = await store.download(manifest);
    names = parseCore(texts.core).name;
    log(`catálogo ${manifest.version}: ${names.length} juegos en Cache Storage`);
    return { version: manifest.version, count: names.length };
  },

  /**
   * Reinicio con caché (CA1.11): un host nuevo lee el catálogo de Cache Storage y lo indexa.
   * Con `hold: 'scan'` se queda en el puente de escaneo hasta `release()`.
   */
  async restart(hold: 'scan' | null): Promise<{ scanMs: number; fullMs: number | null }> {
    current?.dispose();
    current = null;
    await yieldTask();
    const bench = createBench(hold);
    current = bench;
    const ready = waitFor(bench, isState(hold ?? 'full'));
    bench.host.handle({ type: 'init', catalogVersion: null, showAdult: false });
    await ready;
    const scanMs = round((bench.scanAt as number) - bench.startedAt);
    const fullMs = bench.fullAt === null ? null : round(bench.fullAt - bench.startedAt);
    log(`reinicio con caché: scan ${scanMs} ms, full ${fullMs ?? '—'} ms`);
    return { scanMs, fullMs };
  },

  /** Suelta el escaneo y espera al índice completo. */
  async release(): Promise<{ fullMs: number }> {
    const bench = current;
    if (!bench) throw new Error('Sin banco de pruebas');
    bench.hold = null;
    const full = waitFor(bench, isState('full'));
    bench.host.resume();
    await full;
    return { fullMs: round((bench.fullAt as number) - bench.startedAt) };
  },

  /**
   * Conjunto realista tecleado carácter a carácter (2 084 pulsaciones): tiempo de cada
   * `query` hasta su `results`, en el estado en que esté el host. Con `fuzzy`, además, el
   * nivel 4 entero (todos sus bloques, cediendo el turno entre ellos como el Worker) en las
   * consultas finales y del conjunto dorado que lo activan.
   */
  async type(options: { fuzzy: boolean }): Promise<TypingReport> {
    const bench = current;
    if (!bench) throw new Error('Sin banco de pruebas');
    const state = bench.status?.state ?? 'none';
    const finals = realisticFinals(names);
    const seqs = typedSequences(finals);
    const keystrokes: number[] = [];
    let last: ResultsMessage | null = null;
    const onResults = (m: WorkerToUiMessage) => {
      if (m.type === 'results') last = m;
    };
    bench.listeners.add(onResults);
    for (const typed of seqs) {
      for (const q of typed) {
        seq += 1;
        const started = performance.now();
        bench.host.handle({ type: 'query', seq, q, limit: 8 });
        const elapsed = performance.now() - started;
        if ((last as ResultsMessage | null)?.seq !== seq)
          throw new Error(`Sin results para «${q}»`);
        keystrokes.push(elapsed);
      }
      // Entre nombres la paleta se vacía (sin consulta): se cede el turno.
      await yieldTask();
    }
    bench.listeners.delete(onResults);

    const suggest: number[] = [];
    if (options.fuzzy) {
      const ask = async (q: string): Promise<number | null> => {
        seq += 1;
        const mySeq = seq;
        let strong = 0;
        const read = (m: WorkerToUiMessage) => {
          if (m.type === 'results' && m.seq === mySeq) strong = m.strong;
        };
        bench.listeners.add(read);
        bench.host.handle({ type: 'query', seq: mySeq, q, limit: 8 });
        bench.listeners.delete(read);
        if (!canSuggest(q, strong)) return null;
        const done = waitFor(
          bench,
          (m): m is WorkerToUiMessage => m.type === 'suggestions' && m.seq === mySeq,
        );
        const started = performance.now();
        bench.host.handle({ type: 'suggest', seq: mySeq });
        await done;
        return performance.now() - started;
      };
      // Calentamiento: el primer nivel 4 carga uFuzzy (`import()` diferido).
      await ask('hollow knigth');
      for (const q of [...goldenQueries(), ...finals]) {
        const ms = await ask(q);
        if (ms !== null) suggest.push(ms);
      }
    }
    const report: TypingReport = {
      state,
      keystrokes: latencyStats(keystrokes),
      over16: keystrokes.filter((ms) => ms > 16).length,
      over50: keystrokes.filter((ms) => ms > 50).length,
      suggest: latencyStats(suggest),
    };
    log(`tecleo en ${state}: ${JSON.stringify(report)}`);
    return report;
  },
};

globalThis.gaPerfBench = api;
document.title = `${document.title} (${BENCH_MARKER})`;
