// La actualización diaria de Steam vinculado (ADR-014): la biblioteca de la cuenta vinculada, sin
// volver a iniciar sesión en Steam (`POST /steam/refresh`, con la cookie del dispositivo), y el
// mismo plan que la importación a mano, aplicado sin resumen y con «Deshacer» en el aviso. Va en su
// propio *chunk*: lo carga `auto-refresh-trigger.ts` cuando toca.
//
// - Los logros, solo de lo jugado en los últimos 14 días (`RECENT_PLAY_MS`): la primera
//   importación ya miró los demás, y así son pocas llamadas a Steam al día.
// - Sin la lista de deseados: en la importación a mano también va desmarcada.
// - Lo que el usuario quitó de la lista no vuelve (`planSteamImport` se salta las lápidas).
// - La micro-API la trae como mucho una vez cada 20 h por agenda: con varios dispositivos, uno la
//   trae y a los demás les llega por la sincronización (202 `too_soon`).

import { API_BASE } from '@gameagenda/core/api';
import { RECENT_PLAY_MS, type SteamImportCounts } from '@gameagenda/core/entries';
import type { NoticeCenter } from '../notices/notice-center.ts';
import type { SyncService } from '../sync/types.ts';
import type { ApplyOptions, SteamAgenda } from './steam-apply.ts';
import { type FetchLike, gatherSteamData, STEAM_REQUEST_TIMEOUT_MS } from './steam-flow.ts';
import type { SteamLibrary } from './steam-library.ts';
import { steamTexts } from './texts.ts';

export type AutoRefreshOutcome =
  | {
      readonly kind: 'applied';
      readonly counts: SteamImportCounts;
      readonly undo: (() => void) | null;
    }
  /** Steam no trae nada nuevo (o la biblioteca está vacía). */
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'private' }
  /** Ya se trajo hace menos de 20 h, desde este dispositivo o desde otro. */
  | { readonly kind: 'tooSoon' }
  /** La agenda no tiene una cuenta de Steam vinculada. */
  | { readonly kind: 'unlinked' }
  /** Sin red, Steam caído, la micro-API apagada, el tope del día… La próxima vez. */
  | { readonly kind: 'failed' };

export interface AutoRefreshDeps {
  readonly fetch: FetchLike;
  readonly agenda: SteamAgenda;
  readonly catalogTitles?: (appids: readonly number[]) => Promise<ReadonlyMap<number, string>>;
  readonly fallbackTitle?: (appid: number) => string;
  readonly now?: () => number;
  readonly dayOf?: (ms: number) => string;
  /** El lector de la respuesta (por defecto, el *chunk* de `steam-library.ts`). */
  readonly readLibrary?: (text: string) => Promise<SteamLibrary | null>;
  readonly applyOptions?: ApplyOptions;
  readonly timeoutMs?: number;
}

function dayOfLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Trae la biblioteca de la cuenta vinculada y la aplica. No lanza: un fallo es `failed`. */
export async function refreshFromSteam(deps: AutoRefreshDeps): Promise<AutoRefreshOutcome> {
  const request = (path: string, body: unknown, withCookie = false) =>
    deps.fetch(`${API_BASE}${path}`, {
      method: 'POST',
      credentials: withCookie ? 'same-origin' : 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(deps.timeoutMs ?? STEAM_REQUEST_TIMEOUT_MS),
    });
  try {
    const response = await request('/steam/refresh', {}, true);
    if (response.status !== 200) {
      const json = (await response.json().catch(() => null)) as { status?: unknown } | null;
      if (response.status === 202 && json?.status === 'unlinked') return { kind: 'unlinked' };
      if (response.status === 202 && json?.status === 'too_soon') return { kind: 'tooSoon' };
      return { kind: 'failed' };
    }
    const text = await response.text();
    const read = deps.readLibrary ?? (await import('./steam-library.ts')).readSteamImport;
    const library = await read(text);
    if (library === null) return { kind: 'failed' };
    if (library.visibility === 'private') return { kind: 'private' };
    if (library.owned.length === 0) return { kind: 'unchanged' };

    const mod = await import('./steam-apply.ts');
    const now = (deps.now ?? Date.now)();
    const gathered = await gatherSteamData({
      request: (path, body) => request(path, body),
      mod,
      library,
      agenda: deps.agenda,
      ...(deps.catalogTitles ? { catalogTitles: deps.catalogTitles } : {}),
      playedSince: now - RECENT_PLAY_MS,
    });
    if (gathered === null) return { kind: 'failed' };
    const plan = mod.buildSteamPlan({
      library,
      platinum: gathered.platinum,
      withWishlist: false,
      nowMs: now,
      dayOf: deps.dayOf ?? dayOfLocal,
      get: (id) => deps.agenda.get(id),
      titles: gathered.titles,
      fallbackTitle: deps.fallbackTitle ?? steamTexts.steamGame,
      software: gathered.software,
    });
    if (plan.items.length === 0) return { kind: 'unchanged' };
    const outcome = await mod.applySteamPlan(plan.items, deps.agenda, deps.applyOptions);
    if (outcome.changed === 0) return { kind: 'unchanged' };
    return { kind: 'applied', counts: plan.counts, undo: outcome.undo };
  } catch {
    return { kind: 'failed' };
  }
}

/** Lo que usa la app para la actualización diaria. */
export interface AutoRefreshServices {
  readonly sync: Pick<SyncService, 'updateLocalAccount'>;
  readonly agenda: SteamAgenda;
  readonly notices: Pick<NoticeCenter, 'notify'>;
  readonly catalogTitles: (appids: readonly number[]) => Promise<ReadonlyMap<number, string>>;
  readonly fetch?: FetchLike;
}

/**
 * La de la app: trae y aplica, avisa con «Deshacer» si ha cambiado algo, y apunta en
 * `meta.account` si la agenda tiene vínculo (lo sabe por la respuesta).
 */
export async function runSteamAutoRefresh(
  services: AutoRefreshServices,
): Promise<AutoRefreshOutcome> {
  const outcome = await refreshFromSteam({
    fetch: services.fetch ?? ((input, init) => fetch(input, init)),
    agenda: services.agenda,
    catalogTitles: services.catalogTitles,
    fallbackTitle: steamTexts.steamGame,
  });
  if (outcome.kind === 'applied') {
    services.notices.notify(steamTexts.autoApplied(outcome.counts), { undo: outcome.undo });
  }
  if (outcome.kind === 'unlinked') await services.sync.updateLocalAccount({ steamLinked: false });
  else if (outcome.kind !== 'failed') await services.sync.updateLocalAccount({ steamLinked: true });
  return outcome;
}
