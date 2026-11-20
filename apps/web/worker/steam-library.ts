// La biblioteca y la lista de deseados de una cuenta de Steam, para `POST /api/v1/steam/redeem`
// (Fase 2, parte 2; §10.1 de prototipe.md; ADR-012). Solo se llama con el SteamID64 de un login
// verificado y canjeado con su verificador.
//
// El Worker no lee la biblioteca: con 5 000 juegos pesa ≈1,7 MB, y leerla y validarla con Zod se
// come el presupuesto de CPU (17–23 ms en frío). La pasa tal cual, en *streaming*, contando bytes,
// y la valida la app (`steamImportResponseSchema` de core). La lista de deseados, que pesa pocos
// KB, se lee entera con tope y se comprueba que es JSON, para que un fallo suyo no rompa la
// respuesta: sale `null`. La respuesta es
// `{"token": <pase de los logros>, "owned": <GetOwnedGames>, "wishlist": <GetWishlist>}`.

import { STEAM_IMPORT_MAX_BYTES } from '@gameagenda/core/api';
import type { SteamFetch } from './env.ts';
import { readCapped } from './http.ts';

const OWNED_API = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/';
const WISHLIST_API = 'https://api.steampowered.com/IWishlistService/GetWishlist/v1/';
/** Una biblioteca grande tarda unos segundos en llegar entera. */
export const OWNED_TIMEOUT_MS = 15_000;
export const WISHLIST_TIMEOUT_MS = 5000;
/** ≈19 000 deseados; leerla y comprobarla cuesta, como mucho, unos 4 ms. */
export const WISHLIST_MAX_BYTES = 1024 * 1024;

export function ownedGamesUrl(steamId: string): string {
  const query = new URLSearchParams({
    steamid: steamId,
    include_appinfo: 'true',
    include_played_free_games: 'true',
    skip_unvetted_apps: 'false',
    format: 'json',
  });
  return `${OWNED_API}?${query}`;
}

export function wishlistUrl(steamId: string): string {
  return `${WISHLIST_API}?${new URLSearchParams({ steamid: steamId, format: 'json' })}`;
}

function isJson(response: Response): boolean {
  return /^application\/json\s*(?:;|$)/i.test(response.headers.get('Content-Type') ?? '');
}

/** La lista de deseados entera, comprobada como JSON; `null` si Steam no la da. */
async function fetchWishlist(steamId: string, fetch: SteamFetch): Promise<Uint8Array | null> {
  try {
    const response = await fetch(wishlistUrl(steamId), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(WISHLIST_TIMEOUT_MS),
    });
    if (!response.ok || !isJson(response)) {
      await response.body?.cancel();
      return null;
    }
    const bytes = await readCapped(response, WISHLIST_MAX_BYTES);
    if (bytes === null) return null;
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return bytes;
  } catch {
    return null;
  }
}

export type LibraryResult =
  | { readonly ok: true; readonly body: ReadableStream<Uint8Array> }
  /** `busy`: Steam ha respondido 429; `unavailable`: lo demás. */
  | { readonly ok: false; readonly error: 'busy' | 'unavailable'; readonly status: number | null };

/**
 * Pide a la vez la biblioteca (con la clave en `x-webapi-key`, nunca en la URL) y la lista de
 * deseados (sin clave), y devuelve el cuerpo de la respuesta, que se escribe mientras llega la
 * biblioteca, con `token` (el pase de los logros) delante. Si pasa de `maxBytes`
 * (`STEAM_IMPORT_MAX_BYTES`), el *stream* se corta con un error.
 */
export async function fetchLibrary(
  steamId: string,
  key: string,
  token: string,
  fetch: SteamFetch,
  maxBytes = STEAM_IMPORT_MAX_BYTES,
): Promise<LibraryResult> {
  const wishlist = fetchWishlist(steamId, fetch);
  let owned: Response;
  try {
    owned = await fetch(ownedGamesUrl(steamId), {
      headers: { Accept: 'application/json', 'x-webapi-key': key },
      signal: AbortSignal.timeout(OWNED_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: 'unavailable', status: null };
  }
  if (!owned.ok || !isJson(owned) || owned.body === null) {
    await owned.body?.cancel();
    return {
      ok: false,
      error: owned.status === 429 ? 'busy' : 'unavailable',
      status: owned.status,
    };
  }
  return { ok: true, body: importStream(token, owned.body, wishlist, maxBytes) };
}

/**
 * `{"token":"…","owned":` + la biblioteca tal cual + `,"wishlist":` + los deseados (o `null`) +
 * `}`. El pase es base64url: no hay nada que escapar.
 */
function importStream(
  token: string,
  owned: ReadableStream<Uint8Array>,
  wishlist: Promise<Uint8Array | null>,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const reader = owned.getReader();
  let started = false;
  let size = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(encoder.encode(`{"token":"${token}","owned":`));
        return;
      }
      const { done, value } = await reader.read();
      if (!done) {
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          controller.error(new Error('steam_import_too_large'));
          return;
        }
        controller.enqueue(value);
        return;
      }
      const tail = await wishlist;
      controller.enqueue(encoder.encode(',"wishlist":'));
      controller.enqueue(tail ?? encoder.encode('null'));
      controller.enqueue(encoder.encode('}'));
      controller.close();
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
