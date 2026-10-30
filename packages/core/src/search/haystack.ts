// Pajar compacto (§8.3): las claves sin espacios, concatenadas por bloques de filas. Cada bloque
// tiene una parte de 1 byte/carácter (≤U+00FF) y otra para el resto, para que `indexOf` recorra
// cadenas de un byte. Lo usan el nivel 3 y el escaneo de M1.

/** Registros de un bloque: `text` = claves unidas con `\n`; `offs[i]` = inicio del registro i. */
export interface HaystackPart {
  readonly text: string;
  readonly offs: Uint32Array;
  readonly rows: Uint32Array;
}

export interface HaystackChunk {
  readonly narrow: HaystackPart;
  readonly wide: HaystackPart;
}

/** Filas por bloque del pajar. */
export const HAYSTACK_CHUNK_ROWS = 4096;

function isWide(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 255) return true;
  return false;
}

function makePart(keys: string[], rows: number[]): HaystackPart {
  // Los espacios se quitan de una vez en el texto del bloque: es mucho más barato que crear una
  // clave compacta por fila. Cada registro acaba en `\n`, que ninguna clave normalizada contiene.
  const text = keys.length ? `${keys.join('\n')}\n`.replaceAll(' ', '') : '';
  const offs = new Uint32Array(keys.length + 1);
  let pos = 0;
  for (let r = 1; r <= keys.length; r++) {
    pos = text.indexOf('\n', pos) + 1;
    offs[r] = pos;
  }
  return { text, offs, rows: Uint32Array.from(rows) };
}

/** Acumula los registros de un bloque, en orden de filas. */
export class HaystackChunkBuilder {
  private narrowKeys: string[] = [];
  private narrowRows: number[] = [];
  private wideKeys: string[] = [];
  private wideRows: number[] = [];

  /** Añade la clave normalizada `key` (con espacios; el bloque guarda su forma compacta). */
  add(key: string, row: number): void {
    if (isWide(key)) {
      this.wideKeys.push(key);
      this.wideRows.push(row);
    } else {
      this.narrowKeys.push(key);
      this.narrowRows.push(row);
    }
  }

  finish(): HaystackChunk {
    const chunk = {
      narrow: makePart(this.narrowKeys, this.narrowRows),
      wide: makePart(this.wideKeys, this.wideRows),
    };
    this.narrowKeys = [];
    this.narrowRows = [];
    this.wideKeys = [];
    this.wideRows = [];
    return chunk;
  }
}

/** Registro que contiene la posición `pos` (búsqueda binaria sobre `offs`). */
function recordAt(part: HaystackPart, pos: number): number {
  const offs = part.offs;
  let lo = 0;
  let hi = offs.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if ((offs[mid] as number) <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Recorre en orden de filas, sin repetir, las filas cuya clave compacta contiene `pattern`.
 * Mezcla las dos partes de cada bloque y avanza bloque a bloque.
 */
export class PatternCursor {
  private chunk = -1;
  private narrowFrom = 0;
  private wideFrom = 0;
  private narrowNext = -1;
  private wideNext = -1;
  private last = -1;
  private readonly chunks: readonly HaystackChunk[];
  private readonly pattern: string;
  private readonly wideOnly: boolean;

  constructor(chunks: readonly HaystackChunk[], pattern: string) {
    this.chunks = chunks;
    this.pattern = pattern;
    this.wideOnly = isWide(pattern);
    this.nextChunk();
  }

  private nextChunk(): void {
    this.chunk++;
    this.narrowFrom = 0;
    this.wideFrom = 0;
    const c = this.chunks[this.chunk];
    if (!c) {
      this.narrowNext = -1;
      this.wideNext = -1;
      return;
    }
    this.narrowNext = this.wideOnly ? -1 : this.advance(c.narrow, true);
    this.wideNext = this.advance(c.wide, false);
  }

  private advance(part: HaystackPart, narrow: boolean): number {
    const from = narrow ? this.narrowFrom : this.wideFrom;
    const pos = part.text.indexOf(this.pattern, from);
    if (pos < 0) {
      if (narrow) this.narrowFrom = part.text.length;
      else this.wideFrom = part.text.length;
      return -1;
    }
    const rec = recordAt(part, pos);
    const nextFrom = part.offs[rec + 1] as number;
    if (narrow) this.narrowFrom = nextFrom;
    else this.wideFrom = nextFrom;
    return part.rows[rec] as number;
  }

  /** Siguiente fila (estrictamente creciente) o -1 al terminar. */
  next(): number {
    for (;;) {
      const c = this.chunks[this.chunk];
      if (!c) return -1;
      let g: number;
      if (this.narrowNext < 0 && this.wideNext < 0) {
        this.nextChunk();
        continue;
      }
      if (this.wideNext < 0 || (this.narrowNext >= 0 && this.narrowNext <= this.wideNext)) {
        g = this.narrowNext;
        this.narrowNext = this.advance(c.narrow, true);
      } else {
        g = this.wideNext;
        this.wideNext = this.advance(c.wide, false);
      }
      if (g !== this.last) {
        this.last = g;
        return g;
      }
    }
  }
}

/** Las primeras `cap` filas (ascendentes) cuya clave compacta contiene `pattern`. */
export function rowsContaining(
  chunks: readonly HaystackChunk[],
  pattern: string,
  cap: number,
): number[] {
  const out: number[] = [];
  const cursor = new PatternCursor(chunks, pattern);
  while (out.length < cap) {
    const g = cursor.next();
    if (g < 0) break;
    out.push(g);
  }
  return out;
}
