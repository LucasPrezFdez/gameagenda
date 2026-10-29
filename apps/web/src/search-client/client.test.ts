import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSearchClient, shouldSuggest } from './client.ts';
import type {
  SearchItem,
  SearchTransport,
  UiToWorkerMessage,
  WorkerToUiMessage,
} from './protocol.ts';

/** Transporte manual: la prueba decide cuándo responde el «Worker». */
function manualTransport() {
  const sent: UiToWorkerMessage[] = [];
  let listener: ((message: WorkerToUiMessage) => void) | null = null;
  const transport: SearchTransport = {
    postMessage: (message) => sent.push(message),
    listen(next) {
      listener = next;
      return () => {
        listener = null;
      };
    },
    terminate: () => undefined,
  };
  return {
    transport,
    sent,
    queries: () => sent.filter((m) => m.type === 'query'),
    emit: (message: WorkerToUiMessage) => listener?.(message),
  };
}

const item = (appid: number, name: string): SearchItem => ({
  appid,
  name,
  nameEs: null,
  year: 2020,
  flags: 0,
  tier: 1,
});

const full = {
  type: 'status',
  state: 'full',
  version: 'v',
  count: 3,
  progress: 1,
  error: null,
} as const;

describe('createSearchClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('mantiene como mucho una consulta en curso y envía solo el último texto', () => {
    const w = manualTransport();
    const client = createSearchClient(w.transport);
    w.emit(full);
    client.setQuery('h');
    client.setQuery('ha');
    client.setQuery('had');
    expect(w.queries()).toEqual([{ type: 'query', seq: 1, q: 'h', limit: 8 }]);

    w.emit({ type: 'results', seq: 1, items: [item(1, 'Hades')], strong: 1, ms: 0 });
    // Los resultados de seq 1 ya no son del texto actual: no se pintan.
    expect(client.getQueryState().results).toBeNull();
    expect(w.queries().at(-1)).toEqual({ type: 'query', seq: 3, q: 'had', limit: 8 });

    w.emit({ type: 'results', seq: 3, items: [item(2, 'Hades II')], strong: 1, ms: 0 });
    const state = client.getQueryState();
    expect(state.fresh).toBe(true);
    expect(state.results?.items[0]?.name).toBe('Hades II');
  });

  it('en `none` no consulta y lanza el texto pendiente al pasar a `scan`', () => {
    const w = manualTransport();
    const client = createSearchClient(w.transport);
    client.setQuery('elden');
    expect(w.queries()).toHaveLength(0);
    w.emit({ ...full, state: 'scan' });
    expect(w.queries()).toEqual([{ type: 'query', seq: 1, q: 'elden', limit: 8 }]);
  });

  it('waitForFresh espera al seq actual y cae a `null` tras el plazo', async () => {
    const w = manualTransport();
    const client = createSearchClient(w.transport);
    w.emit(full);
    client.setQuery('cel');
    const waiting = client.waitForFresh(500);
    w.emit({ type: 'results', seq: 1, items: [item(3, 'Celeste')], strong: 1, ms: 0 });
    await expect(waiting).resolves.toMatchObject({ seq: 1, fresh: true });

    client.setQuery('cele');
    const late = client.waitForFresh(500);
    vi.advanceTimersByTime(501);
    await expect(late).resolves.toBeNull();
  });

  it('pide sugerencias tras 150 ms sin teclear si hay pocos resultados fuertes', () => {
    const w = manualTransport();
    const client = createSearchClient(w.transport);
    w.emit(full);
    client.setQuery('hollow knigth');
    w.emit({ type: 'results', seq: 1, items: [], strong: 0, ms: 0 });
    expect(w.sent.some((m) => m.type === 'suggest')).toBe(false);
    vi.advanceTimersByTime(150);
    expect(w.sent.filter((m) => m.type === 'suggest')).toEqual([{ type: 'suggest', seq: 1 }]);
    w.emit({ type: 'suggestions', seq: 1, items: [item(367520, 'Hollow Knight')] });
    expect(client.getQueryState().suggestions?.items).toHaveLength(1);
  });

  it('empareja las respuestas por `reqId`', async () => {
    const w = manualTransport();
    const client = createSearchClient(w.transport);
    const count = client.browse('catalog', 'ha');
    const game = client.game(730);
    const [browse, gameRequest] = w.sent.filter((m) => m.type === 'browse' || m.type === 'game');
    if (gameRequest?.type !== 'game' || browse?.type !== 'browse')
      throw new Error('sin peticiones');
    w.emit({ type: 'game', reqId: gameRequest.reqId, game: null });
    w.emit({ type: 'browse', reqId: browse.reqId, count: 2 });
    await expect(count).resolves.toBe(2);
    await expect(game).resolves.toBeNull();
  });
});

describe('shouldSuggest', () => {
  it('exige menos de 5 fuertes y al menos 4 letras latinas', () => {
    expect(shouldSuggest('hollow', 0)).toBe(true);
    expect(shouldSuggest('hol', 0)).toBe(false);
    expect(shouldSuggest('hollow', 5)).toBe(false);
    expect(shouldSuggest('三国志三国', 0)).toBe(false);
  });
});
