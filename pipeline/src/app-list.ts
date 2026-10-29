// Etapa 1 · Lista (§4.5), solo con clave: `IStoreService/GetAppList/v1` con `x-webapi-key`,
// páginas de 50 000 a partir de `last_appid` mientras `have_more_results`. En el plan B (sin
// clave) se salta y L := ids de Q.

import type { SteamClient } from '../steam/client.ts';
import { APP_LIST_PAGE, appListUrl } from '../steam/endpoints.ts';
import { type AppListEntry, appListResponseSchema } from '../steam/schemas.ts';

/** Nombre de la página cruda: `getapplist-0000000000`. */
export function appListPageName(lastAppid: number): string {
  return `getapplist-${String(lastAppid).padStart(10, '0')}`;
}

export async function appListPass(
  client: SteamClient,
  options: { maxResults?: number; minApps?: number } = {},
): Promise<Map<number, AppListEntry>> {
  const apps = new Map<number, AppListEntry>();
  let last = 0;
  for (;;) {
    const r = await client.get(
      appListUrl(last, options.maxResults ?? APP_LIST_PAGE),
      appListResponseSchema,
      appListPageName(last),
    );
    for (const a of r.response.apps) apps.set(a.appid, a);
    if (!r.response.have_more_results) break;
    const next = r.response.last_appid ?? 0;
    if (next <= last) throw new Error(`GetAppList no avanza (last_appid ${next})`);
    last = next;
  }
  // Una lista vacía (o casi) haría desaparecer todo el catálogo: falla la etapa.
  if (apps.size < (options.minApps ?? 1)) {
    throw new Error(`GetAppList devolvió ${apps.size} juegos`);
  }
  return apps;
}
