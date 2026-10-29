## 4. Estudio: cómo obtener **todos** los juegos de Steam

> Todo lo de esta sección se ha comprobado el **28-10-2026** con llamadas reales a Steam, con la documentación oficial de Steamworks y con las definiciones protobuf publicadas por SteamDatabase. Un segundo agente intentó refutar cada dato crítico. Donde un dato viene de la comunidad y no de Valve, se indica.

### 4.1 Situación actual (octubre de 2026)

- **El método clásico ya no existe.** `ISteamApps/GetAppList/v2` (la lista completa sin clave que usan casi todos los tutoriales) desapareció de la API pública el **13-11-2025** y hoy responde `404 Method 'GetAppList' not found in interface 'ISteamApps'`. Valve lo marca como *deprecated* porque *"can no longer scale to the number of items available on Steam"*. Cualquier librería o guía que lo use está rota.
- **El sustituto oficial es `IStoreService/GetAppList/v1`.** Está documentado y **exige una Web API key**: sin clave responde `403 Access is denied`.
- **Steam no envía cabeceras CORS** en `api.steampowered.com` ni en `store.steampowered.com`, así que un navegador **no puede** leer ninguna API de Steam directamente. El CDN de imágenes sí las envía (`Access-Control-Allow-Origin: *`).

### 4.2 Fuentes evaluadas

| Fuente | ¿Clave? | ¿Documentada? | Qué aporta | Límites / problemas | Decisión |
|---|---|---|---|---|---|
| `IStoreService/GetAppList/v1` | **Sí** (clave de usuario) | **Sí** | `appid`, nombre base, `last_modified` y `price_change_number`; filtros por tipo; cambios con `if_modified_since`; páginas de hasta 50 000 | 100 000 llamadas/día (ToU); todo el catálogo de juegos son **4 llamadas** | **Columna vertebral** del catálogo |
| `IStoreQueryService/Query/v1` | No (hoy) | No | 1 000 ítems por llamada; orden estable por `appid` (`sort=2`); filtros `released_only`, `coming_soon_only`, tipo y descriptores; con `data_request` devuelve fichas completas | Depende de `country_code` (oculta juegos bloqueados por región); puede cambiar sin aviso | Enriquecimiento masivo **y** plan B sin clave |
| `IStoreBrowseService/GetItems/v1` | No (hoy) | No | Por lotes (≈200‑250 ids por GET): tipo, nombre localizado, lanzamiento, «próximamente», *early access*, retirado (`unlisted`), descriptores de contenido, reseñas, imágenes, plataformas y Steam Deck | `context.country_code` obligatorio (si falta, la respuesta llega vacía); URL ≤ ~8 KB | Detalle bajo demanda y juegos que faltan |
| `store.steampowered.com/api/appdetails` | No | No | Ficha completa (géneros con nombre, logros, Metacritic…) | 1 app por llamada (~42 KB); ~200 peticiones/5 min; fechas como texto localizado | Solo bajo demanda y excepcional |
| `storesearch` / `SearchSuggestions` | No | No | Búsqueda remota | 250‑380 ms por consulta, mezcla DLC y bandas sonoras, sin CORS | No en el camino crítico (como mucho, *fallback*) |
| `GetTagList` / `GetStoreCategories` | No | No | 446 etiquetas y 72 categorías en español (con `version_hash`) | — | Tablas estáticas que se refrescan cada semana |
| SteamSpy | No | Propia | Estimación de propietarios y etiquetas | 1 petición/60 s para `all`; datos desfasados (730 sigue llamándose «CS:GO») | Descartado |
| PICS (SteamKit2 / `steam-user`) | No (anónimo) | No | Todo, incluidos los juegos retirados | Protocolo del cliente de Steam: zona gris según el Acuerdo de Suscriptor | Descartado |
| SteamDB | — | — | — | No tiene API y prohíbe el *scraping* | Descartado |
| `jsnli/steamappidlist` (GitHub) | — | — | Volcado diario no oficial de `GetAppList` | Sin licencia; depende de la clave de un tercero | **Solo** como semilla o *fixture* en desarrollo |

### 4.3 Cifras del catálogo (28-10-2026)

| Métrica | Valor |
|---|---|
| Apps en el índice de la tienda | ≈ 317 800 |
| **Juegos** (tipo *game*) | **≈ 196 600** = ≈ 133 900 publicados + ≈ 62 700 «próximamente» (+ ~50 en ningún estado) |
| DLC / demos / bandas sonoras / software | ≈ 63 100 / 43 400 / 11 600 / 2 900 |
| Juegos solo para adultos (descriptor 3) | ≈ 9 700 |
| Juegos que cambian al día | ≈ 3 300 (≈ 15 700 a la semana) |
| Lanzamientos en 2025 (SteamDB vía prensa) | ≈ 21 300 |
| Índice `[appid, nombre]` de **todos** los juegos | 5,98 MB JSON · **2,64 MB gzip** · **1,91 MB brotli** |
| Nombres | media 17,6 bytes, máximo 542; 18 vacíos; ~1 000 con ™/®; 8,1 % con caracteres no ASCII; 6,3 % CJK/hangul |

**Conclusión:** el catálogo completo de juegos cabe en un fichero de unos 2 MB comprimido. Eso permite **buscar en el propio dispositivo**, sin red, en menos de 1 ms (ver §8).

### 4.4 Estrategia elegida: columna vertebral + enriquecimiento + plan B

1. **Columna vertebral (con clave):** `IStoreService/GetAppList/v1` con `include_games=true`, desde un **job programado** (nunca desde la app), con **una sola clave** guardada como secreto. Es la única fuente documentada y no depende de la región. Así se cumplen los ToU: la licencia es *"personal to you and specific to your Application"* y la clave debe seguir siendo confidencial.
2. **Enriquecimiento (sin clave):** una pasada de `IStoreQueryService/Query` (≈197 llamadas de 1 000 ítems) da tipo, fechas, «próximamente», portadas, reseñas y descriptores de adultos de todo el catálogo. Los `appid` que Query no devuelve (bloqueados por región, retirados) se completan con `GetItems` por lotes de 200.
3. **Plan B:** si la clave falla o la revocan, el mismo job enumera el catálogo solo con Query (`sort=2`, sin clave) y lo concilia con `total_matching_records`. Si los endpoints sin clave cambian o desaparecen, **el último snapshot publicado sigue funcionando**: la app nunca depende de Steam en tiempo real para buscar ni para apuntar.

### 4.5 Algoritmo de ingesta (job diario)

```text
JOB catalog-sync (diario, p. ej. 03:17 UTC; también manual)
 1. ENUMERAR (clave):
      cursor = 0
      repetir:
        GET https://api.steampowered.com/IStoreService/GetAppList/v1/
            ?include_games=true&max_results=50000&last_appid={cursor}
            cabecera x-webapi-key: $STEAM_WEB_API_KEY
        acumular apps[] → {appid, name, last_modified, price_change_number}
        cursor = response.last_appid
      mientras response.have_more_results            # ≈ 4 llamadas, ≈ 20 MB
 2. ENRIQUECER (sin clave):
      para start = 0, 950, 1900, …                   # solapamiento de 50
        Query{ start, count: 1000, sort: 2, filters.type_filters.include_games,
               context: {language: "spanish", country_code: "ES"},
               data_request: {include_release, include_assets, include_reviews} }
      deduplicar por appid; los appid de (1) que falten → GetItems por lotes de 200
        (contextos ES y US) para distinguir: retirado (unlisted:true) ·
        bloqueado por región (success 15 + unvailable_for_country_restriction) ·
        inexistente (success 15 + appid 0)
 3. NORMALIZAR: nombre base + alias en español si difiere; nombre plegado
      (minúsculas, sin acentos ni ™®, guiones y signos → espacio, «III» ↔ «3»);
      año; flags (próximamente, early access, adulto, gratis, retirado);
      popularidad = log2(review_count) en 1 byte; ruta de portada
 4. VALIDAR: nº de juegos dentro de ±2 % del snapshot anterior; sin nombres vacíos
      ni appid duplicados; si falla → no publicar y avisar
 5. PUBLICAR: ficheros versionados + delta respecto a la versión anterior +
      manifest.json (versión, recuentos, sha256); conservar las 7 últimas versiones
```

**Política HTTP:** un único *worker* y como mucho **0,4 peticiones/s** (la comunidad mide ~120 peticiones cada 5 min por IP). Se comprueban el código HTTP y la cabecera `X-eresult`.
- **429:** *backoff* exponencial con *jitter* de 60 s a 15 min; tras 5 seguidos se aborta y se reanuda en la siguiente ejecución.
- **5xx:** hasta 5 reintentos (2, 4, 8, 16 y 32 s).
- **403 con clave:** se para y se alerta (clave revocada o cuenta limitada).

**Presupuesto:** ≈ 4 llamadas con clave + ≈ 200 sin clave al día, unos 10 minutos. Los ToU limitan las llamadas que hace *el licenciatario*, no las de cada clave, así que conviene contar también las que no usan clave: ≈ 204 al día, el **0,2 %** del límite de 100 000. Una optimización posterior es usar `if_modified_since` (≈3 300 cambios/día) en lugar de la reconstrucción completa. Para el prototipo, la **reconstrucción completa + *diff*** es más simple y no necesita guardar estado.

### 4.6 Casos límite y decisiones de producto

| Caso | Decisión |
|---|---|
| **«Próximamente»** (≈32 % de los juegos, muchos con «Por confirmar» desde hace años) | Se incluyen, porque apuntar juegos futuros es un caso de uso clave. Se muestra la fecha (o «Por confirmar») y bajan en el *ranking* si son TBA antiguos. |
| **Retirados de la tienda** (*delisted*; no salen en `GetAppList` ni en Query) | Si el usuario pega la URL o el `appid`, `GetItems` los encuentra (`unlisted:true`) y se añaden con la insignia «Retirado de la tienda». Nunca se borra un juego que esté en la lista de alguien. |
| **SKU regionales** con nombres duplicados (p. ej. dos «Fallout: New Vegas») | Se deduplican por nombre normalizado y se prefiere el visible en ES. |
| **Contenido adulto** (descriptores 3 y 4) | Oculto por defecto; se puede activar en Ajustes. |
| **Basura** (18 nombres vacíos; marcadores como «TestApp» o «UNTITLED») | Lista negra **exacta**, no por prefijo (si no, se perdería «Untitled Goose Game»). |
| **Nombres localizados** (≈0,5 % de los juegos antiguos y ≈4 % de los nuevos difieren en español) | Se indexan el nombre base y el alias en español. La entrada del usuario guarda el `appid` y una copia del nombre. |
| **Demos con tipo *game*** | Se mantienen: en Steam son tipo 0 y un filtro de tipo no las ocultaría. |
| **DLC** (≈63 000) | Fuera del MVP. Se pueden activar después con `include_dlc` (+2 llamadas). |

### 4.7 Imágenes (portadas)

- **Fórmula correcta:** `https://shared.akamai.steamstatic.com/store_item_assets/` + `asset_url_format`, con `${FILENAME}` sustituido por el nombre del recurso. Por ejemplo, para CS2: `steam/apps/730/${FILENAME}?t=1793054556` + `162664aa…/header.jpg`.
- **Portada vertical:** `assets.library_capsule` (600×900). El nombre varía: `library_600x900.jpg`, `<sha1>/library_capsule.jpg` en los juegos nuevos y a veces `…_spanish.jpg`. **Alternativas:** `header`, después `main_capsule` y, si no hay nada, un *placeholder* generado (hay apps sin ningún recurso).
- **Nunca adivinar** las rutas antiguas sin *hash*: dan 404 en los juegos nuevos y arte obsoleto en los antiguos.
- El CDN sirve las imágenes con `Access-Control-Allow-Origin: *` y caché de unos 10 años. Las URL cambian cuando cambia el arte, así que se pueden cachear «para siempre» en el dispositivo. En listas se usa `small_capsule` (231×87, ~9,5 KB) con `loading="lazy"` y tamaño fijo.
- **Privacidad:** al cargar imágenes del CDN, la IP del usuario llega a Valve. Hay que indicarlo en la política de privacidad (§11).

### 4.8 Restricciones que condicionan la arquitectura

1. **Sin CORS** → el navegador no puede llamar a Steam: o el catálogo llega como **fichero estático**, o hace falta un **proxy propio**, o HTTP nativo (Tauri).
2. **Clave confidencial** → solo puede vivir en CI o en el servidor. **Nunca** en la PWA, ni en un binario de escritorio o móvil.
3. **Límites desconocidos** (por IP) → Steam no puede estar en el camino crítico del usuario; todo se cachea.
4. **Endpoints sin clave no documentados** → *feature flags*, plan B y el snapshot publicado como colchón.
