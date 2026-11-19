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
// 4. `done`: la biblioteca y los deseados, leídos y validados aquí (`steam-library.ts`, en un
//    *chunk* aparte). En esta parte solo se resumen: la agenda no cambia.
//
// Las peticiones van sin *cookies* (`credentials: 'omit'`: el login no depende de la
// sincronización), sin `Referer` y sin caché.

import { API_BASE } from '@gameagenda/core/api';
import type { SteamLibrary } from './steam-library.ts';

export type SteamImportFailure =
  | 'expired'
  | 'offline'
  | 'unavailable'
  | 'busy'
  | 'disabled'
  | 'rateLimited';

export type SteamImportState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  /** El ticket está listo: falta pulsar el botón de Steam. */
  | { readonly kind: 'ready'; readonly url: string }
  /** Steam está abierto en otra ventana; `stillPending` tras un «Ya he iniciado sesión» sin login. */
  | { readonly kind: 'waiting'; readonly url: string; readonly stillPending: boolean }
  | { readonly kind: 'loading' }
  | { readonly kind: 'done'; readonly library: SteamLibrary }
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

export class SteamImportFlow {
  private state: SteamImportState = IDLE;
  private ticket: Ticket | null = null;
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
    if (this.state.kind === 'starting' || this.state.kind === 'loading') return;
    const generation = ++this.generation;
    this.ticket = null;
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
      this.set(
        library === null
          ? { kind: 'failed', reason: 'unavailable', retry: false }
          : { kind: 'done', library },
      );
    } finally {
      this.redeeming = false;
    }
  }

  /** «Cancelar» y «Listo»: se olvida el ticket y lo traído. */
  reset(): void {
    this.generation++;
    this.ticket = null;
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

/** El de la app: uno, con `fetch`, `window` y `document` de verdad. */
export function steamImportFlow(): SteamImportFlow {
  shared ??= new SteamImportFlow({
    fetch: (input, init) => fetch(input, init),
    win: window,
    doc: document,
  });
  return shared;
}
