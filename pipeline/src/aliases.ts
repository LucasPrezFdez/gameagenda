// Alias del catálogo (§8.5 y §7.6): lista curada más las siglas generadas de los ≈5 000 juegos
// con más reseñas; se descartan las siglas que son un artículo o una palabra común. Portado del
// prototipo medido (`docs/planificacion/prototipo-busqueda/src/catalog.mjs`).

import type { AliasPair } from '@gameagenda/core/catalog-format';
import {
  ARTICLES,
  compact,
  generateAcronyms,
  normalize,
  tokenize,
} from '@gameagenda/core/normalize';

/** Alias curados → `appid`; los que no estén en el núcleo se descartan (y se cuentan). */
export const CURATED: ReadonlyArray<readonly [alias: string, appid: number]> = [
  ['csgo', 730],
  ['ff7', 1462040],
  ['ff7', 39140],
  ['ff7', 2909400],
  ['ffvii', 1462040],
  ['ffvii', 39140],
  ['ff7remake', 1462040],
  ['ff7rebirth', 2909400],
  ['ff10', 359870],
  ['ffx', 359870],
  ['ff12', 595520],
  ['ff13', 292120],
  ['ff14', 39210],
  ['ffxiv', 39210],
  ['ff15', 637650],
  ['ffxv', 637650],
  ['ff16', 2515020],
  ['ffxvi', 2515020],
  ['ff9', 377840],
  ['ff8', 1026680],
  ['civ6', 289070],
  ['civ5', 8930],
  ['civ7', 1295660],
  ['aoe2', 813780],
  ['aoe4', 1466860],
  ['aoe3', 933110],
  ['re4', 2050650],
  ['re4', 254700],
  ['re2', 883710],
  ['re3', 952060],
  ['re8', 1196590],
  ['re7', 418370],
  ['tes5', 489830],
  ['tes5', 72850],
  ['tes4', 22330],
  ['fnaf', 319510],
  ['pvz', 3590],
  ['mhr', 1446780],
  ['poe', 238960],
  ['poe2', 2694490],
  ['tlou', 1888930],
  ['tlou2', 2531310],
  ['gow', 1593500],
  ['rdr', 2668510],
  ['kotor', 32370],
  ['bo3', 311210],
  ['gta5', 3240220],
  ['gtav', 3240220],
  ['lossims4', 1222670],
  ['sims4', 1222670],
];

/** Juegos con reseñas cuyas siglas se generan. */
export const ACRONYM_TOP = 5000;
/** Una sigla que es palabra en ≥20 nombres base se descarta («the», «war»…). */
export const COMMON_TOKEN_MIN = 20;

export interface AliasGame {
  readonly appid: number;
  readonly name: string;
  readonly reviews: number;
}

export interface AliasBuild {
  readonly pairs: AliasPair[];
  readonly generated: number;
  readonly curated: number;
  readonly dropped: number;
  /** Curados cuyo `appid` no está en el núcleo. */
  readonly missing: Array<readonly [string, number]>;
}

/** Alias de un núcleo ya ordenado por el rango estático. */
export function buildAliases(games: readonly AliasGame[]): AliasBuild {
  const freq = new Map<string, number>();
  for (const g of games) {
    for (const t of new Set(tokenize(normalize(g.name)))) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  const present = new Set(games.map((g) => g.appid));
  const gen: Array<[string, number]> = [];
  let dropped = 0;
  const top = games.filter((g) => g.reviews > 0).slice(0, ACRONYM_TOP);
  for (const g of top) {
    for (const a of generateAcronyms(g.name)) {
      if (ARTICLES.has(a) || (freq.get(a) ?? 0) >= COMMON_TOKEN_MIN) {
        dropped++;
        continue;
      }
      gen.push([a, g.appid]);
    }
  }
  const cur: Array<[string, number]> = [];
  const missing: Array<readonly [string, number]> = [];
  for (const [a, appid] of CURATED) {
    if (present.has(appid)) cur.push([compact(normalize(a)), appid]);
    else missing.push([a, appid]);
  }
  const seen = new Set<string>();
  const pairs: AliasPair[] = [];
  for (const [a, appid] of [...cur, ...gen]) {
    const k = `${a}\t${appid}`;
    if (seen.has(k)) continue;
    seen.add(k);
    pairs.push([a, appid]);
  }
  return { pairs, generated: gen.length, curated: cur.length, dropped, missing };
}
