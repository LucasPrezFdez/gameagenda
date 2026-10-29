// Etapa 3 · Huecos (§4.5 y §4.9): `GetItems` sin clave en lotes ≤200 y clasificación de cada
// juego: retirado (`unlisted`), inexistente (`success 15` + `appid 0`), bloqueado por país (se
// pide en US) o visible. `success 15` solo nunca es «eliminado».

import { createHash } from 'node:crypto';
import type { SteamClient } from '../steam/client.ts';
import { ES, GET_ITEMS_BATCH, getItemsUrl, type StoreContext, US } from '../steam/endpoints.ts';
import { type GetItemsItem, getItemsResponseSchema } from '../steam/schemas.ts';

const SUCCESS_OK = 1;
const SUCCESS_NO_ACCESS = 15;

/** Nombre de la página cruda de un lote: `getitems-spanish-es-<hash>`. */
export function getItemsPageName(appids: readonly number[], ctx: StoreContext): string {
  const h = createHash('sha256').update(appids.join(',')).digest('hex').slice(0, 16);
  return `getitems-${ctx.language}-${ctx.country.toLowerCase()}-${h}`;
}

/**
 * `appid` de cada juego devuelto. Con `success 15` Steam deja `appid` a 0 y a veces también
 * `id`; entonces vale la posición, si devolvió uno por cada pedido.
 */
function mapItems(
  asked: readonly number[],
  items: readonly GetItemsItem[],
): Map<number, GetItemsItem> {
  const out = new Map<number, GetItemsItem>();
  const askedSet = new Set(asked);
  items.forEach((it, i) => {
    const byField = it.appid || it.id || 0;
    const appid = askedSet.has(byField)
      ? byField
      : items.length === asked.length
        ? (asked[i] as number)
        : 0;
    if (appid > 0 && !out.has(appid)) out.set(appid, it);
  });
  return out;
}

/** `GetItems` de `appids` (ordenados y sin repetir) en lotes de ≤200, en un contexto. */
export async function getItems(
  client: SteamClient,
  appids: Iterable<number>,
  ctx: StoreContext,
): Promise<Map<number, GetItemsItem>> {
  const ids = [...new Set(appids)].sort((a, b) => a - b);
  const out = new Map<number, GetItemsItem>();
  for (let i = 0; i < ids.length; i += GET_ITEMS_BATCH) {
    const batch = ids.slice(i, i + GET_ITEMS_BATCH);
    const r = await client.get(
      getItemsUrl(batch, ctx),
      getItemsResponseSchema,
      getItemsPageName(batch, ctx),
    );
    for (const [appid, it] of mapItems(batch, r.response.store_items)) out.set(appid, it);
  }
  return out;
}

/**
 * Clase de un juego en el estado (§4.6): `visible`, `retired` (retirado, se conserva con la
 * insignia), `blocked` (bloqueado por país, se conserva con su nombre), `deleted` (inexistente,
 * se elimina) o `unknown` (sin respuesta clara: se conserva lo que hubiera).
 */
export type GameClass = 'visible' | 'retired' | 'blocked' | 'deleted' | 'unknown';

export interface Classified {
  readonly cls: GameClass;
  /** Datos con los que se enriquece: los de ES si es visible allí; si no, los de US. */
  readonly item: GetItemsItem | null;
  /** País de `item`. */
  readonly country: 'ES' | 'US' | null;
  /** Motivo legible para el informe. */
  readonly reason: string;
}

/** `true` si `GetItems` dice que el juego está bloqueado en ese país. */
export function isCountryRestricted(it: GetItemsItem | undefined): boolean {
  return Boolean(it && it.success === SUCCESS_NO_ACCESS && it.unvailable_for_country_restriction);
}

function hasName(it: GetItemsItem): boolean {
  return Boolean(it.name?.trim());
}

/** Clasifica un juego con su respuesta en ES y, si estaba bloqueado en ES, la de US. */
export function classify(es: GetItemsItem | undefined, us?: GetItemsItem): Classified {
  if (!es) return { cls: 'unknown', item: null, country: null, reason: 'GetItems no lo devuelve' };
  if (es.success === SUCCESS_OK) {
    if (es.unlisted) return { cls: 'retired', item: es, country: 'ES', reason: 'unlisted' };
    if (es.visible === false) {
      return { cls: 'unknown', item: es, country: 'ES', reason: 'success 1 sin visible' };
    }
    return { cls: 'visible', item: es, country: 'ES', reason: 'visible en ES' };
  }
  if (es.success === SUCCESS_NO_ACCESS) {
    if (!es.appid && !hasName(es)) {
      return { cls: 'deleted', item: null, country: null, reason: 'success 15 + appid 0' };
    }
    if (es.unvailable_for_country_restriction) {
      if (us?.success === SUCCESS_OK) {
        if (us.unlisted)
          return { cls: 'retired', item: us, country: 'US', reason: 'unlisted (US)' };
        return {
          cls: 'blocked',
          item: us,
          country: 'US',
          reason: 'bloqueado en ES, visible en US',
        };
      }
      return {
        cls: 'blocked',
        item: hasName(es) ? es : (us ?? null),
        country: hasName(es) ? 'ES' : us ? 'US' : null,
        reason: 'bloqueado en ES y en US',
      };
    }
    return { cls: 'unknown', item: es, country: 'ES', reason: 'success 15 sin restricción' };
  }
  return { cls: 'unknown', item: es, country: 'ES', reason: `success ${es.success}` };
}

/** Clasifica `appids` con `GetItems` en ES y pide en US los bloqueados en ES (§4.5, paso 3). */
export async function classifyAppids(
  client: SteamClient,
  appids: Iterable<number>,
): Promise<Map<number, Classified>> {
  const ids = [...new Set(appids)];
  const out = new Map<number, Classified>();
  if (ids.length === 0) return out;
  const es = await getItems(client, ids, ES);
  const restricted = ids.filter((a) => isCountryRestricted(es.get(a)));
  const us = restricted.length > 0 ? await getItems(client, restricted, US) : new Map();
  for (const a of ids) out.set(a, classify(es.get(a), us.get(a)));
  return out;
}
