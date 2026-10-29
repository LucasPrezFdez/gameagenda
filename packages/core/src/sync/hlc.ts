// HLC por campo (§7.4): `ms-contador-nodo`, 27 caracteres fijos que se comparan como texto.

export const HLC_PATTERN = /^\d{13}-[0-9a-f]{4}-[0-9a-z]{8}$/;
export const HLC_LENGTH = 27;
export const NODE_PATTERN = /^[0-9a-z]{8}$/;
export const MAX_COUNTER = 0xffff;
/** Mayor instante con 13 cifras (año 2286). */
export const MAX_HLC_MS = 9_999_999_999_999;
/** La importación rechaza las HLC más de 5 min por delante de `now + desfase`. */
export const MAX_DRIFT_MS = 5 * 60_000;
const NODE_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export interface HlcParts {
  ms: number;
  counter: number;
  node: string;
}

/** Lo que se guarda en `meta.hlcClock`. El nodo no: es aleatorio por sesión (pestaña). */
export interface HlcClockSnapshot {
  ms: number;
  counter: number;
  /** Desfase con el servidor en ms; vale 0 hasta M4. */
  offset: number;
}

export function isHlc(value: unknown): value is string {
  return typeof value === 'string' && HLC_PATTERN.test(value);
}

export function formatHlc({ ms, counter, node }: HlcParts): string {
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > MAX_HLC_MS) {
    throw new RangeError(`formatHlc: instante fuera de rango: ${ms}`);
  }
  if (!Number.isInteger(counter) || counter < 0 || counter > MAX_COUNTER) {
    throw new RangeError(`formatHlc: contador fuera de rango: ${counter}`);
  }
  if (!NODE_PATTERN.test(node)) throw new TypeError(`formatHlc: nodo no válido: ${node}`);
  return `${String(ms).padStart(13, '0')}-${counter.toString(16).padStart(4, '0')}-${node}`;
}

export function parseHlc(hlc: string): HlcParts | null {
  if (!isHlc(hlc)) return null;
  return {
    ms: Number(hlc.slice(0, 13)),
    counter: Number.parseInt(hlc.slice(14, 18), 16),
    node: hlc.slice(19),
  };
}

/** Parte física (ms UTC) de una HLC válida. */
export function hlcTime(hlc: string): number {
  const parts = parseHlc(hlc);
  if (parts === null) throw new TypeError(`hlcTime: HLC no válida: ${hlc}`);
  return parts.ms;
}

/** Instante ISO 8601 UTC de la parte física (para `deletedAt`). */
export function hlcToIso(hlc: string): string {
  return new Date(hlcTime(hlc)).toISOString();
}

/** La mayor HLC, o `''` si no hay ninguna. */
export function maxHlc(values: Iterable<string>): string {
  let max = '';
  for (const v of values) if (v > max) max = v;
  return max;
}

/** ¿Va más de `maxDriftMs` por delante de `nowMs + offsetMs`? */
export function isTooFarAhead(
  hlc: string,
  nowMs: number,
  offsetMs = 0,
  maxDriftMs = MAX_DRIFT_MS,
): boolean {
  return hlcTime(hlc) > nowMs + offsetMs + maxDriftMs;
}

/** Nodo de 8 caracteres `[0-9a-z]` a partir de un generador en [0, 1). */
export function randomNode(random: () => number): string {
  let node = '';
  for (let i = 0; i < 8; i++) {
    const r = random();
    if (!(r >= 0 && r < 1)) throw new RangeError(`randomNode: valor fuera de [0, 1): ${r}`);
    node += NODE_ALPHABET.charAt(Math.floor(r * NODE_ALPHABET.length));
  }
  return node;
}

function overflow(ms: number, counter: number, node: string): HlcParts {
  // Tras `ffff`, el contador vuelve a 0 y el instante avanza 1 ms.
  return counter > MAX_COUNTER ? { ms: ms + 1, counter: 0, node } : { ms, counter, node };
}

/** Evento local: `ms = max(ms, ahora)` y, si no avanza, contador + 1. */
export function tickHlc(state: HlcParts, wallMs: number): HlcParts {
  const ms = Math.max(state.ms, Math.floor(wallMs));
  if (ms === state.ms) return overflow(ms, state.counter + 1, state.node);
  return { ms, counter: 0, node: state.node };
}

/** Recepción de una HLC remota (algoritmo estándar de Kulkarni et al., 2014). */
export function receiveHlc(state: HlcParts, remote: HlcParts, wallMs: number): HlcParts {
  const ms = Math.max(state.ms, remote.ms, Math.floor(wallMs));
  let counter = 0;
  if (ms === state.ms && ms === remote.ms) counter = Math.max(state.counter, remote.counter) + 1;
  else if (ms === state.ms) counter = state.counter + 1;
  else if (ms === remote.ms) counter = remote.counter + 1;
  return overflow(ms, counter, state.node);
}

export interface HlcClock {
  readonly node: string;
  readonly offset: number;
  /** HLC nueva para una acción local (todas sus operaciones la comparten). */
  next(): string;
  /** Avanza el reloj tras fusionar operaciones ajenas (importación o sincronización). */
  receive(hlc: string): void;
  /** Estado serializable para `meta.hlcClock`. */
  snapshot(): HlcClockSnapshot;
}

export interface HlcClockOptions {
  /** Reloj de pared en ms (`Date.now` en la web). */
  now: () => number;
  /** Nodo aleatorio de la sesión: ver `randomNode`. */
  node: string;
  /** Lo guardado en `meta.hlcClock`, si lo hay. */
  snapshot?: HlcClockSnapshot | null;
}

export function createHlcClock({ now, node, snapshot }: HlcClockOptions): HlcClock {
  if (!NODE_PATTERN.test(node)) throw new TypeError(`createHlcClock: nodo no válido: ${node}`);
  const offset = snapshot?.offset ?? 0;
  let state: HlcParts = { ms: snapshot?.ms ?? 0, counter: snapshot?.counter ?? 0, node };
  return {
    node,
    offset,
    next() {
      state = tickHlc(state, now() + offset);
      return formatHlc(state);
    },
    receive(hlc) {
      const remote = parseHlc(hlc);
      if (remote === null) throw new TypeError(`receive: HLC no válida: ${hlc}`);
      state = receiveHlc(state, remote, now() + offset);
    },
    snapshot() {
      return { ms: state.ms, counter: state.counter, offset };
    },
  };
}
