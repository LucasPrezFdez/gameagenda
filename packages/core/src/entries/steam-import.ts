// Importar la biblioteca de Steam en la agenda (Fase 2, parte 3; §10.1 de prototipe.md; ADR-012;
// DECISIONES §10.49 y §10.50). Primero `planSteamImport` decide qué pasa con cada juego, sin tocar
// nada (es lo que enseña el resumen); después `applySteamImport` lo escribe, por lotes.
//
// Lo que decidió el usuario (20-11-2026):
// - Todos los juegos de la biblioteca entran como Comprado y, si tienen todos los logros, como
//   Platinado (que los pone en Completado, con la fecha del último logro).
// - Los demás, según lo jugado: sin jugar, Sin empezar (la importación no sabe cuáles quieres
//   jugar: Quiero jugar lo decide el usuario); jugados en las últimas dos semanas, Jugando;
//   jugados antes, En pausa.
// - Lo que ya estaba apuntado no cambia de estado: solo gana Comprado y, si toca, Platinado.
// - La lista de deseados, si se pide, a Quiero jugar (sin Comprado), detrás de lo demás.

import type { Op } from '../sync/op.ts';
import {
  type ActionContext,
  addImported,
  markImported,
  type UndoChange,
  type UndoStep,
} from './actions.ts';
import { steamEntryId } from './ids.ts';
import { type Day, type Entry, isLive, type Status } from './model.ts';
import { keyBetween } from './rank.ts';

/** «Jugado hace poco»: en los últimos 14 días, como `playtime_2weeks` de Steam. */
export const RECENT_PLAY_MS = 14 * 24 * 60 * 60 * 1000;

export interface SteamImportGame {
  readonly appid: number;
  /** El nombre que da Steam (ya limpio), si lo da. */
  readonly name: string | null;
  /** Minutos jugados en total. */
  readonly minutes: number;
  /** Última partida, en ms UTC; `null` si nunca. */
  readonly lastPlayedAt: number | null;
}

export interface SteamImportWish {
  readonly appid: number;
  /** El orden de la lista de deseados en Steam (0: sin orden). */
  readonly priority: number;
  /** Cuándo se añadió, en ms UTC. */
  readonly addedAt: number | null;
}

export interface SteamImportInput {
  readonly owned: readonly SteamImportGame[];
  /** `null` si no se importa (o Steam no la ha dado). */
  readonly wishlist: readonly SteamImportWish[] | null;
  /**
   * Los platinados: `appid` → instante del último logro (ms UTC), o `null` si Steam no lo dice
   * (entonces vale el día de hoy).
   */
  readonly platinum: ReadonlyMap<number, number | null>;
  readonly nowMs: number;
  /** El día local (`AAAA-MM-DD`) de un instante: lo pone la app, que sabe la zona horaria. */
  readonly dayOf: (ms: number) => string;
  readonly get: (id: string) => Entry | undefined;
  /** El título del catálogo, si lo está; si no, `null`. */
  readonly catalogTitle: (appid: number) => string | null;
  /** El título de lo que no está en el catálogo ni trae nombre de Steam. */
  readonly fallbackTitle: (appid: number) => string;
}

export type SteamImportItem =
  | {
      readonly kind: 'add';
      readonly id: string;
      readonly appid: number;
      readonly title: string;
      readonly status: Status;
      readonly owned: boolean;
      readonly platinumAt: Day;
      /** De la lista de deseados. */
      readonly wish: boolean;
    }
  | {
      readonly kind: 'mark';
      readonly id: string;
      readonly appid: number;
      readonly title: string;
      readonly owned: boolean;
      readonly platinumAt: Day;
    };

export interface SteamImportCounts {
  /** Juegos nuevos de la biblioteca, por estado (los platinados, en `completed`). */
  readonly added: Readonly<Record<Status, number>>;
  /** Deseados nuevos (en Quiero jugar). */
  readonly wishes: number;
  /** Ya apuntados que ganan Comprado. */
  readonly markedOwned: number;
  /** Platinados: nuevos y ya apuntados que ganan la marca. */
  readonly platinum: number;
  /** De la biblioteca o de los deseados, ya apuntados y sin nada que cambiar. */
  readonly unchanged: number;
}

export interface SteamImportPlan {
  readonly items: readonly SteamImportItem[];
  readonly counts: SteamImportCounts;
}

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/** El estado de un juego nuevo de la biblioteca (sin contar el platino). */
export function statusOfPlayed(game: SteamImportGame, nowMs: number): Status {
  if (game.minutes <= 0) return 'not_started';
  if (game.lastPlayedAt !== null && nowMs - game.lastPlayedAt < RECENT_PLAY_MS) return 'playing';
  return 'on_hold';
}

/** Qué pasaría con cada juego, sin tocar nada. Los nuevos, en el orden en que van a entrar. */
export function planSteamImport(input: SteamImportInput): SteamImportPlan {
  const added: Record<Status, number> = {
    want_to_play: 0,
    playing: 0,
    on_hold: 0,
    completed: 0,
    dropped: 0,
    not_started: 0,
  };
  let markedOwned = 0;
  let platinum = 0;
  let unchanged = 0;
  const marks: SteamImportItem[] = [];
  const fresh: Array<{ item: SteamImportItem; key: readonly (number | string)[] }> = [];
  const seen = new Set<number>();

  const platinumDay = (appid: number): Day => {
    if (!input.platinum.has(appid)) return null;
    const at = input.platinum.get(appid) ?? null;
    return input.dayOf(at ?? input.nowMs);
  };
  const lastPlayed = (game: SteamImportGame) => -(game.lastPlayedAt ?? 0);

  for (const game of input.owned) {
    if (seen.has(game.appid)) continue;
    seen.add(game.appid);
    const id = steamEntryId(game.appid);
    const prev = input.get(id);
    const platinumAt = platinumDay(game.appid);
    const title = input.catalogTitle(game.appid) ?? game.name ?? input.fallbackTitle(game.appid);
    if (isLive(prev)) {
      const owned = prev.flags.owned !== true;
      const plat = platinumAt !== null && prev.flags.platinum !== true;
      if (!owned && !plat) {
        unchanged++;
        continue;
      }
      if (owned) markedOwned++;
      if (plat) platinum++;
      marks.push({
        kind: 'mark',
        id,
        appid: game.appid,
        title: prev.title,
        owned,
        platinumAt: plat ? platinumAt : null,
      });
      continue;
    }
    const status: Status = platinumAt !== null ? 'completed' : statusOfPlayed(game, input.nowMs);
    added[status]++;
    if (platinumAt !== null) platinum++;
    const item: SteamImportItem = {
      kind: 'add',
      id,
      appid: game.appid,
      title,
      status,
      owned: true,
      platinumAt,
      wish: false,
    };
    // Jugando, En pausa y Completado: lo último jugado primero. Sin empezar: por nombre.
    const group = {
      playing: 0,
      on_hold: 1,
      completed: 2,
      want_to_play: 3,
      dropped: 4,
      not_started: 5,
    }[status];
    const key =
      status === 'not_started' ? [group, title] : [group, lastPlayed(game), title, game.appid];
    fresh.push({ item, key });
  }

  let wishes = 0;
  for (const wish of input.wishlist ?? []) {
    if (seen.has(wish.appid)) continue;
    seen.add(wish.appid);
    const id = steamEntryId(wish.appid);
    if (isLive(input.get(id))) {
      unchanged++;
      continue;
    }
    wishes++;
    const title = input.catalogTitle(wish.appid) ?? input.fallbackTitle(wish.appid);
    fresh.push({
      item: {
        kind: 'add',
        id,
        appid: wish.appid,
        title,
        status: 'want_to_play',
        owned: false,
        platinumAt: null,
        wish: true,
      },
      // El orden de Steam (0, sin orden, al final) y, a igual, el más antiguo primero.
      key: [6, wish.priority > 0 ? wish.priority : Number.MAX_SAFE_INTEGER, wish.addedAt ?? 0],
    });
  }

  fresh.sort((a, b) => compareKeys(a.key, b.key));
  return {
    items: [...fresh.map((f) => f.item), ...marks],
    counts: { added, wishes, markedOwned, platinum, unchanged },
  };
}

function compareKeys(a: readonly (number | string)[], b: readonly (number | string)[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    const c = collator.compare(String(x), String(y));
    if (c !== 0) return c;
  }
  return 0;
}

export interface SteamImportBatch {
  readonly entries: Entry[];
  readonly ops: Op[];
  /** Para deshacer el lote (se juntan los de todos los lotes en un solo Deshacer). */
  readonly undo: UndoStep;
  /** La `rank` del último alta: el siguiente lote sigue detrás. */
  readonly lastRank: string | null;
  /** Lo que ya no había que hacer (apuntado entretanto, por ejemplo). */
  readonly skipped: number;
}

/**
 * Escribe un lote del plan con la HLC de `ctx` (posterior a la de todas sus entradas). Las altas
 * van detrás de `lastRank`, una tras otra. Se calcula con la agenda tal como está: lo que se haya
 * apuntado entretanto no se pisa (un alta de algo ya vivo se salta; una marca, se repasa).
 */
export function applySteamImport(
  items: readonly SteamImportItem[],
  get: (id: string) => Entry | undefined,
  ctx: ActionContext,
  lastRank: string | null,
): SteamImportBatch {
  const entries: Entry[] = [];
  const ops: Op[] = [];
  const changes: UndoChange[] = [];
  let rank = lastRank;
  let skipped = 0;
  for (const item of items) {
    const prev = get(item.id);
    let result: ReturnType<typeof addImported>;
    if (item.kind === 'add') {
      if (isLive(prev)) {
        skipped++;
        continue;
      }
      const next = keyBetween(rank, null);
      result = addImported(
        prev,
        {
          id: item.id,
          title: item.title,
          status: item.status,
          rank: next,
          owned: item.owned,
          platinumAt: item.platinumAt,
        },
        ctx,
      );
      if (result) rank = next;
    } else {
      result = markImported(prev, { owned: item.owned, platinumAt: item.platinumAt }, ctx);
    }
    if (result === null) {
      skipped++;
      continue;
    }
    entries.push(...result.entries);
    ops.push(...result.ops);
    changes.push(...result.undo.changes);
  }
  return { entries, ops, undo: { changes }, lastRank: rank, skipped };
}
