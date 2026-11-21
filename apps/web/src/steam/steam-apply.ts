// La parte 3 de «Importar desde Steam» en la app (Fase 2; §10.1; ADR-012; DECISIONES §10.50):
// los logros, el plan y aplicarlo. Va en su propio *chunk* (con Zod y la parte de core), que el
// flujo pide al tener la biblioteca, como `steam-library.ts`.
//
// - Los logros solo se preguntan por los juegos jugados con estadísticas en Steam, y no por los que
//   ya son Platinado en la agenda.
// - Software (DECISIONES §10.57): se pregunta a la micro-API por lo de la biblioteca que no está
//   en el catálogo (que solo tiene juegos); lo que la tienda da como software va a Software y no se
//   le preguntan los logros.
// - El plan lo hace `planSteamImport` de core con lo que decidió el usuario; aquí se le dan la
//   agenda, los títulos del catálogo y el día local.
// - Aplicar va por lotes de `APPLY_BATCH`, cediendo el turno entre uno y otro, cada uno con su HLC y
//   calculado con la agenda tal como está (lo apuntado entretanto no se pisa), y un solo Deshacer
//   para todos.

import {
  type SteamAchievementsResult,
  steamAchievementsResponseSchema,
  steamTypesResponseSchema,
} from '@gameagenda/core/api';
import {
  type ActionContext,
  applySteamImport,
  type Entry,
  isLive,
  planSteamImport,
  type SteamImportItem,
  type SteamImportPlan,
  type UndoChange,
  type UndoStep,
} from '@gameagenda/core/entries';
import type { Op } from '@gameagenda/core/sync';
import { yieldToMain } from '../lib/yield.ts';
import type { SteamLibrary } from './steam-library.ts';

/** Juegos por lote al aplicar, como al importar una copia (DECISIONES §10.48). */
export const APPLY_BATCH = 250;

/** Lo que hace falta de la agenda (\`AgendaStore\`). */
export interface SteamAgenda {
  get(id: string): Entry | undefined;
  /** La mayor `rank` de Quiero jugar: lo importado va detrás. */
  importContext(): { readonly lastRank: string | null };
  applyBatch(
    ids: readonly string[],
    action: (
      ctx: ActionContext,
      get: (id: string) => Entry | undefined,
    ) => {
      readonly entries: readonly Entry[];
      readonly ops: readonly Op[];
      readonly undo: UndoStep;
    } | null,
  ): Promise<{ readonly undo: UndoStep } | null>;
  undoer(step: UndoStep): () => void;
}

/** La respuesta de `POST /steam/achievements`, validada; `null` si no lo es. */
export function readSteamAchievements(text: string): SteamAchievementsResult[] | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = steamAchievementsResponseSchema.safeParse(json);
  return parsed.success ? parsed.data.games : null;
}

/** La respuesta de `POST /steam/types`, validada: las apps que son software; `null` si no lo es. */
export function readSteamTypes(text: string): number[] | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = steamTypesResponseSchema.safeParse(json);
  return parsed.success ? parsed.data.software : null;
}

/**
 * Por qué apps preguntar si son software: las de la biblioteca que no están en el catálogo, que
 * solo tiene juegos. Sin catálogo (`titles` vacío), todas.
 */
export function typeCandidates(
  library: SteamLibrary,
  titles: ReadonlyMap<number, string>,
): number[] {
  return [...new Set(library.owned.map((game) => game.appid))].filter(
    (appid) => !titles.has(appid),
  );
}

/**
 * Por qué juegos preguntar los logros: jugados, con estadísticas, no Platinado ya en la agenda y
 * que no sean software.
 */
export function achievementCandidates(
  library: SteamLibrary,
  get: (id: string) => Entry | undefined,
  software: ReadonlySet<number> = new Set(),
): number[] {
  return library.owned
    .filter((game) => {
      if (game.minutes <= 0 || !game.stats || software.has(game.appid)) return false;
      const entry = get(`steam:${game.appid}`);
      return !(isLive(entry) && entry.flags.platinum === true);
    })
    .map((game) => game.appid);
}

export interface PlanOptions {
  readonly library: SteamLibrary;
  /** `appid` → último logro en ms UTC (o `null` si Steam no lo dice). */
  readonly platinum: ReadonlyMap<number, number | null>;
  readonly withWishlist: boolean;
  readonly nowMs: number;
  readonly dayOf: (ms: number) => string;
  readonly get: (id: string) => Entry | undefined;
  readonly titles: ReadonlyMap<number, string>;
  readonly fallbackTitle: (appid: number) => string;
  /** Lo que la tienda de Steam da como software (DECISIONES §10.57). */
  readonly software?: ReadonlySet<number>;
}

export function buildSteamPlan(options: PlanOptions): SteamImportPlan {
  const { library, titles } = options;
  return planSteamImport({
    owned: library.owned,
    wishlist: options.withWishlist ? library.wishlist : null,
    platinum: options.platinum,
    nowMs: options.nowMs,
    dayOf: options.dayOf,
    get: options.get,
    catalogTitle: (appid) => titles.get(appid) ?? null,
    fallbackTitle: options.fallbackTitle,
    software: options.software,
  });
}

export interface ApplyOptions {
  readonly batchSize?: number;
  /** Entre lote y lote (por defecto, `yieldToMain`). */
  readonly pause?: () => Promise<void>;
  readonly onProgress?: (done: number, total: number) => void;
}

export interface ApplyOutcome {
  /** Juegos que han cambiado (altas y marcas). */
  readonly changed: number;
  /** Lo que ya no había que hacer (apuntado entretanto, por ejemplo). */
  readonly skipped: number;
  /** Deshace la importación entera; `null` si no ha cambiado nada. */
  readonly undo: (() => void) | null;
}

/** Aplica el plan por lotes; si un lote no se puede guardar, para y lanza el error. */
export async function applySteamPlan(
  items: readonly SteamImportItem[],
  agenda: SteamAgenda,
  options: ApplyOptions = {},
): Promise<ApplyOutcome> {
  const size = options.batchSize ?? APPLY_BATCH;
  const pause = options.pause ?? yieldToMain;
  let rank = agenda.importContext().lastRank;
  let skipped = 0;
  const changes: UndoChange[] = [];
  for (let start = 0; start < items.length; start += size) {
    if (start > 0) await pause();
    const batch = items.slice(start, start + size);
    const result = await agenda.applyBatch(
      batch.map((item) => item.id),
      (ctx, get) => {
        const applied = applySteamImport(batch, get, ctx, rank);
        rank = applied.lastRank;
        skipped += applied.skipped;
        return applied.entries.length > 0 ? applied : null;
      },
    );
    if (result) changes.push(...result.undo.changes);
    options.onProgress?.(Math.min(start + size, items.length), items.length);
  }
  return {
    changed: changes.length,
    skipped,
    undo: changes.length > 0 ? agenda.undoer({ changes }) : null,
  };
}
