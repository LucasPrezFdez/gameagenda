// Informe de cobertura del CA1.1 (§15.4) frente al volcado público de `GetAppList`
// (`jsnli/steamappidlist`, solo en desarrollo: nunca se publica ni se versiona) y contraste con
// la copia congelada del 28-10-2026.

import { readFileSync } from 'node:fs';
import { CatalogFlag, type CoreCatalog } from '@gameagenda/core/catalog-format';
import { normalize } from '@gameagenda/core/normalize';
import { z } from 'zod';
import { cleanName, type Exclusion, type Game } from './derive.ts';
import type { Classified } from './get-items.ts';

const dumpSchema = z.array(z.object({ appid: z.int().positive(), name: z.string().nullish() }));

export interface DumpEntry {
  readonly appid: number;
  readonly name: string;
}

/** Lee el volcado (`games_appid.json`: `[{appid, name, last_modified, …}]`). */
export function readDump(path: string): DumpEntry[] {
  const rows = dumpSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  return rows.map((r) => ({ appid: r.appid, name: cleanName(r.name) }));
}

export interface MissingEntry {
  readonly appid: number;
  readonly name: string;
  readonly reason: string;
  readonly detail: string;
}

export interface CoverageReport {
  readonly dump: { entries: number; withName: number; emptyName: number };
  readonly core: number;
  readonly inCore: number;
  readonly missing: MissingEntry[];
  readonly byReason: Record<string, number>;
  /** Sin motivo: debe ser 0 (CA1.1). */
  readonly unexplained: number;
  /** Los del volcado sin nombre: completados (están en el núcleo con nombre) o excluidos. */
  readonly emptyNamed: { total: number; completed: number[]; excluded: Array<[number, string]> };
  /** Juegos del núcleo que no están en el volcado (informativo). */
  readonly notInDump: { count: number; sample: Array<[number, string]> };
  /** Mismo `appid` con otro nombre base: mide el nombre base del plan B. */
  readonly nameDiffs: { count: number; pct: number; sample: Array<[number, string, string]> };
}

/** Motivo de un juego del volcado que falta, con lo que dijo `GetItems`. */
function reasonOf(
  c: Classified | undefined,
  visibleByName: ReadonlyMap<string, number>,
  dumpName: string,
): { reason: string; detail: string } {
  if (!c) return { reason: 'unexplained', detail: 'sin clasificar' };
  const type = c.item?.type;
  if (type !== undefined && type !== 0) return { reason: 'not-game', detail: `type ${type}` };
  switch (c.cls) {
    case 'blocked': {
      const twin = visibleByName.get(normalize(dumpName));
      if (twin !== undefined) {
        return { reason: 'duplicate-sku', detail: `SKU regional de ${twin}, visible en ES` };
      }
      return { reason: 'blocked-es', detail: `${c.reason}; en M2 entra por H1` };
    }
    case 'retired':
      return { reason: 'retired', detail: `${c.reason}: retirado, fuera de Query` };
    case 'deleted':
      return { reason: 'deleted', detail: c.reason };
    case 'visible':
      return {
        reason: 'visible-not-in-query',
        detail: 'visible en GetItems (ES) pero no en Query',
      };
    default:
      return { reason: 'unknown', detail: c.reason };
  }
}

export function coverageReport(input: {
  readonly dump: readonly DumpEntry[];
  readonly games: readonly Game[];
  readonly excluded: readonly Exclusion[];
  /** `GetItems` (ES y US) de los juegos del volcado que no están en Q. */
  readonly classified: ReadonlyMap<number, Classified>;
}): CoverageReport {
  const { dump, games, excluded, classified } = input;
  const byAppid = new Map(games.map((g) => [g.appid, g]));
  const excludedBy = new Map(excluded.map((e) => [e.appid, e]));
  const visibleByName = new Map<string, number>();
  for (const g of games) {
    if (g.cls !== 'visible') continue;
    const k = normalize(g.name);
    if (!visibleByName.has(k)) visibleByName.set(k, g.appid);
  }
  const dumpIds = new Set<number>();
  const missing: MissingEntry[] = [];
  const completed: number[] = [];
  const excludedEmpty: Array<[number, string]> = [];
  const diffs: Array<[number, string, string]> = [];
  let withName = 0;
  let inCore = 0;
  let common = 0;
  for (const d of dump) {
    dumpIds.add(d.appid);
    const g = byAppid.get(d.appid);
    if (!d.name) {
      if (g) completed.push(d.appid);
      else excludedEmpty.push([d.appid, excludedBy.get(d.appid)?.reason ?? 'not-in-query']);
      continue;
    }
    withName++;
    if (g) {
      inCore++;
      common++;
      if (g.name !== d.name) diffs.push([d.appid, d.name, g.name]);
      continue;
    }
    const e = excludedBy.get(d.appid);
    const r = e
      ? { reason: e.reason, detail: e.detail }
      : reasonOf(classified.get(d.appid), visibleByName, d.name);
    missing.push({ appid: d.appid, name: d.name, ...r });
  }
  const byReason: Record<string, number> = {};
  for (const m of missing) byReason[m.reason] = (byReason[m.reason] ?? 0) + 1;
  const notInDump = games.filter((g) => !dumpIds.has(g.appid));
  return {
    dump: { entries: dump.length, withName, emptyName: dump.length - withName },
    core: games.length,
    inCore,
    missing,
    byReason,
    unexplained: byReason.unexplained ?? 0,
    emptyNamed: {
      total: completed.length + excludedEmpty.length,
      completed,
      excluded: excludedEmpty,
    },
    notInDump: {
      count: notInDump.length,
      sample: notInDump
        .slice()
        .sort((a, b) => a.appid - b.appid)
        .slice(0, 40)
        .map((g) => [g.appid, g.name]),
    },
    nameDiffs: {
      count: diffs.length,
      pct: common === 0 ? 0 : +((100 * diffs.length) / common).toFixed(3),
      sample: diffs.slice(0, 60),
    },
  };
}

/** Diferencias de un bit de `flags` entre dos versiones (sobre los juegos comunes). */
export interface FlagDiff {
  before: number;
  after: number;
  set: number;
  unset: number;
}

export interface FrozenDiff {
  readonly frozen: { version: string; count: number };
  readonly current: number;
  readonly common: number;
  readonly added: number;
  readonly removed: number;
  readonly removedSample: Array<[number, string]>;
  readonly renamed: { count: number; pct: number; sample: Array<[number, string, string]> };
  readonly nameEs: { before: number; after: number; changed: number };
  readonly flags: Record<string, FlagDiff>;
  readonly pop: { same: number; plusMinus1: number; more: number; meanDelta: number };
  readonly year: { changed: number };
}

/** Contraste del núcleo nuevo con la copia congelada (recuento, renombrados, `flags` y `pop`). */
export function frozenDiff(frozen: CoreCatalog, games: readonly Game[]): FrozenDiff {
  const before = new Map<number, number>();
  for (let g = 0; g < frozen.count; g++) before.set(frozen.appid[g] as number, g);
  const flags: Record<string, FlagDiff> = {};
  for (const name of Object.keys(CatalogFlag))
    flags[name] = { before: 0, after: 0, set: 0, unset: 0 };
  let common = 0;
  let renamed = 0;
  const renamedSample: Array<[number, string, string]> = [];
  let esBefore = 0;
  let esAfter = 0;
  let esChanged = 0;
  let popSame = 0;
  let pop1 = 0;
  let popMore = 0;
  let popDeltaSum = 0;
  let yearChanged = 0;
  const seen = new Set<number>();
  for (const g of games) {
    const i = before.get(g.appid);
    if (i === undefined) continue;
    seen.add(g.appid);
    common++;
    const name0 = frozen.name[i] as string;
    if (name0 !== g.name) {
      renamed++;
      if (renamedSample.length < 40) renamedSample.push([g.appid, name0, g.name]);
    }
    const es0 = frozen.nameEs.get(i) ?? '';
    if (es0) esBefore++;
    if (g.nameEs) esAfter++;
    if (es0 !== g.nameEs) esChanged++;
    const f0 = frozen.flags[i] as number;
    for (const [name, bit] of Object.entries(CatalogFlag)) {
      const d = flags[name] as FlagDiff;
      const a = (f0 & bit) !== 0;
      const b = (g.flags & bit) !== 0;
      if (a) d.before++;
      if (b) d.after++;
      if (!a && b) d.set++;
      if (a && !b) d.unset++;
    }
    const dp = g.pop - (frozen.pop[i] as number);
    popDeltaSum += dp;
    if (dp === 0) popSame++;
    else if (Math.abs(dp) === 1) pop1++;
    else popMore++;
    if ((frozen.year[i] as number) !== g.year) yearChanged++;
  }
  const removed: Array<[number, string]> = [];
  for (const [appid, i] of before)
    if (!seen.has(appid)) removed.push([appid, frozen.name[i] as string]);
  removed.sort((a, b) => a[0] - b[0]);
  return {
    frozen: { version: frozen.version, count: frozen.count },
    current: games.length,
    common,
    added: games.length - common,
    removed: removed.length,
    removedSample: removed.slice(0, 40),
    renamed: {
      count: renamed,
      pct: common === 0 ? 0 : +((100 * renamed) / common).toFixed(3),
      sample: renamedSample,
    },
    nameEs: { before: esBefore, after: esAfter, changed: esChanged },
    flags,
    pop: {
      same: popSame,
      plusMinus1: pop1,
      more: popMore,
      meanDelta: common === 0 ? 0 : +(popDeltaSum / common).toFixed(4),
    },
    year: { changed: yearChanged },
  };
}
