// Claves normalizadas por fila y comprobaciones de clave comunes al escaneo y al índice (§8.2).

import { CatalogFlag, type CoreCatalog } from '../catalog-format/tsv.ts';
import { articleLength } from '../normalize/index.ts';
import type { HaystackChunk } from './haystack.ts';
import type { CatalogItem, SearchItem, Tier } from './types.ts';

/** Lo que se calcula antes de poder buscar (estado `scan`) y comparten los dos motores. */
export interface KeyData {
  readonly cat: CoreCatalog;
  readonly n: number;
  /** Clave normalizada del nombre base, por fila. */
  readonly kBase: readonly string[];
  /** Longitud del artículo inicial de `kBase` (con su espacio), por fila. */
  readonly artLen: Uint8Array;
  /** Clave del nombre en español, solo si difiere de la base. */
  readonly kEs: ReadonlyMap<number, string>;
  /** `appid` ordenados y la fila de cada uno. */
  readonly sortedAppid: Uint32Array;
  readonly rowOfSorted: Uint32Array;
  /** Alias compacto → filas (ascendentes). */
  readonly aliasExact: ReadonlyMap<string, readonly number[]>;
  /** Fila → sus alias. */
  readonly aliasOf: ReadonlyMap<number, readonly string[]>;
  readonly haystack: readonly HaystackChunk[];
}

/** Fila de un `appid`, o -1. */
export function rowOfAppid(keys: KeyData, appid: number): number {
  const s = keys.sortedAppid;
  let lo = 0;
  let hi = s.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >>> 1;
    const v = s[m] as number;
    if (v < appid) lo = m + 1;
    else if (v > appid) hi = m - 1;
    else return keys.rowOfSorted[m] as number;
  }
  return -1;
}

function keyStarts(k: string, al: number, qn: string, qa: string): boolean {
  return k.startsWith(qn) || (al > 0 && k.startsWith(qa, al)) || (qa !== qn && k.startsWith(qa));
}

function keyEquals(k: string, al: number, qn: string, qa: string): boolean {
  return (
    k === qn ||
    (qa !== qn && k === qa) ||
    (al > 0 && k.length - al === qa.length && k.startsWith(qa, al))
  );
}

/** Nivel 1: la clave base o la española empiezan por la consulta (con o sin artículo). */
export function isTitleStart(keys: KeyData, g: number, qn: string, qa: string): boolean {
  if (keyStarts(keys.kBase[g] as string, keys.artLen[g] as number, qn, qa)) return true;
  const e = keys.kEs.get(g);
  return e !== undefined && keyStarts(e, articleLength(e), qn, qa);
}

/** Nivel 0 sin alias: clave base o española iguales a la consulta (con o sin artículo). */
export function isExact(keys: KeyData, g: number, qn: string, qa: string): boolean {
  if (keyEquals(keys.kBase[g] as string, keys.artLen[g] as number, qn, qa)) return true;
  const e = keys.kEs.get(g);
  return e !== undefined && keyEquals(e, articleLength(e), qn, qa);
}

/** `true` si la fila es de +18 y no se muestran. */
export function hiddenAdult(keys: KeyData, g: number, showAdult: boolean): boolean {
  return !showAdult && ((keys.cat.flags[g] as number) & CatalogFlag.adult) !== 0;
}

export function isRetired(keys: KeyData, g: number): boolean {
  return ((keys.cat.flags[g] as number) & CatalogFlag.retired) !== 0;
}

export function catalogItem(keys: KeyData, g: number): CatalogItem {
  const c = keys.cat;
  return {
    appid: c.appid[g] as number,
    name: c.name[g] as string,
    nameEs: c.nameEs.get(g) ?? null,
    year: (c.year[g] as number) || null,
    flags: c.flags[g] as number,
  };
}

export function searchItem(keys: KeyData, g: number, tier: Tier): SearchItem {
  return { ...catalogItem(keys, g), tier };
}
