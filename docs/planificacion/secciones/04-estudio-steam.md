## 4. Estudio: cómo obtener todos los juegos de Steam

> Comprobado el **28-10-2026** con llamadas reales, la documentación de Steamworks y los protobuf de SteamDatabase; se señala lo que viene de la comunidad.

### 4.1 Situación actual (octubre de 2026)

- **El método clásico ya no existe:** `ISteamApps/GetAppList/v2`, la lista sin clave de casi todos los tutoriales, salió de la API el 13-11-2025 y hoy responde 404; según Valve, «*can no longer scale to the number of items available on Steam*».
- **El sustituto oficial, `IStoreService/GetAppList/v1`, exige Web API key** (sin ella, `403 Access is denied`). Sirve una clave de usuario en `api.steampowered.com` (nunca `partner.steam-api.com`); pedirla requiere una cuenta no limitada (≥5 US$ gastados) con Steam Guard en el móvil. Los términos de uso de la Web API (*Terms of Use*, ToU) fijan 100 000 llamadas/día, clave confidencial y licencia «*personal to you and specific to your Application*»: una sola clave, nunca en el cliente (ver §11).
- **Sin CORS** en `api.steampowered.com` ni en `store.steampowered.com`: el navegador no puede leerlas. El CDN de imágenes sí envía `Access-Control-Allow-Origin: *`.
- **Lo que va sin clave no está documentado:** `IStoreQueryService/Query` e `IStoreBrowseService/GetItems` responden sin clave, pero faltan en la lista oficial y `steamcommunity.com/dev` dice que toda la Web API requiere clave: son de mejor esfuerzo, con plan B (§4.8).

Fuentes: <https://partner.steamgames.com/doc/webapi/IStoreService> · <https://steamcommunity.com/dev/apiterms>

### 4.2 Fuentes evaluadas

| Fuente | Clave / documentada | Qué aporta | Límites | Uso |
|---|---|---|---|---|
| `IStoreService/GetAppList/v1` | **Sí / sí** | `appid`, nombre base, `last_modified`, `price_change_number`; 50 000 por página | 100 000 llamadas/día; sin retirados ni demos | **Columna vertebral** desde M2 |
| `IStoreQueryService/Query/v1` | No / no | 1 000 juegos por llamada; orden estable con `sort=2`; filtros por tipo y estado | Filtra por `country_code`; el total varía en plena pasada | **Enriquecimiento** diario; enumeración en M1 y plan B |
| `IStoreBrowseService/GetItems/v1` | No / no | Lo mismo por lotes, más `unlisted` y la restricción por país | `country_code` obligatorio; URL ≤≈8 KB → ≤200 ids | **Huecos y clasificación**; en M4, `appid` desconocidos |
| `appdetails` (tienda) | No / no | Géneros, logros, Metacritic | 1 app por llamada; ≈200/5 min (histórico); no detecta retirados | No se usa |
| `storesearch` / `SearchSuggestions` | No / no | Búsqueda remota | ≈0,3 s; `storesearch`, 10 resultados como mucho | No: búsqueda local (ver §8) |
| `GetTagList` / `GetStoreCategories` | No / no | 446 etiquetas y 72 categorías en español | — | Fase 2 |
| SteamSpy | No / propia | Propietarios estimados | 1 petición/60 s; desfasado (730 aún es «Counter-Strike: Global Offensive») | Descartado |
| PICS (`steam-user`) | No / no | Casi todo, también retirados | Protocolo del cliente: zona gris del Acuerdo de Suscriptor | Descartado |
| SteamDB | — | — | Sin API; prohíbe el *scraping* | Descartado |
| `jsnli/steamappidlist` | — | Volcado diario de `GetAppList` | Sin fichero de licencia; clave de un tercero | Contraste en desarrollo |

### 4.3 Cifras del catálogo (28-10-2026)

| Métrica | Valor | Origen |
|---|---|---|
| **Juegos** | **196 595** (18 sin nombre → 196 577) | `GetAppList`, 27-10-2026 |
| Visibles por país | US 196 621 (133 882 publicados + 62 686 «próximamente» + 53 sin estado); ES 196 615 a las 01:30 y 196 684 a las 12:14 | Query, 28-10-2026 |
| DLC (fuera del prototipo) | 63 919 / 63 079: la primera no filtra por país y es de la víspera | `GetAppList` / Query US |
| Demos / bandas sonoras / software | ≈43 400 / ≈11 600 / ≈2 900 | Query US |
| Solo adultos | ≈9 700 (descriptor 3); 10 214 (3 o 4) | Query US / ES |
| Cambios al día | ≈3 300 juegos; ≈264 altas, ≈8 bajas y ≈17 renombrados | `GetAppList`, 26-10-2026 y 27-10-2026 |
| Nombres | media 17,6 B, máximo 542 B; 985 con ™®©; 8,1 % no ASCII; 6,3 % CJK, kana o hangul | `GetAppList` |
| Índice solo `[appid, nombre]` (referencia) | 5,98 MB JSON · 2,64 MB gzip · 1,91 MB brotli | `GetAppList` |

**Conclusión:** el núcleo publicado, con `nameEs`, `flags`, `year` y `pop`, ocupa 7,00 MB sin comprimir y **2,25 MB con brotli 11** (2,59 MB con brotli 5 y 3,05 MB con gzip, según comprima el CDN; medido el 28-10-2026 con 196 665 juegos; ver §7.6): cabe en el dispositivo y se busca sin red (ver §8).

### 4.4 Estrategia elegida

| Paso | Fuente | Clave | Llamadas/día | Qué aporta |
|---|---|---|---|---|
| 1. Columna vertebral | `GetAppList` (`include_games=true`, `max_results=50000`) | Sí, cabecera `x-webapi-key` | ≈4 | Qué juegos existen, sin depender del país; nombre base y marcas de cambio |
| 2. Enriquecimiento | Query, pasada completa en `spanish`/`ES` | No | ≈208 | Nombre en español, indicadores (`flags`), fecha, reseñas, portadas, plataformas y Steam Deck |
| 3. Huecos y clasificación | `GetItems`, lotes ≤200 | No | ≈5 | Lo que (1) lista y (2) no devuelve, y lo que desaparece |

Se recorre todo a diario, y no solo los cambios con `if_modified_since` (≈45 llamadas), porque las reseñas (la popularidad) cambian cada día y no consta que `last_modified` las refleje; porque el mismo código sirve en M1 y en el plan B; y porque cada ejecución es completa e idempotente, sin cursor.

### 4.5 Algoritmo de ingesta (ejecución diaria)

```text
EJECUCIÓN del catálogo · diaria a las 05:17 (Europe/Madrid) o manual
 0 ESTADO     bajar state/master.ndjson.gz; si no existe, todo es alta
 1 LISTA      con clave (en modo sin clave se salta y L := ids de Q)
              GET /IStoreService/GetAppList/v1/?include_games=true
                  &max_results=50000&last_appid={c}  + x-webapi-key
              repetir con c = last_appid mientras have_more_results
 2 ENRIQUECER sin clave; start = 0, 950, 1900… (solape de 50)
              GET /IStoreQueryService/Query/v1/?input_json={
                query: {start, count: 1000, sort: 2,
                        filters: {type_filters: {include_games: true}}},
                context: {language: "spanish", country_code: "ES"},
                data_request: {include_release, include_assets,
                  include_reviews, include_platforms,
                  include_best_purchase_option: false}}
              Zod; deduplicar por appid; hasta total_matching_records → Q
 3 HUECOS     GetItems sin clave, lotes ≤200, mismo data_request
              H1 = L − Q en ES; si hay restricción de país, en US
              H2 = estado − L (los que desaparecen)
              unlisted:true             → Retirado (se conserva)
              success 15 + appid 0      → se elimina
              restricción en ES y en US → se conserva con su nombre
 4 CONSTRUIR  L ∪ Q; solo type 0; fuera vacíos y lista negra; SKU
              duplicados; nameEs, flags, year, pop → ficheros (§4.6)
 5 PUERTAS    si falla una: no se publica, se abre un issue y error
 6 PUBLICAR   firmar el manifest; wrangler deploy de ga-catalog
              (+ ficheros de la versión anterior); subir el estado;
              ping de vida
```

**Sin `include_basic_info`:** la ficha no muestra descripción ni desarrollador y el núcleo no usa sus campos. `is_free`, `is_early_access`, `is_coming_soon` y `content_descriptorids` van fuera de `basic_info`, pero el 28-10-2026 se pidieron con él: que siguen llegando sin él queda **a verificar en M0**. Que Query respeta `include_best_purchase_option: false` sí se comprobó ese día: ningún precio en los 1 398 juegos publicados de dos páginas, frente a 939 de 1 000 con la opción por defecto.

En GitHub Actions: `schedule` con `timezone`, `workflow_dispatch` y `concurrency`. Si sus *runners* reciben 429 o faltan minutos, el PC solo descarga y construye (pasos 0–4) y sube el resultado, con el estado nuevo, como *asset* de una *Release* de preparación (`catalog-staging`); después se lanza `catalog.yml` con `workflow_dispatch` (`source=staging`), que pasa las puertas, firma y publica (pasos 5 y 6). La clave privada de firma solo está en un secreto de GitHub: desde M2, el PC nunca firma ni despliega `ga-catalog`.

### 4.6 Estado, puertas y ficheros publicados

**Estado:** `state/master.ndjson.gz`, una fila por `appid` con nombre, `last_modified`, `price_change_number`, clasificación (visible, retirado o bloqueado por región) y último enriquecimiento fechado; es un *asset* de la *Release* `catalog-state` de GitHub (7 copias). Da H2, los recientes, las puertas y el enriquecimiento de reserva.

| Puerta de publicación | Se publica si… |
|---|---|
| Recuento | ≥190 000 juegos y entre −2 % y +5 % respecto a la versión anterior (hoy, ≈+0,13 % al día) |
| Renombrados | ≤1 % de nombres cambiados (hoy, ≈0,01 % al día) |
| Centinelas | están 730, 570, 1245620, 1086940 y 367520 |
| Integridad | sin `appid` duplicados ni nombres vacíos; todas las filas se leen; *shards* válidos (Zod) |
| Tamaño | el núcleo no pasa de su máximo (ver §7) |
| Consultas de humo | en el índice construido con `packages/core`: «hollow knight» → 367520 primero; «baldurs gate» → 1086940, «elden» → 1245620 y «counter strike» → 730 entre los 3 primeros (el 1.º será «Counter-Strike», 10: coincidencia exacta) |
| Calidad de búsqueda | en ese mismo índice, el conjunto dorado, los 2 000 nombres exactos y los prefijos de 4 letras cumplen sus umbrales (ver §8.10) |

Si falla **solo el enriquecimiento**, se publican los nombres al día con el último enriquecimiento conocido y `enrichmentAgeDays` crece.

Tras un parón largo (a ≈+0,13 % al día, el +5 % se alcanza en ≈38 días), las comparaciones con la versión anterior bloquearían siempre: se relanza a mano con `--skip-delta-gates` (también como entrada de `workflow_dispatch`), que se las salta como en la primera versión, mantiene el mínimo de 190 000 juegos y lo anota en el informe de la ejecución (ver §12).

**Ficheros** (ver §7): *manifest* firmado, núcleo, recientes (≈4 000 filas en 14 días: ≈264 altas + ≈17 renombrados al día), alias, 1 024 *shards* y su índice; cada despliegue reincluye los de la versión anterior. Secretos: clave de Steam, clave privada de firma, *token* de Cloudflare y URL del *dead-man switch* (healthchecks.io; aviso tras 36 h sin ping).

### 4.7 Presupuesto, volumen y política HTTP

**Medición del 28-10-2026** (páginas de 1 000 juegos, `spanish`/`ES`, sin clave):

| `data_request` | gzip | Sin comprimir | Tiempo |
|---|---|---|---|
| Vacío | 63 KB | 689 KB | 1,4 s |
| `basic_info`, `release`, `reviews` (pasada de 208 páginas) | 218 KB (45,3 MB en total) | 1,15 MB | 1,3 s |
| `basic_info`, `release`, `assets`, `reviews` | 236–488 KB | 1,66–2,18 MB | 0,9–1,0 s |
| `basic_info`, `release`, `assets`, `reviews`, `platforms`, sin precios (descartado) | 306–506 KB | 1,73–2,37 MB | 1,4–1,7 s |
| **El del pipeline:** `release`, `assets`, `reviews`, `platforms`, sin `basic_info` ni precios (estimado) | ≈150–335 KB (media ≈240 KB) | ≈1,2–2,0 MB | A medir en M0 |

La última fila se estima quitando `basic_info` y los precios de las cuatro páginas de las dos filas anteriores y volviéndolas a comprimir. Peso por página: imágenes, 80–283 KB gzip (las rutas con *hash* casi no comprimen); `include_basic_info`, 74–172 KB (sobre todo `short_description`); precios (activados por defecto), 7,8 %; plataformas, ≈6 KB. **Pasada diaria estimada: ≈50 MB gzip** (≈0,3 GB de JSON) con el `data_request` del pipeline; con `include_basic_info` serían ≈80 MB (≈0,4 GB). Manda el ritmo: 208 páginas a una cada 3 s son ≈10,4 min (lo medido el 28-10-2026) y cada ejecución, con `GetAppList`, `GetItems`, la construcción y el despliegue, ≈11–13 min (≈330–400 min/mes de Actions: 30–31 ejecuciones × 11–13 min; ver §12).

**Presupuesto: ≈4 + ≈208 + ≈5 ≈ 220 llamadas/día (≤230, el 0,23 % del límite).** `GetItems` recibe los 234 juegos de `GetAppList` que Query (ES) no devolvió y ≈8 bajas al día (margen: 20 llamadas). Los términos de uso limitan las llamadas del licenciatario, no las de cada clave: también se cuentan las que van sin clave.

**Política HTTP** (todo sale del *runner* o del PC):
- Un único *worker*, con una petición cada 3 s (0,33/s: el ritmo de la pasada medida, sin errores ni 429) y nunca más de 0,4/s, que es justo el límite que mide la comunidad (≈120 cada 5 min por IP); `Accept-Encoding: gzip` y tiempo máximo por petición.
- Se comprueban el código HTTP, `X-eresult` (1 = correcto; 84 = límite superado) y el contrato Zod; si no se cumple, falla la etapa (ver §12).
- **429:** pausa global, *backoff* exponencial con *jitter* de 60 s a 15 min (o `Retry-After`); tras 5 seguidos se aborta la etapa (§4.6).
- **5xx o tiempo agotado:** hasta 5 reintentos (2, 4, 8, 16 y 32 s + *jitter*); un 400 no se reintenta.
- **403 con clave:** parar y alertar (clave revocada o cuenta limitada).

### 4.8 Sin clave: construcción de M1 y plan B

| Situación | Qué juegos existen | Enriquecimiento | Efecto en la app |
|---|---|---|---|
| Normal (desde M2) | `GetAppList` | Query + `GetItems` | — |
| M1, aún sin clave | Query (ES) | Query | Faltan ≈230 (0,12 %), probablemente bloqueados en España; se apuntan pegando el enlace (juego provisional) |
| Clave revocada (403) | Se avisa y se relanza sin clave: Query + estado | Query + `GetItems` | Como M1, sin perder lo ya conocido |
| Query o `GetItems` cambian o piden clave | `GetAppList` | Congelado (`enrichmentAgeDays` crece); *kill switches* si hay datos malos | Nombres al día; lo demás, del último día bueno |
| Steam no responde | — | — | Sigue el último catálogo: buscar y apuntar no dependen de Steam (ver §5) |

- **M1** se construye en el PC con el mismo comando en modo sin clave (≈208 llamadas, ≈10 min) y `ga-catalog` se despliega a mano, con el *manifest* aún sin firma; la primera versión se salta las puertas que comparan con la anterior. Desde M2 solo publica `catalog.yml`, también cuando construye el PC (ver §4.5).
- **`jsnli/steamappidlist`** solo sirve para contrastar en desarrollo; nunca se publica ni se versiona. De sus 196 595 juegos (27-10-2026), 234 no salen en Query (ES) el 28-10-2026, p. ej. 22490 «Fallout: New Vegas» (SKU regional); en M2 entran por H1.
- Si Query llegara a exigir clave, se probaría a enviársela (**a verificar en M2**).

### 4.9 Casos límite y decisiones de producto

| Caso | Decisión |
|---|---|
| **«Próximamente»** (62 642 en ES, 32 %) | Se incluyen, con la precisión de `coming_soon_display`: día (5 068), mes (2 637), trimestre (4 704), año (5 954), «Próximamente» (28 466) o «Por confirmar» (15 583); los 230 restantes no traen `coming_soon_display` (217 de ellos, ninguna fecha) y se tratan como «Por confirmar». No se penalizan en la búsqueda (ver §8). |
| **Retirados** | No salen en `GetAppList` ni en Query; al desaparecer, `GetItems` da `unlisted:true` y se conservan con la insignia «Retirado», al final. Los anteriores a la primera ejecución se apuntan pegando el enlace (se resuelven en M4). |
| **Bloqueados por región** | `GetItems` (ES) da `success 15`, `visible:false` y `unvailable_for_country_restriction:true` (sic), con nombre: se piden en US y se conservan. `success 15` solo nunca es «eliminado». |
| **Inexistentes** | `success 15` + `appid 0` + nombre vacío → se eliminan. |
| **SKU regionales duplicados** | Se prefiere el visible en ES (hay dos «Fallout: New Vegas»). |
| **Adultos** (descriptor 3 o 4: 10 214) | Ocultos por defecto; se muestran desde Ajustes. |
| **Basura** | Fuera los 18 sin nombre. Lista negra **exacta** (`TestApp` 866490, `UNTITLED` 639770…), nunca por prefijo («Untitled Goose Game»). Query cuela 473930 «Steam Gift Cards» (tipo 14): solo entra `type 0`. |
| **Nombres en español** | 3 227 juegos (1,6 %) se llaman distinto en `spanish` («Command & Conquer 3: La Ira de Kane»), ≈3 000 aun tras normalizar: se publica `nameEs` y se indexan ambos (ver §8). |
| **Gratuitos, acceso anticipado y demos de tipo 0** | Se incluyen (23 722 gratuitos y 19 313 en acceso anticipado, cada uno con su bit en `flags`). |
| **DLC** | Fase 2: solo los notables por reseñas (≈2 llamadas más de `GetAppList` y ≈67 de Query). |
| **Popularidad** | 76 040 juegos (39 %) sin reseñas → `pop` 0; máximo actual, 46 (730); tope, 63. |

### 4.10 Imágenes (portadas)

- **URL:** `https://shared.akamai.steamstatic.com/store_item_assets/` + `asset_url_format` con `${FILENAME}` sustituido; para CS2, `steam/apps/730/${FILENAME}?t=1793054556` + `162664aa…/header.jpg`. El `?t=` cambia con el arte: cada URL se cachea sin caducidad.
- **Vertical:** `library_capsule` (600×900), de nombre variable: `library_600x900.jpg`, `portrait.png` (355 de los 1 000 más antiguos; alguno pesa 545 KB, **a verificar en M2**), `<sha1>/library_capsule.jpg` en casi todos los nuevos y variantes por idioma (`…_spanish.jpg`): se guarda la de `spanish`. Si falta (8 de 3 984 en la muestra), `header`; si no, *placeholder* (ver §9).
- **Nunca adivinar rutas sin *hash*:** dan 404 en juegos nuevos (5338720) o arte viejo (el `header.jpg` sin *hash* de CS2 es de 2023).
- **CDN:** `Access-Control-Allow-Origin: *` y caché de ≈10 años; alternativa, `shared.fastly.steamstatic.com`; se evita `shared.cloudflare.steamstatic.com` (301). La IP del usuario llega a Valve (ver §11).

### 4.11 Restricciones que condicionan la arquitectura

1. **Sin CORS:** la app nunca llama a la API de Steam; el catálogo llega como ficheros estáticos propios (ver §5).
2. **Clave confidencial:** solo en un secreto de GitHub y en `.env.local` del PC (ver §11).
3. **Límites por IP sin publicar:** Steam fuera del camino crítico; un solo *worker*, una petición cada 3 s y nunca más de 0,4/s.
4. **Servicios sin clave no documentados:** Zod, *fixtures* y canario diario (ver §12), *kill switches* y plan B.
5. **Query y `GetItems` dependen del país:** manda `GetAppList`; los huecos, en ES y luego en US.
