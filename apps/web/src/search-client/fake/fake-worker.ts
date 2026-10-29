// Cliente falso en memoria: hace de Worker de búsqueda con el mini-catálogo, responde de forma
// asíncrona (con latencia configurable) y simula los estados `none` → `scan` → `full`.
import type {
  CatalogError,
  CatalogState,
  SearchTransport,
  StatusMessage,
  UiToWorkerMessage,
  WorkerToUiMessage,
} from '../protocol.ts';
import {
  browseFake,
  buildFakeIndex,
  findFake,
  matchExactFake,
  searchFake,
  suggestFake,
  toCoreGame,
} from './fake-engine.ts';
import { SAMPLE_ALIASES, SAMPLE_GAMES, type SampleGame } from './sample-catalog.ts';

/**
 * Cómo arranca el catálogo falso:
 * - `progressive`: `none` (0 % → 40 %) → `scan` → `full`, en menos de un segundo;
 * - `full`, `scan` o `none`: se queda en ese estado (`none` con un 40 %);
 * - `error`: `none` con un error que admite reintento; `retry` pasa a `progressive`.
 */
export type FakeBoot = 'progressive' | 'full' | 'scan' | 'none' | 'error';

export interface FakeSearchOptions {
  /** Retraso de cada respuesta, en ms (0: la siguiente tarea, como un `postMessage`). */
  readonly latencyMs?: number;
  readonly boot?: FakeBoot;
  readonly games?: readonly SampleGame[];
}

const VERSION = '20261028.1-fake';
const PROGRESSIVE_STEPS: ReadonlyArray<readonly [number, CatalogState, number]> = [
  [0, 'none', 0],
  [120, 'none', 0.4],
  [300, 'scan', 1],
  [650, 'full', 1],
];

export function createFakeSearchTransport(options: FakeSearchOptions = {}): SearchTransport {
  const latencyMs = options.latencyMs ?? 0;
  const index = buildFakeIndex(options.games ?? SAMPLE_GAMES, SAMPLE_ALIASES);
  const listeners = new Set<(message: WorkerToUiMessage) => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const views = new Map<string, ReturnType<typeof browseFake>>();
  let showAdult = false;
  let latestQuery = 0;
  let terminated = false;
  // El nivel 4 necesita el texto de su `seq`: el Worker real lo guarda igual.
  const lastQueryText = new Map<number, string>();

  function later(delay: number, task: () => void): void {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!terminated) task();
    }, delay);
    timers.add(timer);
  }

  function emit(message: WorkerToUiMessage): void {
    for (const listener of listeners) listener(message);
  }

  function reply(message: WorkerToUiMessage): void {
    later(latencyMs, () => emit(message));
  }

  function countVisible(): number {
    return browseFake(index, '', showAdult).length;
  }

  function status(state: CatalogState, progress: number, error: CatalogError | null = null) {
    const message: StatusMessage = {
      type: 'status',
      state,
      version: state === 'none' ? null : VERSION,
      count: state === 'none' ? 0 : countVisible(),
      progress,
      error,
    };
    emit(message);
  }

  function boot(mode: FakeBoot): void {
    switch (mode) {
      case 'progressive':
        for (const [delay, state, progress] of PROGRESSIVE_STEPS) {
          later(delay, () => status(state, progress));
        }
        return;
      case 'none':
        later(0, () => status('none', 0.4));
        return;
      case 'error':
        later(0, () => status('none', 0, { code: 'network', retryable: true }));
        return;
      default:
        later(0, () => status(mode, 1));
    }
  }

  function handle(message: UiToWorkerMessage): void {
    switch (message.type) {
      case 'init':
        showAdult = message.showAdult;
        boot(options.boot ?? 'progressive');
        return;
      case 'query': {
        latestQuery = Math.max(latestQuery, message.seq);
        const started = performance.now();
        const { items, strong } = searchFake(index, message.q, message.limit, showAdult);
        reply({
          type: 'results',
          seq: message.seq,
          items,
          strong,
          ms: performance.now() - started,
        });
        return;
      }
      case 'suggest': {
        // Como el nivel 4 del Worker real: si ya hay una consulta más nueva, se abandona.
        if (message.seq < latestQuery) return;
        const query = lastQueryText.get(message.seq);
        if (query === undefined) return;
        const items = suggestFake(index, query, showAdult);
        later(latencyMs, () => {
          if (message.seq >= latestQuery) emit({ type: 'suggestions', seq: message.seq, items });
        });
        return;
      }
      case 'options':
        showAdult = message.showAdult;
        views.clear();
        reply({ type: 'options', reqId: message.reqId });
        return;
      case 'browse': {
        const rows = browseFake(index, message.q, showAdult);
        views.set(message.viewId, rows);
        reply({ type: 'browse', reqId: message.reqId, count: rows.length });
        return;
      }
      case 'rows': {
        const rows = views.get(message.viewId) ?? [];
        const to = Math.min(message.to, message.from + 200);
        reply({ type: 'rows', reqId: message.reqId, items: rows.slice(message.from, to) });
        return;
      }
      case 'game': {
        const found = findFake(index, message.appid);
        reply({ type: 'game', reqId: message.reqId, game: found ? toCoreGame(found) : null });
        return;
      }
      case 'lookup': {
        const found = message.appids.flatMap((appid) => {
          const hit = findFake(index, appid);
          return hit ? [toCoreGame(hit)] : [];
        });
        const known = new Set(found.map((g) => g.appid));
        const missing = message.appids.filter((appid) => !known.has(appid));
        reply({ type: 'lookup', reqId: message.reqId, found, missing });
        return;
      }
      case 'matchExact':
        reply({
          type: 'matchExact',
          reqId: message.reqId,
          appids: matchExactFake(index, message.title),
        });
        return;
      case 'retry':
        reply({ type: 'retry', reqId: message.reqId });
        boot('progressive');
        return;
      case 'refresh':
        reply({ type: 'refresh', reqId: message.reqId });
    }
  }

  return {
    postMessage(message) {
      if (terminated) return;
      if (message.type === 'query') {
        lastQueryText.clear();
        lastQueryText.set(message.seq, message.q);
      }
      // Como un `postMessage`: nunca se atiende en la misma tarea.
      queueMicrotask(() => handle(structuredClone(message)));
    },
    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    terminate() {
      terminated = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      listeners.clear();
    },
  };
}
