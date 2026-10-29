// Cliente de búsqueda del hilo principal (ver §8.7). Reglas:
// - `seq` crece en cada cambio del campo y solo se pintan los `results` del `seq` actual;
// - como mucho una consulta en curso: mientras tanto se guarda solo el último texto (sin *debounce*);
// - Intro espera hasta 500 ms a los resultados del `seq` actual (`waitForFresh`).
import type {
  CatalogState,
  CoreGame,
  ReplyPayloads,
  RequestMessage,
  RequestPayloads,
  RequestType,
  ResultsMessage,
  SearchTransport,
  StatusMessage,
  SuggestionsMessage,
  WorkerToUiMessage,
} from './protocol.ts';

export interface QueryState {
  /** `seq` del último cambio del campo. */
  readonly seq: number;
  readonly text: string;
  /** `event.timeStamp` del `input` que creó `seq` (para `search:keystroke-to-results`). */
  readonly inputTimeStamp: number | null;
  /** Últimos resultados pintables: eran del `seq` actual cuando llegaron. */
  readonly results: ResultsMessage | null;
  /** Sugerencias del nivel 4 para `results.seq`. */
  readonly suggestions: SuggestionsMessage | null;
  /** `true` si `results` es del `seq` actual. */
  readonly fresh: boolean;
}

export interface InitParams {
  readonly catalogVersion: string | null;
  readonly showAdult: boolean;
}

export interface SearchClient {
  init(params: InitParams): void;
  getStatus(): StatusMessage;
  subscribeStatus(listener: () => void): () => void;
  /** Cambio del campo de la paleta; devuelve el `seq` nuevo. */
  setQuery(text: string, inputTimeStamp?: number): number;
  getQueryState(): QueryState;
  subscribeQuery(listener: () => void): () => void;
  /** Espera a los resultados del `seq` actual; `null` si no llegan a tiempo o cambia el texto. */
  waitForFresh(timeoutMs: number): Promise<QueryState | null>;
  setOptions(showAdult: boolean): Promise<void>;
  browse(
    viewId: string,
    q: string,
    filters?: RequestPayloads['browse']['filters'],
  ): Promise<number>;
  rows(viewId: string, from: number, to: number): Promise<readonly CoreGame[]>;
  game(appid: number): Promise<CoreGame | null>;
  lookup(appids: readonly number[]): Promise<ReplyPayloads['lookup']>;
  matchExact(title: string): Promise<readonly number[]>;
  retry(): Promise<void>;
  refresh(): Promise<void>;
  dispose(): void;
}

export interface SearchClientOptions {
  /** Filas que pide la paleta (ver §8.4). */
  readonly limit?: number;
  /** Pausa sin teclear antes de pedir el nivel 4 (ver §8.4). */
  readonly suggestDelayMs?: number;
}

export const PALETTE_LIMIT = 8;
export const SUGGEST_DELAY_MS = 150;
/** Las sugerencias solo se piden si los niveles 0–2 dan menos que esto. */
export const SUGGEST_BELOW_STRONG = 5;
export const SUGGEST_MIN_LATIN = 4;

const INITIAL_STATUS: StatusMessage = {
  type: 'status',
  state: 'none',
  version: null,
  count: 0,
  progress: 0,
  error: null,
};

/** En `none` el Worker no puede buscar: la paleta busca en Mi lista (ver §8.8). */
export function canSearchCatalog(state: CatalogState): boolean {
  return state !== 'none';
}

const LATIN = /\p{Script=Latin}/gu;

/** ¿Merece la pena pedir el nivel 4 para este texto y estos resultados? */
export function shouldSuggest(text: string, strong: number): boolean {
  if (strong >= SUGGEST_BELOW_STRONG) return false;
  return (text.match(LATIN)?.length ?? 0) >= SUGGEST_MIN_LATIN;
}

interface Pending {
  resolve(value: unknown): void;
  reject(reason: Error): void;
}

interface Waiter {
  readonly seq: number;
  resolve(state: QueryState | null): void;
}

export function createSearchClient(
  transport: SearchTransport,
  options: SearchClientOptions = {},
): SearchClient {
  const limit = options.limit ?? PALETTE_LIMIT;
  const suggestDelayMs = options.suggestDelayMs ?? SUGGEST_DELAY_MS;

  let status = INITIAL_STATUS;
  const statusListeners = new Set<() => void>();

  let seq = 0;
  let text = '';
  let inputTimeStamp: number | null = null;
  let results: ResultsMessage | null = null;
  let suggestions: SuggestionsMessage | null = null;
  let inFlight: number | null = null;
  let lastSent = 0;
  let suggestRequested = 0;
  let idleSince = 0;
  let suggestTimer: ReturnType<typeof setTimeout> | undefined;
  let queryState = snapshot();
  const queryListeners = new Set<() => void>();
  const waiters = new Set<Waiter>();

  let nextReqId = 0;
  const pending = new Map<number, Pending>();

  function snapshot(): QueryState {
    return {
      seq,
      text,
      inputTimeStamp,
      results,
      suggestions,
      fresh: results !== null && results.seq === seq,
    };
  }

  function emitQuery(): void {
    queryState = snapshot();
    for (const listener of queryListeners) listener();
  }

  function isBlank(value: string): boolean {
    return value.trim() === '';
  }

  /** Envía el último texto si no hay otra consulta en curso. */
  function pump(): void {
    if (inFlight !== null || !canSearchCatalog(status.state)) return;
    if (isBlank(text) || lastSent === seq) return;
    inFlight = seq;
    lastSent = seq;
    transport.postMessage({ type: 'query', seq, q: text, limit });
  }

  function maybeSuggest(): void {
    if (results === null || results.seq !== seq || suggestRequested === seq) return;
    if (performance.now() - idleSince < suggestDelayMs) return;
    if (!shouldSuggest(text, results.strong)) return;
    suggestRequested = seq;
    transport.postMessage({ type: 'suggest', seq });
  }

  function settleWaiters(): void {
    for (const waiter of waiters) {
      if (waiter.seq !== seq) {
        waiters.delete(waiter);
        waiter.resolve(null);
      } else if (queryState.fresh) {
        waiters.delete(waiter);
        waiter.resolve(queryState);
      }
    }
  }

  function onMessage(message: WorkerToUiMessage): void {
    switch (message.type) {
      case 'status': {
        const wasSearchable = canSearchCatalog(status.state);
        status = message;
        for (const listener of statusListeners) listener();
        if (!wasSearchable && canSearchCatalog(status.state)) {
          // La consulta escrita antes de tener catálogo se lanza ahora (CA1.11).
          inFlight = null;
          lastSent = 0;
          pump();
        }
        return;
      }
      case 'results': {
        if (message.seq === inFlight) inFlight = null;
        if (message.seq === seq) {
          results = message;
          suggestions = null;
          emitQuery();
          settleWaiters();
          maybeSuggest();
        }
        pump();
        return;
      }
      case 'suggestions': {
        if (message.seq === seq && results?.seq === seq) {
          suggestions = message;
          emitQuery();
        }
        return;
      }
      case 'error': {
        const request = pending.get(message.reqId);
        pending.delete(message.reqId);
        request?.reject(new Error(message.code));
        return;
      }
      default: {
        const request = pending.get(message.reqId);
        pending.delete(message.reqId);
        request?.resolve(message);
      }
    }
  }

  function setQuery(nextText: string, timeStamp?: number): number {
    seq += 1;
    text = nextText;
    inputTimeStamp = timeStamp ?? performance.now();
    idleSince = performance.now();
    if (isBlank(nextText)) {
      results = null;
      suggestions = null;
    }
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(maybeSuggest, suggestDelayMs);
    emitQuery();
    settleWaiters();
    pump();
    return seq;
  }

  const unlisten = transport.listen(onMessage);

  function request<K extends RequestType>(
    type: K,
    payload: RequestPayloads[K],
  ): Promise<ReplyPayloads[K]> {
    nextReqId += 1;
    const reqId = nextReqId;
    return new Promise<ReplyPayloads[K]>((resolve, reject) => {
      pending.set(reqId, { resolve: resolve as (value: unknown) => void, reject });
      // El tipo de unión no se puede comprobar con un `K` genérico.
      transport.postMessage({ type, reqId, ...payload } as RequestMessage);
    });
  }

  return {
    init(params) {
      transport.postMessage({ type: 'init', ...params });
    },
    getStatus: () => status,
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    setQuery,
    getQueryState: () => queryState,
    subscribeQuery(listener) {
      queryListeners.add(listener);
      return () => queryListeners.delete(listener);
    },
    waitForFresh(timeoutMs) {
      if (queryState.fresh) return Promise.resolve(queryState);
      return new Promise((resolve) => {
        const waiter: Waiter = {
          seq,
          resolve(state) {
            clearTimeout(timer);
            resolve(state);
          },
        };
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          resolve(null);
        }, timeoutMs);
        waiters.add(waiter);
      });
    },
    async setOptions(showAdult) {
      await request('options', { showAdult });
      // Los resultados visibles pueden incluir o excluir +18: se repite la consulta.
      if (!isBlank(text)) setQuery(text);
    },
    async browse(viewId, q, filters = {}) {
      return (await request('browse', { viewId, q, filters })).count;
    },
    async rows(viewId, from, to) {
      return (await request('rows', { viewId, from, to })).items;
    },
    async game(appid) {
      return (await request('game', { appid })).game;
    },
    lookup: (appids) => request('lookup', { appids }),
    async matchExact(title) {
      return (await request('matchExact', { title })).appids;
    },
    async retry() {
      await request('retry', {});
    },
    async refresh() {
      await request('refresh', {});
    },
    dispose() {
      clearTimeout(suggestTimer);
      unlisten();
      transport.terminate();
      for (const waiter of waiters) waiter.resolve(null);
      waiters.clear();
      for (const request of pending.values()) request.reject(new Error('disposed'));
      pending.clear();
    },
  };
}
