// Contratos Zod de las respuestas de Steam (§12.2): solo describen los campos que usa el
// pipeline. Ignoran los desconocidos (Zod los quita al leer) y exigen los obligatorios, para que
// un cambio de Steam rompa la etapa en lugar de colar datos malos (§4.7).

import { z } from 'zod';

const uint = z.int().nonnegative();

/** Fechas y precisión de `release` (`include_release`). */
const releaseSchema = z.object({
  steam_release_date: uint.optional(),
  original_release_date: uint.optional(),
  is_coming_soon: z.boolean().optional(),
  is_early_access: z.boolean().optional(),
  /** `date_full`, `date_month`, `date_quarter`, `date_year`, `text_comingsoon`, `text_tba`… */
  coming_soon_display: z.string().optional(),
});

/** Reseñas (`include_reviews`): la popularidad sale de `summary_filtered.review_count`. */
const reviewsSchema = z.object({
  summary_filtered: z.object({ review_count: uint.optional() }).optional(),
});

/**
 * Juego tal como lo devuelven Query y `GetItems` (`StoreItem`). Steam omite los booleanos falsos
 * y las listas vacías: `is_free`, `is_early_access`, `is_coming_soon`, `unlisted` y
 * `content_descriptorids` solo llegan cuando aplican.
 */
const storeItemFields = {
  /** EResult por juego: 1 correcto; 15 sin acceso (inexistente o bloqueado por país). */
  success: z.int().optional(),
  visible: z.boolean().optional(),
  /** Así, con la errata de Steam. */
  unvailable_for_country_restriction: z.boolean().optional(),
  unlisted: z.boolean().optional(),
  name: z.string().optional(),
  /** *Slug* del nombre base (inglés) en la URL de la tienda: `CounterStrike_2`. */
  store_url_slug: z.string().optional(),
  is_free: z.boolean().optional(),
  is_early_access: z.boolean().optional(),
  is_coming_soon: z.boolean().optional(),
  content_descriptorids: z.array(z.int()).optional(),
  release: releaseSchema.optional(),
  reviews: reviewsSchema.optional(),
};

/** Juego de Query: siempre trae `appid` y `type`. */
export const queryItemSchema = z.object({
  ...storeItemFields,
  appid: z.int().positive(),
  type: uint,
});

/** Juego de `GetItems`: con `success 15` puede faltar el `appid` (o valer 0) y el tipo. */
export const getItemsItemSchema = z.object({
  ...storeItemFields,
  success: z.int(),
  appid: uint.optional(),
  /** `appid` pedido (`StoreItemID`); se usa cuando falta `appid`. */
  id: uint.optional(),
  type: uint.optional(),
});

export type QueryItem = z.infer<typeof queryItemSchema>;
export type GetItemsItem = z.infer<typeof getItemsItemSchema>;
/** Campos comunes de un juego de la tienda, venga de Query o de `GetItems`. */
export type StoreItem = QueryItem | GetItemsItem;

/** `IStoreQueryService/Query/v1`. */
export const queryResponseSchema = z.object({
  response: z.object({
    metadata: z.object({
      total_matching_records: uint,
      start: uint.optional(),
      count: uint.optional(),
    }),
    store_items: z.array(queryItemSchema).default([]),
  }),
});

/** `IStoreBrowseService/GetItems/v1`. */
export const getItemsResponseSchema = z.object({
  response: z.object({
    store_items: z.array(getItemsItemSchema).default([]),
  }),
});

/** `IStoreService/GetAppList/v1` (con clave). */
export const appListResponseSchema = z.object({
  response: z.object({
    apps: z
      .array(
        z.object({
          appid: z.int().positive(),
          name: z.string().default(''),
          last_modified: uint.optional(),
          price_change_number: uint.optional(),
        }),
      )
      .default([]),
    have_more_results: z.boolean().optional(),
    last_appid: uint.optional(),
  }),
});

export type QueryResponse = z.infer<typeof queryResponseSchema>;
export type GetItemsResponse = z.infer<typeof getItemsResponseSchema>;
export type AppListResponse = z.infer<typeof appListResponseSchema>;
export type AppListEntry = AppListResponse['response']['apps'][number];
