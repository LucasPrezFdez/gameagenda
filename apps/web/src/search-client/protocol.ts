// Protocolo entre la interfaz y el Worker de búsqueda (ver §8.7 de prototipe.md).
// Lo implementa el Worker de búsqueda (`src/search-worker/`).

/** Estados del catálogo en el Worker (ver §8.8). `boot` llega en M3. */
export type CatalogState = 'none' | 'boot' | 'scan' | 'full';

/** Bits de la columna `flags` del núcleo (ver §7.6). */
export const GAME_FLAGS = {
  comingSoon: 1,
  earlyAccess: 2,
  adult: 4,
  free: 8,
  retired: 16,
  dateTba: 32,
} as const;

/** Fila del núcleo del catálogo tal como la ve la interfaz. */
export interface CoreGame {
  readonly appid: number;
  readonly name: string;
  /** Nombre en español; `null` si coincide con `name`. */
  readonly nameEs: string | null;
  readonly year: number | null;
  readonly flags: number;
}

/** Nivel de *ranking* que ha dado la fila (ver §8.4); −1 es un `appid:` explícito (§8.6). */
export type SearchTier = -1 | 0 | 1 | 2 | 3 | 4;

export interface SearchItem extends CoreGame {
  readonly tier: SearchTier;
}

export interface CatalogError {
  readonly code: string;
  readonly retryable: boolean;
}

/** Filtros del Catálogo por bits de `flags` (ver §9.1); +18 lo decide `options`. */
export interface BrowseFilters {
  /** Bits que deben estar todos. */
  readonly flagsAll?: number;
  /** Bits que no debe tener ninguno. */
  readonly flagsNone?: number;
}

// --- UI → Worker -----------------------------------------------------------

export interface InitMessage {
  readonly type: 'init';
  readonly catalogVersion: string | null;
  readonly showAdult: boolean;
}

export interface QueryMessage {
  readonly type: 'query';
  readonly seq: number;
  readonly q: string;
  readonly limit: number;
}

export interface SuggestMessage {
  readonly type: 'suggest';
  readonly seq: number;
}

/** Peticiones con `reqId`: la respuesta repite el `reqId` y el `type`. */
export interface RequestPayloads {
  options: { readonly showAdult: boolean };
  browse: { readonly viewId: string; readonly q: string; readonly filters: BrowseFilters };
  rows: { readonly viewId: string; readonly from: number; readonly to: number };
  game: { readonly appid: number };
  lookup: { readonly appids: readonly number[] };
  matchExact: { readonly title: string };
  retry: Record<never, never>;
  refresh: Record<never, never>;
}

export interface ReplyPayloads {
  options: Record<never, never>;
  browse: { readonly count: number };
  rows: { readonly items: readonly CoreGame[] };
  game: { readonly game: CoreGame | null };
  lookup: { readonly found: readonly CoreGame[]; readonly missing: readonly number[] };
  matchExact: { readonly appids: readonly number[] };
  retry: Record<never, never>;
  refresh: Record<never, never>;
}

export type RequestType = keyof RequestPayloads;

export type RequestMessage = {
  [K in RequestType]: { readonly type: K; readonly reqId: number } & RequestPayloads[K];
}[RequestType];

export type UiToWorkerMessage = InitMessage | QueryMessage | SuggestMessage | RequestMessage;

// --- Worker → UI -----------------------------------------------------------

export interface StatusMessage {
  readonly type: 'status';
  readonly state: CatalogState;
  readonly version: string | null;
  /** Juegos del catálogo (con +18 si `showAdult`). */
  readonly count: number;
  /** Progreso de la descarga o del índice, de 0 a 1. */
  readonly progress: number;
  readonly error: CatalogError | null;
}

export interface ResultsMessage {
  readonly type: 'results';
  readonly seq: number;
  readonly items: readonly SearchItem[];
  /** Cuántas filas son de los niveles 0–2. */
  readonly strong: number;
  /** Tiempo dentro del Worker. */
  readonly ms: number;
}

export interface SuggestionsMessage {
  readonly type: 'suggestions';
  readonly seq: number;
  /** Hasta 3 filas del nivel 4. */
  readonly items: readonly SearchItem[];
}

export type ReplyMessage = {
  [K in RequestType]: { readonly type: K; readonly reqId: number } & ReplyPayloads[K];
}[RequestType];

export interface ErrorReplyMessage {
  readonly type: 'error';
  readonly reqId: number;
  readonly code: string;
}

export type WorkerToUiMessage =
  | StatusMessage
  | ResultsMessage
  | SuggestionsMessage
  | ReplyMessage
  | ErrorReplyMessage;

/**
 * Control de los E2E: solo lo atiende el *build* del modo `e2e` (ver §12.3), nunca el de
 * producción. `hold` deja la construcción quieta en ese estado hasta recibir `hold: null`;
 * `failFirstLoad` hace que la próxima carga del catálogo falle como sin red.
 */
export interface TestControlMessage {
  readonly type: 'test';
  readonly hold?: 'none' | 'scan' | null;
  readonly failFirstLoad?: boolean;
}

/** Lo mínimo de un `Worker` que necesita el cliente: un `Worker` real ya lo cumple. */
export interface SearchTransport {
  postMessage(message: UiToWorkerMessage): void;
  /** Devuelve la función que quita el oyente. */
  listen(listener: (message: WorkerToUiMessage) => void): () => void;
  terminate(): void;
}

/** Adapta un `Worker` de módulo al transporte del cliente. */
export function workerTransport(worker: Worker): SearchTransport {
  return {
    postMessage: (message) => worker.postMessage(message),
    listen(listener) {
      const handler = (event: MessageEvent<WorkerToUiMessage>) => listener(event.data);
      worker.addEventListener('message', handler);
      return () => worker.removeEventListener('message', handler);
    },
    terminate: () => worker.terminate(),
  };
}
