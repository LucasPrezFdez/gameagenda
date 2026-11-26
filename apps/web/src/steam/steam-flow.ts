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
// 5. `checking` (parte 3): antes, los títulos del catálogo y, de lo que no está en él, qué es
//    software (`POST /steam/types`, DECISIONES §10.57; si falla, cuenta como juego). Después,
//    los logros de los juegos jugados con estadísticas, por lotes de
//    `STEAM_ACHIEVEMENTS_BATCH`, con el pase de `redeem` (`POST /steam/achievements`). Si un
//    lote falla, se sigue sin los logros que falten (se dice en el resumen).
// 6. `review`: el plan (`steam-apply.ts`), sin tocar la agenda: cuántos entran y dónde, y la
//    casilla de la lista de deseados (desmarcada). «Aplicar» o «Cancelar».
// 7. `applying` y `applied`: por lotes, con un solo «Deshacer» (`undone`).
//
// Las peticiones van sin *cookies* (`credentials: 'omit'`: el login no depende de la
// sincronización), sin `Referer` y sin caché. Salvo al vincular la cuenta de Steam a la agenda
// (ADR-014, `start(true)`): el canje va a `POST /steam/link`, con la cookie del dispositivo, y
// el vínculo queda en D1 para la actualización diaria (`auto-refresh.ts`). Lo que el usuario quitó
// de la lista no vuelve (`planSteamImport` se salta las lápidas).

import { API_BASE, STEAM_ACHIEVEMENTS_BATCH, STEAM_TYPES_BATCH } from '@gameagenda/core/api';
import { isLive, type SteamImportCounts, type SteamImportPlan } from '@gameagenda/core/entries';
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
  /** Tras vincular la cuenta de Steam a la agenda (ADR-014): para apuntarlo en `meta.account`. */
  readonly onLinked?: () => void;
}

/** Lo traído, mientras dura el resumen (con el *chunk* de la parte 3, ya cargado). */
interface Fetched {
  readonly mod: typeof import('./steam-apply.ts');
  readonly library: SteamLibrary;
  readonly platinum: ReadonlyMap<number, number | null>;
  readonly titles: ReadonlyMap<number, string>;
  readonly unknown: number;
  /** Lo que la tienda de Steam da como software (DECISIONES §10.57). */
  readonly software: ReadonlySet<number>;
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
  if (code === 'steam_disabled' || code === 'sync_disabled' || code === 'accounts_disabled') {
    return 'disabled';
  }
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
  /** Vincular la cuenta de Steam a la agenda al canjear (ADR-014). */
  private linking = false;
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

  /** ¿Esta importación vincula la cuenta de Steam a la agenda (ADR-014)? */
  readonly isLinking = (): boolean => this.linking;

  private set(state: SteamImportState): void {
    this.state = state;
    if (state.kind === 'waiting') this.listen();
    else this.unlisten();
    for (const listener of this.listeners) listener();
  }

  private request(path: string, body: unknown, withCookie = false): Promise<Response> {
    return this.deps.fetch(`${API_BASE}${path}`, {
      method: 'POST',
      credentials: withCookie ? 'same-origin' : 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.deps.timeoutMs ?? STEAM_REQUEST_TIMEOUT_MS),
    });
  }

  /**
   * «Importar desde Steam» (y «Volver a empezar»): un ticket nuevo. `link`: vincular además la
   * cuenta de Steam a la agenda sincronizada, para que se actualice sola (ADR-014).
   */
  async start(link = this.linking): Promise<void> {
    if (BUSY.has(this.state.kind)) return;
    this.linking = link;
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
      // Al vincular, con la cookie: todo el canje es de esta agenda.
      response = await this.request('/steam/start', { challenge: pkce.challenge }, link);
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
        response = await this.request(
          this.linking ? '/steam/link' : '/steam/redeem',
          { ticket: ticket.ticket, verifier: ticket.verifier },
          this.linking,
        );
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
      // Con el 200, el ticket ya está gastado (y, al vincular, el vínculo ya está en D1).
      this.ticket = null;
      if (this.linking) this.deps.onLinked?.();
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
  private applyModule(): Promise<typeof import('./steam-apply.ts')> {
    // Como expresión condicional, para que Rolldown la pliegue antes de armar los *chunks* (con un
    // `if` con `throw`, el `import()` partía el JS inicial en seis ficheros: +4 KB).
    return __STEAM_IMPORT__
      ? import('./steam-apply.ts')
      : Promise.reject(new Error('steam_import_off'));
  }

  /** Los títulos, qué es software, los logros por lotes y, después, el resumen. */
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
    const gathered = await gatherSteamData({
      request: (path, body) => this.request(path, body),
      mod,
      library,
      agenda,
      ...(this.deps.catalogTitles ? { catalogTitles: this.deps.catalogTitles } : {}),
      current: () => generation === this.generation,
      onProgress: (done, total) => this.set({ kind: 'checking', done, total }),
    });
    if (gathered === null) return;
    this.fetched = { mod, library, ...gathered };
    this.showReview(false);
  }

  private plan(fetched: Fetched, withWishlist: boolean): SteamImportPlan {
    const agenda = this.deps.agenda as SteamAgenda;
    return fetched.mod.buildSteamPlan({
      library: fetched.library,
      platinum: fetched.platinum,
      withWishlist,
      nowMs: (this.deps.now ?? Date.now)(),
      dayOf: this.deps.dayOf ?? dayOfLocal,
      get: (id) => agenda.get(id),
      titles: fetched.titles,
      fallbackTitle: this.deps.fallbackTitle ?? ((appid) => `Steam ${appid}`),
      software: fetched.software,
    });
  }

  /** Los deseados que se añadirían: ni de la biblioteca, ni ya apuntados, ni quitados (ADR-014). */
  private wishesFor(fetched: Fetched): number {
    const agenda = this.deps.agenda as SteamAgenda;
    const owned = new Set(fetched.library.owned.map((game) => game.appid));
    return (fetched.library.wishlist ?? []).filter((wish) => {
      const entry = agenda.get(`steam:${wish.appid}`);
      const removed = entry !== undefined && entry.deletedAt !== null;
      return !owned.has(wish.appid) && !removed && !isLive(entry);
    }).length;
  }

  private showReview(withWishlist: boolean): void {
    const fetched = this.fetched;
    if (fetched === null) return;
    this.set({
      kind: 'review',
      plan: this.plan(fetched, withWishlist),
      wishes: this.wishesFor(fetched),
      withWishlist,
      unknown: fetched.unknown,
    });
  }

  /** La casilla de la lista de deseados del resumen (al momento: el *chunk* ya está cargado). */
  setWishlist(withWishlist: boolean): void {
    if (this.state.kind !== 'review' || this.state.withWishlist === withWishlist) return;
    this.showReview(withWishlist);
  }

  /** «Aplicar»: el plan del resumen, recalculado con la agenda de ahora, por lotes. */
  async apply(): Promise<void> {
    const fetched = this.fetched;
    const agenda = this.deps.agenda;
    if (this.state.kind !== 'review' || fetched === null || agenda === undefined) return;
    const generation = this.generation;
    const { mod } = fetched;
    // Con la agenda de ahora: lo apuntado mientras se miraba el resumen no se pisa.
    const plan = this.plan(fetched, this.state.withWishlist);
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

/** Lo que hace falta para preguntar a Steam por los títulos, el software y los logros. */
export interface GatherOptions {
  /** Una petición a `/api/v1` (sin cookies: van con el pase de la biblioteca). */
  readonly request: (path: string, body: unknown) => Promise<Response>;
  readonly mod: typeof import('./steam-apply.ts');
  readonly library: SteamLibrary;
  readonly agenda: SteamAgenda;
  readonly catalogTitles?: (appids: readonly number[]) => Promise<ReadonlyMap<number, string>>;
  /**
   * Solo los logros de los juegos jugados desde este instante (ms): la actualización diaria
   * (ADR-014) no vuelve a preguntar por toda la biblioteca.
   */
  readonly playedSince?: number;
  /** ¿Sigue valiendo lo que se está haciendo? Si no, se para y devuelve `null`. */
  readonly current?: () => boolean;
  readonly onProgress?: (done: number, total: number) => void;
}

export interface Gathered {
  readonly platinum: ReadonlyMap<number, number | null>;
  readonly titles: ReadonlyMap<number, string>;
  readonly unknown: number;
  readonly software: ReadonlySet<number>;
}

/**
 * Antes del plan: los títulos del catálogo; de lo que no está en él, qué es software
 * (`POST /steam/types`, DECISIONES §10.57; si falla, cuenta como juego); y los logros de los
 * jugados con estadísticas, por lotes de `STEAM_ACHIEVEMENTS_BATCH` (`POST /steam/achievements`).
 * Si un lote de logros falla, se sigue sin los que falten (`unknown`). `null` si `current` deja
 * de valer.
 */
export async function gatherSteamData(o: GatherOptions): Promise<Gathered | null> {
  const current = o.current ?? (() => true);
  const { mod, library, agenda } = o;
  const appids = [
    ...library.owned.map((game) => game.appid),
    ...(library.wishlist ?? []).map((wish) => wish.appid),
  ];
  let titles: ReadonlyMap<number, string> = new Map();
  try {
    titles = (await o.catalogTitles?.(appids)) ?? titles;
  } catch {
    // Sin catálogo: el nombre de Steam (el catálogo lo pondrá después; §7.3).
  }
  if (!current()) return null;

  const software = new Set<number>();
  const typeCandidates = mod.typeCandidates(library, titles);
  for (let start = 0; start < typeCandidates.length; start += STEAM_TYPES_BATCH) {
    let found: number[] | null = null;
    try {
      const response = await o.request('/steam/types', {
        token: library.token,
        appids: typeCandidates.slice(start, start + STEAM_TYPES_BATCH),
      });
      if (response.status === 200) found = mod.readSteamTypes(await response.text());
      else await response.body?.cancel();
    } catch {
      found = null;
    }
    if (!current()) return null;
    if (found === null) break;
    for (const appid of found) software.add(appid);
  }

  const since = o.playedSince;
  const played = new Map(library.owned.map((game) => [game.appid, game.lastPlayedAt]));
  const candidates = mod
    .achievementCandidates(library, (id) => agenda.get(id), software)
    .filter((appid) => since === undefined || (played.get(appid) ?? 0) >= since);
  const platinum = new Map<number, number | null>();
  let unknown = 0;
  o.onProgress?.(0, candidates.length);
  for (let start = 0; start < candidates.length; start += STEAM_ACHIEVEMENTS_BATCH) {
    const batch = candidates.slice(start, start + STEAM_ACHIEVEMENTS_BATCH);
    let games: ReturnType<typeof mod.readSteamAchievements> = null;
    try {
      const response = await o.request('/steam/achievements', {
        token: library.token,
        appids: batch,
      });
      if (response.status === 200) games = mod.readSteamAchievements(await response.text());
      else await response.body?.cancel();
    } catch {
      games = null;
    }
    if (!current()) return null;
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
    o.onProgress?.(
      Math.min(start + STEAM_ACHIEVEMENTS_BATCH, candidates.length),
      candidates.length,
    );
  }
  return { platinum, titles, unknown, software };
}

let shared: SteamImportFlow | null = null;

/** Lo que pone la app al crearlo (parte 3): la agenda y los títulos del catálogo. */
export type SteamFlowServices = Pick<
  SteamFlowDeps,
  'agenda' | 'catalogTitles' | 'fallbackTitle' | 'onLinked'
>;

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
