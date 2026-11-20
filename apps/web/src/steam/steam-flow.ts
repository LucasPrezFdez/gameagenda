// «Importar desde Steam» en la app (Fase 2, parte 2; §10.2 y §10.3; ADR-012): el canje tipo PKCE
// contra la micro-API, como un almacén pequeño que sobrevive a salir de Ajustes (la pantalla se
// desmonta, el login sigue en curso).
//
// 1. «Importar desde Steam»: el verificador (256 bits de `crypto.getRandomValues`), el `challenge`
//    (`BASE64URL(SHA-256(verificador))`) y `POST /steam/start`. Es la primera petición a `/api`:
//    antes del clic no se pide nada.
// 2. `ready`: la app enseña el botón oficial de Steam como un enlace de verdad a la URL de OpenID,
//    en otra ventana. Un enlace que pulsa el usuario no lo bloquea ningún navegador, la app de
//    escritorio lo abre en el navegador del sistema (`on_new_window`, ADR-010) y la PWA de iOS, en
//    Safari.
// 3. `waiting`: al volver a la app (foco o vuelta a la vista) o con «Ya he iniciado sesión», la app
//    canjea el ticket con su verificador (`POST /steam/redeem`). Con 202, aún no hay login: sigue
//    esperando. El verificador solo está en memoria: si el sistema cierra la app, se vuelve a
//    empezar.
// 4. `loading`: la biblioteca y los deseados, leídos y validados aquí (`steam-library.ts`, en un
//    *chunk* aparte). Con el perfil privado, o sin nada que importar, `done`: solo se explica.
// 5. `checking` (parte 3): los logros de los juegos jugados con estadísticas, por lotes de
//    `STEAM_ACHIEVEMENTS_BATCH`, con el pase de `redeem` (`POST /steam/achievements`). Si un
//    lote falla, se sigue sin los logros que falten (se dice en el resumen).
// 6. `review`: el plan (`steam-apply.ts`), sin tocar la agenda: cuántos entran y dónde, y la
//    casilla de la lista de deseados (desmarcada). «Aplicar» o «Cancelar».
// 7. `applying` y `applied`: por lotes, con un solo «Deshacer» (`undone`).
//
// Las peticiones van sin *cookies* (`credentials: 'omit'`: el login no depende de la
// sincronización), sin `Referer` y sin caché.

import { API_BASE, STEAM_ACHIEVEMENTS_BATCH } from '@gameagenda/core/api';
import type { SteamImportCounts, SteamImportPlan } from '@gameagenda/core/entries';
import type { ApplyOptions, SteamAgenda } from './steam-apply.ts';
import type { SteamLibrary } from './steam-library.ts';

export type SteamImportFailure =
  /** No se ha podido guardar en el dispositivo lo aplicado (parte 3). */
  'unsaved' | 'expired' | 'offline' | 'unavailable' | 'busy' | 'disabled' | 'rateLimited';

export type SteamImportState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  /** El ticket está listo: falta pulsar el botón de Steam. */
  | { readonly kind: 'ready'; readonly url: string }
  /** Steam está abierto en otra ventana; `stillPending` tras un «Ya he iniciado sesión» sin login. */
  | { readonly kind: 'waiting'; readonly url: string; readonly stillPending: boolean }
  | { readonly kind: 'loading' }
  /** Sin nada que aplicar: el perfil privado o una biblioteca vacía (o sin agenda, en las pruebas). */
  | { readonly kind: 'done'; readonly library: SteamLibrary }
  /** Comprobando los logros: `done` de `total` juegos. */
  | { readonly kind: 'checking'; readonly done: number; readonly total: number }
  | {
      readonly kind: 'review';
      readonly plan: SteamImportPlan;
      /** Deseados que se pueden añadir (si se marca la casilla). */
      readonly wishes: number;
      readonly withWishlist: boolean;
      /** Juegos de los que Steam no ha dado los logros (privados o sin respuesta). */
      readonly unknown: number;
    }
  | { readonly kind: 'applying'; readonly done: number; readonly total: number }
  | { readonly kind: 'applied'; readonly counts: SteamImportCounts; readonly canUndo: boolean }
  | { readonly kind: 'undone' }
  /** `retry`: se puede volver a intentar lo mismo (el ticket sigue vivo); si no, volver a empezar. */
  | { readonly kind: 'failed'; readonly reason: SteamImportFailure; readonly retry: boolean };

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface SteamFlowDeps {
  readonly fetch: FetchLike;
  /** Donde escuchar la vuelta a la app: `window` y `document` (las pruebas pasan otros). */
  readonly win: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  readonly doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  /** El lector de la respuesta de `redeem` (por defecto, el *chunk* de `steam-library.ts`). */
  readonly readLibrary?: (text: string) => Promise<SteamLibrary | null>;
  readonly timeoutMs?: number;
  /** La agenda (parte 3). Sin ella, el flujo acaba en `done` con el resumen de la parte 2. */
  readonly agenda?: SteamAgenda;
  /** Los títulos del catálogo de estos `appid` (los que no estén, no salen). */
  readonly catalogTitles?: (appids: readonly number[]) => Promise<ReadonlyMap<number, string>>;
  /** El título de lo que no está en el catálogo ni trae nombre de Steam. */
  readonly fallbackTitle?: (appid: number) => string;
  /** El día local (`AAAA-MM-DD`) de un instante. */
  readonly dayOf?: (ms: number) => string;
  readonly now?: () => number;
  readonly applyOptions?: ApplyOptions;
}

/** Lo traído, mientras dura el resumen. */
interface Fetched {
  readonly library: SteamLibrary;
  readonly platinum: ReadonlyMap<number, number | null>;
  readonly titles: ReadonlyMap<number, string>;
  readonly unknown: number;
  plan: SteamImportPlan;
}

/** Una petición que no contesta en este tiempo cuenta como sin red (`redeem` espera a Steam). */
export const STEAM_REQUEST_TIMEOUT_MS = 45_000;

interface Ticket {
  readonly ticket: string;
  readonly verifier: string;
  readonly url: string;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** El verificador (256 bits aleatorios) y su `challenge` (`S256` de PKCE, RFC 7636). */
export async function newPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

const IDLE: SteamImportState = { kind: 'idle' };

/** Lo que hay que hacer con una respuesta de error de la micro-API. */
function failureOf(status: number, code: unknown): SteamImportFailure {
  if (status === 410) return 'expired';
  if (status === 429) return 'rateLimited';
  if (code === 'steam_busy') return 'busy';
  if (code === 'steam_disabled' || code === 'sync_disabled') return 'disabled';
  return 'unavailable';
}

/** Estados en los que la importación está trabajando: no se empieza otra. */
const BUSY: ReadonlySet<SteamImportState['kind']> = new Set([
  'starting',
  'loading',
  'checking',
  'applying',
]);

function dayOfLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export class SteamImportFlow {
  private state: SteamImportState = IDLE;
  private ticket: Ticket | null = null;
  private fetched: Fetched | null = null;
  private undoImport: (() => void) | null = null;
  private redeeming = false;
  private listening = false;
  /** Cambia con cada «Volver a empezar» o «Cancelar»: lo que llegue de antes se descarta. */
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private readonly deps: SteamFlowDeps;

  constructor(deps: SteamFlowDeps) {
    this.deps = deps;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): SteamImportState => this.state;

  private set(state: SteamImportState): void {
    this.state = state;
    if (state.kind === 'waiting') this.listen();
    else this.unlisten();
    for (const listener of this.listeners) listener();
  }

  private request(path: string, body: unknown): Promise<Response> {
    return this.deps.fetch(`${API_BASE}${path}`, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.deps.timeoutMs ?? STEAM_REQUEST_TIMEOUT_MS),
    });
  }

  /** «Importar desde Steam» (y «Volver a empezar»): un ticket nuevo. */
  async start(): Promise<void> {
    if (BUSY.has(this.state.kind)) return;
    const generation = ++this.generation;
    this.ticket = null;
    this.fetched = null;
    this.undoImport = null;
    this.set({ kind: 'starting' });
    let response: Response;
    let verifier: string;
    try {
      const pkce = await newPkce();
      verifier = pkce.verifier;
      response = await this.request('/steam/start', { challenge: pkce.challenge });
    } catch {
      if (generation === this.generation)
        this.set({ kind: 'failed', reason: 'offline', retry: false });
      return;
    }
    const json = (await response.json().catch(() => null)) as {
      ticket?: unknown;
      url?: unknown;
      error?: unknown;
    } | null;
    if (generation !== this.generation) return;
    if (
      response.status !== 201 ||
      typeof json?.ticket !== 'string' ||
      typeof json.url !== 'string' ||
      !json.url.startsWith('https://steamcommunity.com/openid/login?')
    ) {
      this.set({ kind: 'failed', reason: failureOf(response.status, json?.error), retry: false });
      return;
    }
    this.ticket = { ticket: json.ticket, verifier, url: json.url };
    this.set({ kind: 'ready', url: json.url });
  }

  /** El usuario ha pulsado el botón de Steam: la app espera su vuelta. */
  opened(): void {
    if (this.ticket === null) return;
    if (this.state.kind !== 'ready' && this.state.kind !== 'waiting') return;
    this.set({ kind: 'waiting', url: this.ticket.url, stillPending: false });
  }

  /**
   * Canjea el ticket. `manual`: lo ha pedido el usuario («Ya he iniciado sesión», «Reintentar»), así
   * que un «aún no» se le dice; al volver a la app, no.
   */
  async redeem(manual: boolean): Promise<void> {
    const ticket = this.ticket;
    if (ticket === null || this.redeeming) return;
    // La caducidad la decide el servidor (410): con el reloj del dispositivo desfasado, una
    // comprobación aquí daría por caducado un ticket vigente.
    const generation = this.generation;
    this.redeeming = true;
    try {
      let response: Response;
      try {
        response = await this.request('/steam/redeem', {
          ticket: ticket.ticket,
          verifier: ticket.verifier,
        });
      } catch {
        // No se sabe si llegó: el ticket puede seguir vivo, y reintentar lo dice.
        if (generation === this.generation) {
          this.set({ kind: 'failed', reason: 'offline', retry: true });
        }
        return;
      }
      if (generation !== this.generation) return;
      if (response.status === 202) {
        await response.body?.cancel();
        if (manual || this.state.kind !== 'waiting') {
          this.set({ kind: 'waiting', url: ticket.url, stillPending: manual });
        }
        return;
      }
      if (response.status !== 200) {
        const json = (await response.json().catch(() => null)) as { error?: unknown } | null;
        if (generation !== this.generation) return;
        const reason = failureOf(response.status, json?.error);
        // Con 429 el ticket sigue vivo; con lo demás, gastado o inservible.
        if (reason !== 'rateLimited') this.ticket = null;
        this.set({ kind: 'failed', reason, retry: reason === 'rateLimited' });
        return;
      }
      // Con el 200, el ticket ya está gastado.
      this.ticket = null;
      this.set({ kind: 'loading' });
      let library: SteamLibrary | null = null;
      try {
        const text = await response.text();
        // Con `__STEAM_IMPORT__` a `false`, el `import()` desaparece del *build* (y su *chunk*).
        const read =
          this.deps.readLibrary ??
          (__STEAM_IMPORT__ ? (await import('./steam-library.ts')).readSteamImport : null);
        if (read === null) throw new Error('steam_import_off');
        library = await read(text);
      } catch {
        library = null;
      }
      if (generation !== this.generation) return;
      if (library === null) {
        this.set({ kind: 'failed', reason: 'unavailable', retry: false });
        return;
      }
      const nothing = library.owned.length === 0 && (library.wishlist?.length ?? 0) === 0;
      if (this.deps.agenda === undefined || library.visibility === 'private' || nothing) {
        this.set({ kind: 'done', library });
        return;
      }
      void this.check(library, this.deps.agenda, generation);
    } finally {
      this.redeeming = false;
    }
  }

  /** El *chunk* de la parte 3 (con `__STEAM_IMPORT__` a `false`, desaparece del *build*). */
  private async applyModule(): Promise<typeof import('./steam-apply.ts')> {
    if (!__STEAM_IMPORT__) throw new Error('steam_import_off');
    return import('./steam-apply.ts');
  }

  /** Los logros, por lotes, y después el resumen. */
  private async check(library: SteamLibrary, agenda: SteamAgenda, generation: number) {
    let mod: typeof import('./steam-apply.ts');
    try {
      mod = await this.applyModule();
    } catch {
      if (generation === this.generation) {
        this.set({ kind: 'failed', reason: 'unavailable', retry: false });
      }
      return;
    }
    if (generation !== this.generation) return;
    const candidates = mod.achievementCandidates(library, (id) => agenda.get(id));
    const platinum = new Map<number, number | null>();
    let unknown = 0;
    this.set({ kind: 'checking', done: 0, total: candidates.length });
    for (let start = 0; start < candidates.length; start += STEAM_ACHIEVEMENTS_BATCH) {
      const appids = candidates.slice(start, start + STEAM_ACHIEVEMENTS_BATCH);
      let games: ReturnType<typeof mod.readSteamAchievements> = null;
      try {
        const response = await this.request('/steam/achievements', {
          token: library.token,
          appids,
        });
        if (response.status === 200) games = mod.readSteamAchievements(await response.text());
        else await response.body?.cancel();
      } catch {
        games = null;
      }
      if (generation !== this.generation) return;
      // Sin respuesta (sin red, el tope del día, el pase caducado…): se sigue sin los que faltan.
      if (games === null) {
        unknown += candidates.length - start;
        break;
      }
      for (const game of games) {
        if (game.result === 'complete') {
          platinum.set(game.appid, game.at === null ? null : game.at * 1000);
        } else if (game.result === 'hidden' || game.result === 'unavailable') {
          unknown++;
        }
      }
      const done = Math.min(start + STEAM_ACHIEVEMENTS_BATCH, candidates.length);
      this.set({ kind: 'checking', done, total: candidates.length });
    }

    const appids = [
      ...library.owned.map((game) => game.appid),
      ...(library.wishlist ?? []).map((wish) => wish.appid),
    ];
    let titles: ReadonlyMap<number, string> = new Map();
    try {
      titles = (await this.deps.catalogTitles?.(appids)) ?? titles;
    } catch {
      // Sin catálogo: el nombre de Steam (el catálogo lo pondrá después; §7.3).
    }
    if (generation !== this.generation) return;
    const fetched: Fetched = {
      library,
      platinum,
      titles,
      unknown,
      plan: this.plan(mod, library, platinum, titles, false),
    };
    this.fetched = fetched;
    this.showReview(mod, false);
  }

  private plan(
    mod: typeof import('./steam-apply.ts'),
    library: SteamLibrary,
    platinum: ReadonlyMap<number, number | null>,
    titles: ReadonlyMap<number, string>,
    withWishlist: boolean,
  ): SteamImportPlan {
    const agenda = this.deps.agenda as SteamAgenda;
    return mod.buildSteamPlan({
      library,
      platinum,
      withWishlist,
      nowMs: (this.deps.now ?? Date.now)(),
      dayOf: this.deps.dayOf ?? dayOfLocal,
      get: (id) => agenda.get(id),
      titles,
      fallbackTitle: this.deps.fallbackTitle ?? ((appid) => `Steam ${appid}`),
    });
  }

  private showReview(mod: typeof import('./steam-apply.ts'), withWishlist: boolean): void {
    const fetched = this.fetched;
    if (fetched === null) return;
    fetched.plan = this.plan(mod, fetched.library, fetched.platinum, fetched.titles, withWishlist);
    const wishes = withWishlist
      ? fetched.plan.counts.wishes
      : this.plan(mod, fetched.library, fetched.platinum, fetched.titles, true).counts.wishes;
    this.set({
      kind: 'review',
      plan: fetched.plan,
      wishes,
      withWishlist,
      unknown: fetched.unknown,
    });
  }

  /** La casilla de la lista de deseados del resumen. */
  async setWishlist(withWishlist: boolean): Promise<void> {
    if (this.state.kind !== 'review' || this.state.withWishlist === withWishlist) return;
    this.showReview(await this.applyModule(), withWishlist);
  }

  /** «Aplicar»: el plan del resumen, recalculado con la agenda de ahora, por lotes. */
  async apply(): Promise<void> {
    const fetched = this.fetched;
    const agenda = this.deps.agenda;
    if (this.state.kind !== 'review' || fetched === null || agenda === undefined) return;
    const generation = this.generation;
    const withWishlist = this.state.withWishlist;
    const mod = await this.applyModule();
    // Con la agenda de ahora: lo apuntado mientras se miraba el resumen no se pisa.
    const plan = this.plan(mod, fetched.library, fetched.platinum, fetched.titles, withWishlist);
    this.set({ kind: 'applying', done: 0, total: plan.items.length });
    let outcome: Awaited<ReturnType<typeof mod.applySteamPlan>>;
    try {
      outcome = await mod.applySteamPlan(plan.items, agenda, {
        ...this.deps.applyOptions,
        onProgress: (done, total) => {
          if (generation === this.generation) this.set({ kind: 'applying', done, total });
        },
      });
    } catch {
      this.fetched = null;
      if (generation === this.generation) {
        this.set({ kind: 'failed', reason: 'unsaved', retry: false });
      }
      return;
    }
    // Lo traído ya no hace falta: el pase y la biblioteca se olvidan.
    this.fetched = null;
    this.undoImport = outcome.undo;
    if (generation !== this.generation) return;
    this.set({ kind: 'applied', counts: plan.counts, canUndo: outcome.undo !== null });
  }

  /** «Deshacer» la importación entera. */
  undo(): void {
    if (this.state.kind !== 'applied' || this.undoImport === null) return;
    const undo = this.undoImport;
    this.undoImport = null;
    undo();
    this.set({ kind: 'undone' });
  }

  /** «Cancelar» y «Listo»: se olvida el ticket y lo traído (el pase incluido). */
  reset(): void {
    this.generation++;
    this.ticket = null;
    this.fetched = null;
    this.undoImport = null;
    this.set(IDLE);
  }

  private readonly onFocus = (): void => {
    void this.redeem(false);
  };

  private readonly onVisibility = (): void => {
    if (this.deps.doc.visibilityState === 'visible') void this.redeem(false);
  };

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    this.deps.win.addEventListener('focus', this.onFocus);
    this.deps.doc.addEventListener('visibilitychange', this.onVisibility);
  }

  private unlisten(): void {
    if (!this.listening) return;
    this.listening = false;
    this.deps.win.removeEventListener('focus', this.onFocus);
    this.deps.doc.removeEventListener('visibilitychange', this.onVisibility);
  }
}

let shared: SteamImportFlow | null = null;

/** Lo que pone la app al crearlo (parte 3): la agenda y los títulos del catálogo. */
export type SteamFlowServices = Pick<SteamFlowDeps, 'agenda' | 'catalogTitles' | 'fallbackTitle'>;

/**
 * El de la app: uno, con `fetch`, `window` y `document` de verdad. `services` solo cuenta la
 * primera vez (son los de la app, que no cambian).
 */
export function steamImportFlow(services: SteamFlowServices = {}): SteamImportFlow {
  shared ??= new SteamImportFlow({
    fetch: (input, init) => fetch(input, init),
    win: window,
    doc: document,
    ...services,
  });
  return shared;
}
