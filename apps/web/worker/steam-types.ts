// Qué apps de una biblioteca de Steam son software y no juegos, para `POST /api/v1/steam/types`
// (DECISIONES §10.57): Wallpaper Engine, Blender, Aseprite… Lo pidió el usuario: «mete ahí lo que
// sea software y no juegos».
//
// - `IStoreBrowseService/GetItems/v1` de la tienda, sin clave (como `resolve`): hasta 200 apps por
//   llamada, solo con sus números. El SteamID64 no sale del servidor: el pase solo sirve para que no
//   lo use cualquiera.
// - Software es `type` 6 (`EStoreAppType`): lo dan así todos los programas probados el 21-11-2026
//   (Wallpaper Engine, Blender, Aseprite, Lossless Scaling, Soundpad…), y los juegos, 0. Lo que la
//   tienda no enseña (herramientas internas, apps retiradas, bloqueadas en el país) no trae `type`:
//   cuenta como juego, para no llevarse nunca un juego a Software.

import { steamItemsResponseSchema } from '@gameagenda/core/api';
import type { SteamFetch } from './env.ts';
import { readCapped } from './http.ts';

const ITEMS_API = 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/';
/** `EStoreAppType` de Software. */
export const STEAM_SOFTWARE_TYPE = 6;
export const TYPES_TIMEOUT_MS = 8000;
/** Sin `data_request`, cada app son ≈150 bytes: 200 apps, ≈30 KB. */
export const TYPES_MAX_BYTES = 256 * 1024;

export function typesUrl(appids: readonly number[]): string {
  const input = {
    ids: appids.map((appid) => ({ appid })),
    context: { language: 'spanish', country_code: 'ES' },
    data_request: {},
  };
  return `${ITEMS_API}?input_json=${encodeURIComponent(JSON.stringify(input))}`;
}

/** Las apps pedidas que la tienda da como software, o `null` si Steam no ha contestado bien. */
export async function fetchSoftware(
  appids: readonly number[],
  fetch: SteamFetch,
): Promise<number[] | null> {
  let json: unknown;
  try {
    const response = await fetch(typesUrl(appids), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TYPES_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const bytes = await readCapped(response, TYPES_MAX_BYTES);
    if (bytes === null) return null;
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  const parsed = steamItemsResponseSchema.safeParse(json);
  if (!parsed.success) return null;
  // Solo las pedidas: lo que no se ha pedido no sale, aunque Steam lo mande.
  const asked = new Set(appids);
  const software = new Set<number>();
  for (const item of parsed.data.response.store_items) {
    if (
      item.success === 1 &&
      item.type === STEAM_SOFTWARE_TYPE &&
      item.appid !== undefined &&
      asked.has(item.appid)
    ) {
      software.add(item.appid);
    }
  }
  return [...software];
}
