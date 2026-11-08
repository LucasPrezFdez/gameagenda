# Decisiones cerradas para redactar `prototipe.md`

**Fecha:** 28-10-2026 · **Estado:** cerradas por el arquitecto (el usuario pidió «decide tú»).
**Para quién:** para cada redactor de una sección de `prototipe.md`. Este documento **manda** sobre cualquier fuente anterior (investigación, líneas paralelas, panel, borradores). Si una fuente lo contradice, se sigue este documento. Si crees que una decisión es un error grave, **no la cambies en tu sección**: aplícala y explícalo en `deviations_from_brief` de tu respuesta.

---

## 1. Lo que pidió el usuario (literal; es la vara de medir)

1. «quiero crear una app que funcione a modo de agenda. En ella obviamente tiene que poderse listar todos los juegos que haya en steam para empezar. Realiza un estudio de como hacerlo de manera profesional, decide tu. Crea el plan en un prototipe.md.»
2. «ten en cuenta que la principal funcion de la app va a ser apuntar juego que quieras jugar. Tambien tendras las opciones de poner juegos que has completado, platinado, comprado, etc. Tiene que ser rapida y agil»

Consecuencia: **apuntar un juego en segundos** es lo primero; los estados son lo segundo; la velocidad es un requisito duro; el catálogo completo de Steam es el punto de partida; otras plataformas llegan después.

---

## 2. ADR-001 — Arquitectura del prototipo: PWA local-first con catálogo estático (ACEPTADA)

**Contexto:** captura rápida en móvil y escritorio; ≈196 600 juegos de Steam; las APIs de Steam no envían CORS; la Web API key es confidencial; los endpoints sin clave no están documentados; un solo desarrollador en Windows 11 sin Docker.

**Opciones evaluadas** (tres propuestas independientes puntuadas por tres evaluadores con criterios distintos):

| Evaluación | A · PWA local-first + snapshot estático | B · Tauri 2 nativo | C · Cuentas + sync desde el día 1 | Orden |
|---|---|---|---|---|
| Velocidad y UX de captura | **48** | 45 | 45 | A > C > B |
| Viabilidad para una persona en este PC | **42** | 25 | 29 | A > C > B |
| Robustez, cumplimiento y futuro | 42,5 | 44 | **48** | C > B > A |

Fallos fatales: B no permite apuntar desde el móvil hasta muy tarde y obliga a mantener dos clientes; C exige un backend multiusuario antes de poder apuntar el primer juego; A, tal como estaba escrita, importaba datos de Steam sin autenticar al usuario (corregido: login OpenID obligatorio antes de cualquier llamada por usuario, en Fase 2).

**Decisión:** **A**, con injertos de B y C:
- de B: rigor de búsqueda (orden de normalización, niveles de *ranking*, alias), ids naturales, `manifest.json` como plano de control (firma ed25519 y *kill switches*);
- de C: contratos de respuesta, puertas de publicación con consultas de humo, credencial de dispositivo en cookie `__Host-` `HttpOnly`, una sola función `merge()` compartida y sincronización ligera **dentro del prototipo** (último hito, M4);
- de A: catálogo estático con *hash* de contenido, *shards* de detalles, coste 0 €.

**Consecuencias:** buscar y apuntar funcionan **sin red** tras la primera visita; un único cliente web para móvil y escritorio; Steam nunca está en el camino crítico; coste 0 €/mes; no hay atajo global del sistema en Windows hasta la app de escritorio con Tauri, que llega en M3 (§10.16); iOS no tiene *Web Share Target* (se cubre con «Pegar enlace» y, en M4, un Atajo de iOS que envía a un buzón).

---

## 3. Decisiones

**D-01 Plataforma.** PWA instalable (Android, iOS, escritorio) con un solo código. Sin servidor propio hasta M4, salvo *hosting* estático. Tauri 2 es un envoltorio de la misma web, con atajo global `Ctrl+Mayús+Espacio`, nunca un segundo motor. Llega en M3, no en Fase 2 (§10.16).

**D-02 Framework.** **React 19.3.1 + Vite 8.3.5 como SPA**, TypeScript 7.0.2. **Sin SvelteKit** (motivos: `svelte-check` exige TypeScript 6 porque TS 7.0 no tiene API hasta la 7.1; Kit 3 deja obsoletos muchos tutoriales; cinco pantallas no necesitan meta-framework). **Sin librería de enrutado**: un *router* propio mínimo sobre la History API. Rutas: `/` (Mi lista), `/catalogo`, `/juego/<id>` (por ejemplo `/juego/steam:730`), `/ajustes`, `/apuntar` (abre la paleta; atajo del *manifest*) y `/share` (destino de «Compartir»). Estilos: CSS nativo con variables (*tokens*), una hoja por pantalla, sin CSS Modules; sin Tailwind. Estado: una agenda en memoria con `useSyncExternalStore` + estado local de React, sin `useLiveQuery` (§10.18); sin Redux ni similares. El presupuesto de JS inicial está en la §5 de este documento (≤150 KB brotli, medido).

**D-03 Datos del usuario en el cliente.** **Dexie 4.4.7** (IndexedDB), sin `dexie-react-hooks` (§10.18). **No** se usa SQLite WASM en el cliente. El modelo relacional (SQL) es la referencia lógica y el esquema de **D1** (SQLite) del servidor en M4. Tablas Dexie: `entries`, `outbox`, `settings`, `meta` (versión de catálogo, índice persistido, etc.). `navigator.storage.persist()` en la primera escritura; exportación/importación JSON (con marcas HLC) y CSV desde M1.

**D-04 Identificadores naturales.** Una entrada por juego y usuario. `id` = clave del juego:
- `steam:<appid>` (entero sin decimales; ojo: no construirlo a partir de un `REAL`);
- `manual:<uuidv7>` para juegos que no están en el catálogo;
- en el futuro `igdb:<id>` solo para juegos que no estén en Steam.
Dos dispositivos que apuntan el mismo juego sin conexión convergen en la misma fila. **Vincular** un juego manual con Steam = fusionar sus campos en `steam:<appid>` (LWW por campo) y dejar el manual como lápida con `mergedInto: "steam:<appid>"`. Nunca se vincula automáticamente por similitud; solo se **propone** cuando hay exactamente una coincidencia exacta tras normalizar («Hades» ≠ «Hades II»).

**D-05 Estados y marcas (modelo de producto).**
- **Estado** (exclusivo, siempre hay uno). Identificadores en inglés, etiquetas en español:
  `want_to_play` «Quiero jugar» (por defecto) · `playing` «Jugando» · `on_hold` «En pausa» · `completed` «Completado» · `dropped` «Abandonado».
- **Marcas** (independientes, un toque): `platinum` «Platinado» · `owned` «Comprado» · `next` «Próximo» (fija el juego en «A continuación», arriba de Quiero jugar). Se guardan como registro abierto `flags`, para añadir marcas propias (el «etc.» del usuario) sin migraciones; la interfaz de marcas personalizadas llega en Fase 2.
- **Reglas:** marcar Platinado ⇒ si el estado no es Completado, pasa a Completado (con Deshacer) y fija `completedAt` si estaba vacío. Quitar Platinado no cambia el estado. Cambiar después el estado (rejugar → Jugando) **no** quita Platinado.
- **Fechas automáticas y editables:** `addedAt`; `startedAt` (la primera vez que pasa a Jugando); `completedAt` (la primera vez que pasa a Completado; no se sobrescribe); `platinumAt` (al marcar). **No se inventan fechas** para Comprado: `ownedAt` queda vacío salvo que el usuario la ponga.
- **Otros campos:** `note` (texto libre), `platform` «Juego en» (opcional; lista cerrada: PC, Steam Deck, PS5, PS4, Xbox Series, Xbox One, Switch 2, Switch, Móvil, Otra), `rank` (orden manual dentro de Quiero jugar; los juegos nuevos entran **al final**), copia de `title` y de la portada (para pintar Mi lista sin catálogo).
- **Sin diálogos de confirmación:** cambios optimistas + aviso con «Deshacer» (8 s, se pausa con foco o puntero) + `Ctrl+Z` con varios niveles en escritorio. Solo se confirma «Borrar todos mis datos».

**D-06 Preparado para sincronizar desde M1.** Cada entrada lleva marcas **HLC por campo** y cada cambio se añade a `outbox` (`opId` uuidv7, `entryId`, `field`, `value`, `hlc`). Borrar = lápida (`deletedAt` + HLC). `merge()` vive en `packages/core`, es **LWW por campo** y repara invariantes de forma determinista (la regla Platinado ⇒ Completado se evalúa con los relojes). La importación JSON pasa por el mismo `merge()`. El transporte de sincronización llega en M4.

**D-07 Pipeline del catálogo** (Node 24, sin dependencias salvo **Zod 4.6.7** para los contratos; se ejecuta igual en el PC y en GitHub Actions):
1. **Columna vertebral (con clave):** `IStoreService/GetAppList/v1`, `include_games=true`, `max_results=50000`, clave en la cabecera `x-webapi-key` → ≈4 llamadas. Es la lista autorizada y no depende de la región.
2. **Enriquecimiento masivo (sin clave):** una pasada diaria de `IStoreQueryService/Query` (`sort=2`, `count=1000`, `start` += 950 con solapamiento de 50, contexto `spanish`/`ES`, `data_request` con release, assets, reviews y basic info) → ≈207 llamadas. Medido el 28-10-2026: 1 000 juegos por página, 688 687 B sin comprimir / 63 251 B gzip, 1,4 s, solo con `data_request` vacío.
3. **Huecos y clasificación (sin clave):** `IStoreBrowseService/GetItems` (lotes ≤200, `include_best_purchase_option=false`) para los `appid` de (1) que no devuelve Query (primero ES, luego US) y para los que desaparecen respecto al estado anterior: `unlisted:true` → **Retirado** (se conserva con insignia y va el último); `success 15` + `appid 0` → se elimina; bloqueado por región → se conserva.
4. **Normalizar y construir** los ficheros de D-08.
5. **Puertas (si falla una, no se publica y se abre un *issue*):** ≥190 000 juegos y −2 %/+5 % respecto a la versión anterior; ≤1 % de nombres cambiados; `appid` centinela (730, 570, 1245620, 1086940, 367520); sin `appid` duplicados ni nombres vacíos; tamaño máximo del núcleo; **consultas de humo** sobre el índice construido («hollow knight» → 367520 en el puesto 1; «baldurs gate» → 1086940 entre los 3 primeros; «counter strike» → 730; «elden» → 1245620 entre los 3 primeros). Si falla solo el enriquecimiento, se publican los nombres con el último enriquecimiento conocido y `enrichmentAgeDays` crece.
6. **Publicar** con `wrangler deploy` del Worker `ga-catalog`, guardar el estado y avisar a un *dead-man switch* (healthchecks.io).
- **Estado entre ejecuciones:** `state/master.ndjson.gz` (appid, nombre, `last_modified`, `price_change_number`, clasificación, último enriquecimiento) como *asset* de una *Release* de GitHub (`catalog-state`), con las 7 últimas copias.
- **Calendario:** diario a las 05:17 Europe/Madrid (clave `timezone` del `schedule`) + `workflow_dispatch`. Una ejecución a la vez. Si los *runners* compartidos reciben 429, la ejecución se puede lanzar desde el PC con el mismo comando.
- **Política HTTP:** un único *worker*, ≤0,4 peticiones/s, *backoff* exponencial con *jitter* y pausa global ante 429; reintentos limitados ante 5xx; 403 con clave → parar y alertar.
- **Presupuesto:** ≈4 + ≈207 + ≈20 ≈ **230 llamadas/día** (0,23 % del límite de 100 000), ≈10–15 min.
- **Sin clave (M1 o si la revocan) = plan B:** la enumeración sale de la pasada de Query (que ya recorre todo el catálogo sin clave) y se contrasta con el volcado `jsnli/steamappidlist` **solo en desarrollo**. La clave hace falta a partir de M2 para la columna vertebral documentada.

**D-08 Formato publicado del catálogo** (Worker `ga-catalog`, ficheros inmutables con *hash* en el nombre salvo el *manifest*):
- `manifest.json` (`Cache-Control: no-cache`): `version` (`AAAAMMDD.N`), `generatedAt`, recuentos, para cada fichero su ruta + `sha256` + tamaño, `enrichmentAgeDays`, `minClientVersion`, `killSwitches` (p. ej. `covers`, `details`) y **firma ed25519** sobre el JSON canónico, verificada con una clave pública incluida en la app.
- `core.<hash>.tsv`: una cabecera (`#gacat-core v1`, versión, columnas) y una fila por juego **ordenada por rango estático** (popularidad descendente), de modo que el orden de las filas es el desempate de la búsqueda. Columnas: `appid`, `name` (nombre base), `nameEs` (solo si difiere), `flags` (bits: próximamente, acceso anticipado, adulto [descriptores 3 o 4], gratis, retirado, fecha por confirmar), `year`, `pop` = `min(63, floor(2·log2(reseñas+1)))`. Las claves normalizadas se calculan en el cliente.
- `recent.<hash>.tsv`: altas y renombrados de los últimos 14 días respecto al núcleo vigente (mismas columnas). El cliente lo aplica siempre.
- `aliases.<hash>.tsv`: `alias` → `appid` (lista curada en el repo + siglas generadas para los ≈5 000 juegos con más reseñas: cs2, rdr2, gta5, ff7…).
- `details/<nnnn>.<hash>.json`: 1 024 *shards* (`fnv1a32(appid) mod 1024`) con, por `appid`: `asset_url_format` y nombres de fichero de `library_capsule` y `header`, fecha de lanzamiento (o texto «Por confirmar»), resumen de reseñas, plataformas y Steam Deck. Un *shard* sin cambios conserva su *hash*.
- **Cliente:** comprueba el *manifest* al arrancar (si han pasado ≥12 h) y al recuperar la conexión; aplica `recent` siempre; vuelve a descargar el núcleo solo si cambió **y** el local tiene más de 7 días, o si el usuario pulsa «Actualizar catálogo». Cada despliegue sustituye el conjunto de ficheros, así que el pipeline **vuelve a incluir los ficheros de la versión anterior** y el cliente, ante un 404, relee el *manifest*.
- **Contenido:** solo tipo juego (0), incluidos «próximamente» y gratuitos; contenido adulto (descriptores 3 o 4) **oculto por defecto** con opción en Ajustes; **sin DLC** en el prototipo (Fase 2: DLC notables por umbral de reseñas, con insignia «DLC»); retirados conservados con insignia; lista negra **exacta** de basura (`TestApp`, `UNTITLED`…; nunca por prefijo, por «Untitled Goose Game»); SKU regionales duplicados → se prefiere el visible en ES.

**D-09 Búsqueda instantánea** (en un *Web Worker* de módulo; nunca en el hilo principal):
- **Normalización** (idéntica en pipeline, Worker y tests, con vectores de prueba JSON compartidos): quitar ™ ℠ ® © y **todas** las formas de apóstrofo (' ’ ‘ ʼ) **antes** de NFKD; NFKD; quitar diacríticos; minúsculas; ligaduras (ß→ss, æ→ae, œ→oe, ø→o, ł→l, đ→d); `&` → `and`; resto de signos → espacio; colapsar espacios. Apóstrofos **eliminados**, nunca convertidos en espacio («baldurs gate» debe encontrar Baldur's Gate 3).
- **Claves indexadas:** nombre base, nombre en español, clave sin artículo inicial (the/a/an/el/la/los/las) para «empieza por el título», romanos 1–20 ↔ arábigos como tokens extra (sin tocar «I Am Bread» ni «Mega Man X»: solo romanos aislados tras otra palabra), alias/siglas y bigramas CJK/kana/hangul (6,3 % de los nombres).
- **Índice:** diccionario de tokens ordenado + *postings* en *typed arrays* con los ids en orden de rango estático, *bitsets* precalculados para 1 letra y salida temprana.
- **Niveles de *ranking*:** exacto (o alias exacto) > empieza por el título (con o sin artículo) > todos los tokens como prefijos de palabra > subcadena (solo si hay pocos resultados) > difuso con uFuzzy 1.0.19 («¿Quizás buscabas…?», solo si hay <5 resultados y tras una pausa al teclear). La popularidad **solo desempata dentro de un nivel**. Los «próximamente» no se penalizan; los retirados van al final; +18 oculto por defecto; los juegos ya apuntados se marcan con su estado y no se duplican (no se les da prioridad).
- **Números y `appid`:** un número suelto («2077», «1942») es una búsqueda de título; un `appid` solo se reconoce en un enlace de la tienda o con prefijo explícito (`appid:730`).
- **Carrera de Intro:** cada consulta lleva un número de secuencia; Intro actúa sobre los resultados de la consulta **actual** (espera hasta 500 ms si aún no han llegado) y nunca sobre los de un prefijo anterior.
- **Disponibilidad:** antes de que el índice esté listo se puede apuntar a mano y pegar enlaces; en M3 se persiste el índice construido por versión de catálogo (restauración en ≈0,1–0,4 s) y se añade un núcleo de arranque con los ≈20 000 juegos más populares que se descarga primero.

**D-10 Superficies de captura.**
- Paleta única para apuntar y buscar: `Ctrl+K` o `/` en escritorio; en móvil, barra «Apunta un juego…» fija abajo, al alcance del pulgar. Intro (o tocar la fila entera, ≥56 px) apunta en «Quiero jugar»; `Ctrl+Intro` apunta y sigue apuntando; `Alt+Intro` o pulsación larga abre el selector de estado/marcas; `Mayús+Intro` abre la ficha. En móvil el campo lleva `autocomplete="off"`, `autocorrect="off"`, `autocapitalize="off"`, `spellcheck="false"`, `enterkeyhint="go"` y letra ≥16 px.
- Pegar un enlace de la tienda (`Ctrl+V` en cualquier pantalla) apunta ese `appid`. Si el `appid` no está en el catálogo local, se guarda como **provisional** con el título sacado del *slug* de la URL y se resuelve después (en M4, con la micro-API).
- Android (PWA instalada, Chromium): destino de «Compartir» que apunta al instante con Deshacer, y acceso directo «Apuntar juego» en el *manifest*. iOS: chip «Pegar enlace» y, en M4, un Atajo de iOS que hace POST del enlace compartido a `/api/v1/inbox` con un *token* de solo escritura y revocable.
- **Nunca** atajos con `Ctrl+Alt` ni teclas que necesiten AltGr (teclado español); no se interceptan atajos del navegador salvo `Ctrl+K`.

**D-11 Portadas.** Se cargan del CDN de Valve: `https://shared.akamai.steamstatic.com/store_item_assets/` + `asset_url_format` con `${FILENAME}` sustituido. Cadena: `library_capsule` → `header` → *placeholder* generado (iniciales + color). **Nunca** adivinar rutas antiguas sin *hash*. `loading="lazy"`, tamaño fijo, `referrerpolicy="no-referrer"` y `crossorigin="anonymous"` (el CDN envía CORS: así la respuesta no es opaca y la caché del Service Worker no se dispara de cuota), caché LRU de ≈300 portadas. Interruptor «Cargar portadas» en Ajustes, junto al aviso de que la IP llega a Valve. En los resultados de búsqueda la portada es una mejora progresiva: el texto se pinta primero y nunca se espera a una imagen.

**D-12 Hosting.** Cloudflare **Workers Static Assets**, en `workers.dev` durante el prototipo:
- `ga-web`: la app; se despliega en cada *push* a `main`. En M4 incorpora la micro-API **Hono 4.13.14** en `/api/*` en el **mismo origen** (el *script* solo se ejecuta para `/api/*`; el resto son *assets* estáticos gratuitos). Así la cookie `__Host-` es de primera parte y la CSP usa `connect-src 'self'`.
- `ga-catalog`: los datos del catálogo; los despliega el pipeline a diario. Envía `Access-Control-Allow-Origin` solo para el origen de la app (fichero `_headers`).
- **No** activar la caché de Workers sobre los *assets* (factura peticiones que de otro modo son gratis). Dominio propio: opcional, más adelante.
- Coste del prototipo: **0 €/mes**.

**D-13 Sincronización ligera (M4).** Micro-API en `ga-web` + **D1 en la jurisdicción UE**.
- Sin email ni contraseña. Una «agenda» en el servidor tiene dispositivos emparejados.
- Credencial de dispositivo: cookie `__Host-` `HttpOnly` `Secure` `SameSite=Lax` con un *token* de 256 bits; el servidor guarda solo su *hash*.
- **Emparejar:** un dispositivo ya emparejado genera un *token* de un solo uso (≥128 bits, caduca en 10 min) que se muestra como QR y como texto para copiar; el dispositivo nuevo lo canjea **desde dentro de la app** (en iOS, la app de la pantalla de inicio tiene un almacén de cookies distinto del de Safari). El servidor guarda solo *hashes*. Código de recuperación de 128 bits que se muestra una vez.
- Protocolo: `POST /api/v1/sync` por ida y vuelta (sube las operaciones de `outbox` pendientes y baja los cambios desde la última secuencia del servidor), secuencia por agenda en el servidor y el mismo `merge()` en cliente y servidor. Sincroniza al ganar foco, al recuperar la conexión y al cambiar la visibilidad, en una sola pestaña (Web Locks).
- También en M4: `/api/v1/inbox` (Atajo de iOS) y `/api/v1/resolve/<appid>` (resuelve `appid` desconocidos o retirados con `GetItems` sin clave, con caché).
- Pruebas: propiedades (fast-check) sobre `merge()` y Playwright con dos contextos de navegador.

**D-14 Cuenta de Steam = Fase 2 (después del prototipo).** «Iniciar sesión con Steam» (OpenID 2.0) con `steam-signin` 1.0.5 en el Worker, canje del *ticket* tipo PKCE (por el almacén de cookies separado de iOS) y pruebas con un túnel `cloudflared` (la librería descarta el puerto del *realm*). **Ninguna llamada a Steam por usuario, con o sin clave, antes de un login verificado**; no se importan perfiles pegados. La importación solo **propone** (Comprado desde `GetOwnedGames` excepto `family_shared`; Quiero jugar desde la lista de deseados; Platinado solo como sugerencia por la beta de Achievement Sets) y el usuario confirma. Las respuestas de Steam no se guardan en D1.

**D-15 Privacidad y legal.**
- Nombre neutro «GameAgenda»; sin «Steam» en el nombre ni en el icono; aviso de marca en «Acerca de».
- Sin analítica de terceros ni *cookies* no necesarias → sin banner.
- Aviso de primera capa en cuanto se cargan portadas (M2): la IP llega a Valve (EE. UU.).
- Política completa, aviso legal y registro de actividades (Facilita RGPD) antes del primer probador externo y antes de la sincronización (M4).
- Pantalla «Datos de Steam que guardamos» (qué, dónde —dispositivo, Cloudflare UE, Valve EE. UU. vía CDN— y botón de borrar).
- Al activar la sincronización: declaración de edad ≥14 años (preparada para pasar a 16).
- Retención documentada, incluido D1 Time Travel (7 días en el plan gratuito).

**D-16 Seguridad.** CSP estricta por cabecera (`_headers`) basada en *hashes*, sin `unsafe-inline`; `img-src` limitado a los CDN de Steam; `connect-src 'self'` + el origen de `ga-catalog`. Texto de Steam siempre como texto (nunca HTML inyectado). Zod en cada respuesta de Steam, en cada entrada de la micro-API y en la importación. La clave de Steam solo en un secreto de GitHub y en `.env.local` del PC; el CI falla si el *build* contiene el valor de la clave o la cadena `x-webapi-key`. Versiones exactas (`.npmrc` `save-exact=true`), *actions* fijadas por SHA, Dependabot semanal, *token* de Cloudflare con el mínimo permiso. Rate limiting en todas las rutas sin autenticar de la micro-API (M4).

**D-17 Calidad y CI.**
- GitHub, repositorio **privado** (plan Free): secretos de repositorio (no hay secretos por entorno ni protección de ramas en privado Free) y 2 000 min/mes de Actions.
- Un `ci.yml` de ≤10 min en `ubuntu-latest`: Biome, `tsc`, Vitest, Playwright (Chromium; WebKit en local), puertas de tamaño, búsqueda de la clave en el *build*.
- **Rendimiento:** se mide con Playwright + estrangulamiento de CPU ×4 por CDP y un observador de tareas largas (falla si una tarea del hilo principal supera 50 ms mientras se teclea o se apunta). En CI se informa; la puerta dura es `npm run perf` en local + un Android de gama media real (`chrome://inspect`, *port forwarding* a `localhost`). El iPhone se comprueba por un túnel HTTPS y un panel de rendimiento dentro de la app (p50/p95).
- El CI **nunca** llama a Steam: usa *fixtures* grabados (`STEAM_MODE=fixtures`). Hay un canario diario en vivo dentro del pipeline.
- Trunk-based; Conventional Commits (tipo en inglés, descripción en español); SemVer 0.x por hito; CHANGELOG en español; ADR en formato MADR en `docs/adr/`.

**D-18 Repositorio** (npm workspaces, Node 24.21, sin pnpm):
`apps/web` (SPA + `apps/web/worker/` con la micro-API desde M4) · `packages/core` (normalización, índice y *ranking*, parser de enlaces de Steam, códecs TSV/*shards*, reglas de estados y marcas, HLC y `merge()`) · `pipeline/` (scripts `.ts` ejecutados por Node 24 con *type stripping*) · `fixtures/` (respuestas de Steam grabadas y un mini-catálogo) · `docs/adr/` · `.github/workflows/` (`ci.yml`, `deploy-web.yml`, `catalog.yml`).

**D-19 Idioma.** Código e identificadores en inglés; interfaz, documentación, ADR y CHANGELOG en español de España. La app solo en español en el prototipo (inglés en Fase 2).

---

## 4. Hitos (canónicos: usa estos nombres y este alcance)

| Hito | Objetivo | Alcance resumido | Esfuerzo (días ideales) |
|---|---|---|---|
| **M0** Esqueleto | Que todo se pueda construir, probar y desplegar | Repo, workspaces, Biome, TS, Vitest, Playwright, CI, despliegue de `ga-web` y `ga-catalog` con un *fixture*; pedir la clave de Steam el primer día; comprobaciones «a verificar en M0» (compresión del TSV, `_headers` y CORS también en los 404, campos de Query sin `basic_info`, estrangulamiento del Worker, importación de la clave Ed25519) | 2–3 |
| **M1** Apuntar | Catálogo completo de Steam buscable y listable + apuntar en «Quiero jugar» en <3 s | Snapshot construido en el PC (D-07 sin clave); Worker de búsqueda con niveles y puente de escaneo; paleta; Mi lista con estados y marcas de un toque y Deshacer; ficha básica; Catálogo con lista virtual de todos los juegos y contador; juego manual; pegar enlace; exportar/importar; `persist()`; arnés de rendimiento y E2E | 9–12 |
| **M2** Catálogo vivo | Catálogo diario automático y portadas | Pipeline en GitHub Actions con clave, puertas, *manifest* firmado, *kill switches*, *shards* de detalles; portadas y ficha; aviso de privacidad de primera capa; *dead-man switch* | 4–5 |
| **M3** Rápida y ágil | Cumplir los presupuestos en dispositivos reales y multiplicar las vías de captura | Índice persistido, núcleo de arranque, atajos de teclado completos, gestos móviles, destino de «Compartir» y accesos directos, pegar en cualquier pantalla, panel de rendimiento, accesibilidad WCAG 2.2 AA, medición en el Android de referencia y en iPhone; app de escritorio para Windows (Tauri 2, `Ctrl+Mayús+Espacio`; §10.16) | 4–6 |
| **M4** Sincronización | Una sola agenda en el móvil y el PC, y copia fuera del dispositivo | Micro-API Hono + D1 UE, emparejamiento, `sync`, buzón para el Atajo de iOS, resolución de `appid` desconocidos, código de recuperación, política de privacidad completa | 4–6 |
| **Fase 2** | Después del prototipo | Steam OpenID + importación; IGDB y otras plataformas; DLC notables; marcas propias; avisos de lanzamiento; inglés | — |

Total del prototipo (M0–M4): **23–32 días ideales** de una persona (día ideal ≈6 h; ajustado el 28-10-2026 por el alcance añadido en la §10 y el 29-10-2026 por la app de escritorio, §10.16).

---

## 5. Cifras canónicas (usa estas; si citas otra, di de dónde sale)

| Dato | Valor |
|---|---|
| Juegos de Steam (GetAppList, volcado del 27-10-2026) | **196 595** (18 sin nombre → 196 577 útiles) |
| Juegos según Query (28-10-2026) | 196 621 en US (≈133 882 publicados + ≈62 686 próximamente + 53 en ningún estado); 196 615 en ES |
| DLC | 63 919 (GetAppList) / 63 079 (Query) — fuera del prototipo |
| Juegos solo para adultos (descriptor 3) | ≈9 700 |
| Cambios de juegos al día | ≈3 300 |
| Índice `[appid, nombre]` de todos los juegos | 5,98 MB JSON · 2,64 MB gzip · **1,91 MB brotli** (TSV: 1,80 MiB brotli) |
| Búsqueda (Node 24, este PC) | índice de prefijos **0–0,3 ms**/consulta (construcción 220–330 ms, ≈16 MiB); escaneo por subcadena 7–14 ms; uFuzzy ≈5 ms; Fuse.js ≈394 ms (descartado); FlexSearch/Orama/MiniSearch 67–316 MB de *heap* (descartados) |
| Búsqueda en navegador (Edge 156, núcleo real de 196 665 juegos, medido el 28-10-2026; **sustituye a la medición anterior del escaneo**) | Índice D-09, pulsación p95: **2,1 / 8,7 / 17 ms** (×1/×4/×10, hilo principal); listo en 0,86 / 4,56 / 11,4 s; restaurar el índice persistido 0,15 / 0,55 / 1,37 s; ≈40 MiB. Escaneo lineal: p95 9,3 / 42 / 96 ms; listo en 0,41 / 1,72 / 3,55 s. Calidad del índice: dorado (98) top-1 94,9 % y top-5 98,0 %; 2 000 exactos 99,9 % en top-5; prefijos de 4 letras 93,7 % en top-10 |
| Presupuestos | tecla → resultados **≤50 ms p95** en el Android de referencia (CPU ×4 en CI) y, en escritorio, ≤16 ms a ≥120 Hz y ≤2 fotogramas por debajo (§10.17); toque → respuesta visible **≤100 ms**; **INP p75 ≤200 ms**; **LCP ≤2,5 s**; reinicio con caché ≤2 s (Mi lista visible ≤1 s); apuntar un juego **p50 ≤3 s** (desde abrir la paleta hasta ver la confirmación); búsqueda lista ≤1,5 s tras la primera carga (M3) |
| JS inicial (medido hoy con Vite 8.3.5, *build* de producción) | React 19.3.1 + React DOM solos: 219,6 KB sin comprimir · 67,7 KB gzip · **58,5 KB brotli**. Con Dexie 4.4.7 + `dexie-react-hooks` + `@tanstack/react-virtual`: 353,4 KB · 108,6 KB gzip · **94,5 KB brotli** |
| **Presupuesto de JS** | JS inicial (lo necesario para pintar Mi lista y abrir la paleta) **≤150 KB brotli**; Worker de búsqueda en un *chunk* aparte **≤40 KB brotli**; Catálogo (con `@tanstack/react-virtual`), Ajustes, exportar/importar y uFuzzy en *chunks* diferidos. Puerta de tamaño en CI. (Un objetivo de ≤100 KB gzip es inalcanzable con React + Dexie: la base ya pesa 108,6 KB gzip.) |
| Pipeline | ≈230 llamadas/día, ≤0,4 peticiones/s, ≈10–15 min |
| Coste | 0 €/mes en el prototipo |

---

## 6. Stack con versiones exactas (comprobadas en npm el 28-10-2026)

| Pieza | Versión |
|---|---|
| Node.js (LTS de mantenimiento hasta 2028-04-30) | 24.21.0 (Node 26 es Active LTS desde hoy: migración posterior) |
| npm (workspaces) | 11.19 |
| TypeScript | 7.0.2 (6.0.3 solo si alguna herramienta necesita la API del compilador) |
| React / React DOM | 19.3.1 |
| Vite / `@vitejs/plugin-react` | 8.3.5 / 6.1.2 |
| `vite-plugin-pwa` (modo `injectManifest`) / `workbox-window` | 2.0.0 / 7.4.1 |
| Dexie | 4.4.7 |
| `@tanstack/react-virtual` | 3.14.24 |
| `@leeoniya/ufuzzy` | 1.0.19 |
| Zod | 4.6.7 |
| `uuid` (v7) | 14.0.3 |
| Hono (M4) / `wrangler` / `@cloudflare/workers-types` | 4.13.14 / 4.155.0 / 5.20261028.1 |
| `steam-signin` (Fase 2) | 1.0.5 |
| Biome | 2.6.4 |
| Vitest / fast-check | 5.0.5 / 4.10.2 |
| Playwright (`@playwright/test`) | 1.64.1 |
| Tauri CLI (M3) | 2.12.4 |

Compatibilidades comprobadas: `vite-plugin-pwa` 2.0.0 admite Vite 8; `@vitejs/plugin-react` 6.1.2 y Vitest 5.0.5 requieren Vite 8; `@tanstack/react-virtual` admite React 19. No usar `@cloudflare/vitest-pool-workers` (su última versión requiere Vitest 4): la micro-API se prueba con `app.request()` de Hono sobre Vitest 5. No usar InstantDB (cierra su nube el 2027-08-31) ni `passport-steam` (sin publicar desde 2023). Prisma no se usa.

---

## 7. Nombres canónicos (glosario)

- **GameAgenda** (la app) · **Mi lista** (pantalla principal; vista por defecto «Pendientes») · **paleta** (buscador para apuntar, `Ctrl+K`) · **Catálogo** (todos los juegos de Steam) · **ficha** (detalle de un juego) · **Ajustes**.
- **entrada** (un juego en la agenda del usuario) · **estado** · **marca** (Platinado, Comprado, Próximo) · **juego manual** · **juego provisional** (`appid` pegado que aún no está en el catálogo local).
- **pipeline del catálogo** · **núcleo** (`core`) · **recientes** (`recent`) · **alias** · ***shards* de detalles** · ***manifest*** · ***kill switch*** · **puertas de publicación** · **consultas de humo**.
- **micro-API** (`/api/v1/*` en `ga-web`, desde M4) · **emparejar** un dispositivo · **buzón** (`/api/v1/inbox`) · **código de recuperación**.
- Hitos: **M0, M1, M2, M3, M4** y **Fase 2**. No uses P0/P1/P2 ni otros nombres de fase.

---

## 8. Guía de estilo para `prototipe.md`

- **Español de España**, tono profesional e impersonal en el plan («se usa», «la app hace»); la interfaz y los ejemplos de *microcopy* tutean al usuario.
- Tipografía: comillas «», coma decimal (1,91 MB), espacio como separador de millares (196 600; 3 300), unidades con espacio (50 ms, 100 %), fechas `DD-MM-AAAA` en el texto. Distingue MB de MiB cuando importe.
- Identificadores técnicos, rutas, endpoints y código en inglés y entre comillas invertidas. Nombres de teclas como en el teclado español: Intro, Mayús, Supr, Ctrl, Alt.
- **Prohibido** en el texto final: referencias internas del proceso de planificación (T1, T2, T3, T4, «línea», «track», «juez», «panel» como jerga interna, «brief», «borrador», «workflow», «agente», «DECISIONES.md») y rutas temporales (`AppData\Local\Temp`, *scratchpad*). En la §5 sí se puede contar que se evaluaron tres arquitecturas con tres criterios.
- Cada dato tiene **una sección «hogar»**; las demás remiten a ella con «(ver §7.3)». No repitas tablas enteras de otras secciones.
- Prefiere tablas y listas a la prosa larga. Diagramas en Mermaid (`flowchart`, `sequenceDiagram`, `erDiagram`, `stateDiagram-v2`). *Wireframes* en ASCII dentro de bloques de código de ≤78 columnas.
- Cada fichero empieza por `## N. Título` y sus subsecciones son `### N.M Título`. No incluyas índice general ni título de documento.
- Para afirmaciones factuales sobre Steam, normativa o librerías, cita la fuente (URL) en línea o al final de la subsección; las de la investigación del 28-10-2026 se pueden marcar «(verificado el 28-10-2026)».
- Lo que no se ha comprobado se marca como «**a verificar en M0**» (o en el hito que toque), nunca como hecho.

---

## 9. Reparto de secciones (cada redactor escribe **solo** sus ficheros en `docs/planificacion/secciones/`)

| Fichero | Sección | Tamaño orientativo | Fuentes principales |
|---|---|---|---|
| `02-vision.md` | §2 Visión, principios y objetivos medibles | ≤5 KB | §1 de este documento; `investigacion/03b-producto-ux-y-stack-resumen.txt`; `lineas-paralelas/T1-*.revisado.md` (§0) |
| `03-requisitos.md` | §3 Requisitos (RF/RNF con ids, MoSCoW por hito, modelo de estados con diagrama) | ≤10 KB | T1, T2 y T4 revisados; D-05; §4–5 de este documento |
| `04-estudio-steam.md` | §4 Estudio: cómo obtener todos los juegos de Steam | ≤13 KB | `borradores/04-steam-data.md` (adaptar a D-07/D-08); `investigacion/01-*.txt` |
| `05-arquitectura.md` | §5 Arquitectura (diagramas, flujos, alternativas evaluadas, ADR-001 y lista de ADR) | ≤14 KB | §2–3 de este documento; `panel-arquitectura/*.json` |
| `06-stack.md` | §6 Stack con versiones | ≤6 KB | §6 de este documento; `panel-arquitectura/*.json` |
| `07-modelo-datos.md` | §7 Modelo de datos (modelo lógico, esquema Dexie, HLC/outbox/`merge()`, formatos del catálogo, DDL de D1 para M4) | ≤14 KB | `lineas-paralelas/T2-*.revisado.md`; D-03–D-08, D-13 |
| `08-busqueda.md` | §8 Búsqueda instantánea | ≤12 KB | benchmark revisado (`lineas-paralelas/T3-*.revisado.md`, se genera ahora); D-09 |
| `09-ux.md` | §9 UX y pantallas | ≤18 KB | `lineas-paralelas/T1-*.revisado.md`; D-05, D-10, D-11 |
| `10-cuenta-steam.md` | §10 Integración con la cuenta de Steam (Fase 2) | ≤6 KB | `borradores/10-steam-account.md`; `investigacion/02-*.txt`; D-14 |
| `11-seguridad-privacidad.md` | §11 Seguridad, privacidad y cumplimiento | ≤8 KB | `borradores/11-legal.md`; `investigacion/02-*.txt`; D-12–D-16 |
| `12-calidad-ingenieria.md` | §12 Calidad e ingeniería | ≤8 KB | `lineas-paralelas/T4-*.revisado.md`; D-16, D-17 |
| `13-entorno-desarrollo.md` | §13 Entorno de desarrollo en este PC | ≤5 KB | T4 revisado; `ESTADO-SESION.md` §3 |
| `14-estructura-repo.md` | §14 Estructura del repositorio | ≤4 KB | D-18; T4 revisado |
| `15-roadmap.md` | §15 Roadmap e hitos con criterios de aceptación | ≤12 KB | §4 de este documento; T4 revisado |
| `16-riesgos.md` | §16 Riesgos y mitigaciones | ≤6 KB | T4 revisado; riesgos del panel |
| `17-multiplataforma.md` | §17 Multiplataforma (Fase 2) | ≤4 KB | `borradores/17-future.md`; `investigacion/02-*.txt` |
| `18-preguntas-abiertas.md` | §18 Preguntas abiertas | ≤4 KB | `ESTADO-SESION.md` §7; preguntas abiertas que estas decisiones no resuelven |

La §1 (Resumen ejecutivo) y la §19 (Referencias) se escriben al final, cuando estén todas las demás.

**Nota sobre el JS inicial:** el presupuesto es el de la §5 de este documento (medido el 28-10-2026). Su hogar en `prototipe.md` es la §6; las demás secciones remiten a ella.

---

## 10. Ajustes tras la redacción (28-10-2026, 13:00) — mandan sobre lo anterior

Resueltos a partir de las mediciones y de los conflictos detectados entre secciones:

1. **Ranking (D-09):** se adopta la variante medida. El **nivel 0 (exacto o alias exacto) va siempre primero**; los niveles 1 y 2 se ordenan juntos por `pop + 6` (nivel 1) y `pop + 0` (nivel 2), con el orden de filas como desempate; después van el nivel 3 (subcadena) y el 4 (difuso). Medido: «wukong» pasa del puesto 12 al 2; dorado top-1 94,9 % y top-5 99,0 %; exactos 99,9 %; prefijos 93,2 %. El modo estricto queda como alternativa documentada. Umbrales de los niveles 3 y 4: los de la §8.4 de `prototipe.md`.
2. **Puente de búsqueda en M1 (D-09):** mientras el índice se construye (4,56 s con CPU ×4), el Worker responde con un **escaneo lineal** sobre los nombres normalizados, con los mismos niveles (listo en 1,72 s con ×4; p95 42 ms). Estados del Worker: `none` → `scan` → `full` (y `boot` en M3). La construcción del índice cede el turno para atender consultas. El índice persistido y el núcleo de arranque siguen en M3, con objetivo de restauración ≤0,4 s con ×4 (hoy 0,55 s).
3. **Normalización (D-09):** se añaden las formas de apóstrofo ‛ ʻ ´ ′ ＇ y el acento grave (U+0060), la recomposición NFC tras quitar diacríticos y ð→d, þ→th, ı→i (ver §8.1 de `prototipe.md`).
4. **Pipeline (D-07):** `data_request` de Query = `include_release`, `include_assets`, `include_reviews`, `include_platforms` + `include_best_purchase_option:false`; **sin `include_basic_info`** (pesa ≈2,6× y D-08 no usa sus campos; la ficha no muestra descripción ni desarrollador). Verificado el 30-10-2026: sin él siguen llegando `is_free` y los demás campos de D-08 (`docs/medidas/verificaciones-m0-20261030.md`). Presupuesto: ≈4 + ≈208 + ≈5–20 ≈ **220 llamadas/día (≤230)**, ≈50 MB gzip al día, ≈11–13 min. Consulta de humo «counter strike» → 730 **entre los 3 primeros** (el exacto «Counter-Strike», appid 10, va antes). El catálogo es la unión de GetAppList y Query.
5. **Orden del núcleo (D-08):** no retirados por reseñas descendentes; a igualdad, **`appid` descendente** (lo más reciente primero); los retirados al final. Tamaños reales del núcleo D-08 (196 665 juegos): 7,00 MB · 3,05 MB gzip -9 · 2,59 MB brotli 5 · 2,25 MB brotli 11; núcleo de arranque (20 000): 269 KB brotli 11 / 345 KB gzip; `aliases` (3 563 pares, formato `alias compacto TAB appid`): 16 KB brotli. El *manifest* lista `core`, `recent`, `aliases` y un índice de *shards* (`details/index.<hash>.json`); cada *shard* se verifica por el *hash* de su nombre.
6. **«A continuación» (D-05):** agrupa las entradas con la marca Próximo cuyo estado es **Quiero jugar o En pausa**. En los demás estados la marca se conserva sin efecto.
7. **Relojes (D-06/D-13):** la micro-API rechaza operaciones con HLC **más de 5 min por delante** de su reloj; cada respuesta de `sync` incluye la hora del servidor y el cliente corrige con ese desfase la parte física de su HLC y vuelve a sellar las operaciones rechazadas. El nodo de la HLC es aleatorio por sesión o pestaña.
8. **Medición de rendimiento (D-17):** el estrangulamiento de CPU por CDP **no afecta a los Workers dedicados** (medido). La prueba de búsqueda con ×4 ejecuta el núcleo de búsqueda en el hilo principal de una página de prueba (medido después en el Chromium de Playwright: tampoco con `Target.setAutoAttach`; ver §8.9 de `prototipe.md`); el Worker real se valida en el Android de referencia. INP, toque → respuesta y tareas largas se miden en la app real con ×4.
9. **Puertas de calidad de búsqueda en CI:** el CI no llama a la red, pero sí ejecuta el dorado, los 2 000 exactos y los prefijos sobre una **copia congelada y comprimida del núcleo real** en `fixtures/` (≈3 MB gzip, se renueva a mano como mucho una vez por hito). `catalog.yml` ejecuta las mismas puertas sobre el núcleo recién construido antes de publicar.
10. **Hitos:** M1 incluye una **ficha básica** (datos del núcleo y todos los campos de la entrada); M2 trae la **ficha completa** (portada y datos de los *shards*) y la vista **Próximos** de Mi lista (`/?vista=proximos`). M3 y M4 pueden intercambiarse si se usa la app en dos dispositivos desde el principio o en un iPhone sin instalar; el orden por defecto es M3 → M4.
11. **Otros detalles aceptados:** `workbox-build` 7.4.1 como dependencia de desarrollo; Vitest 5.0.5 admite Vite ^6.4, ^7 y ^8; `not_found_handling: single-page-application` en `ga-web`; ADR en `docs/adr/NNN-titulo.md`; migración a Node 26 al cerrar M4; carpeta `scripts/` en la raíz; esquemas Zod en `packages/core/src/schemas/`; la búsqueda del valor de la clave en `ci.yml` compara *hashes* SHA-256 (variable `STEAM_KEY_SHA256`); `deploy-web.yml` se lanza con `workflow_run` tras el CI en verde; *build* `e2e` con un catálogo de prueba firmado con una clave de desarrollo; la importación CSV solo crea entradas nuevas; los números de la interfaz usan espacio fino irrompible como separador de millares a partir de 5 cifras.
12. **Firma del *manifest*:** la clave privada ed25519 vive **solo** en un secreto de GitHub. Si hay que ejecutar el pipeline desde el PC (429 en los *runners* compartidos o falta de minutos), el PC solo descarga y construye, y sube el resultado como *asset* de una *Release* de preparación (`catalog-staging`); después se lanza `catalog.yml` con `workflow_dispatch` (`source=staging`), que pasa las puertas, firma y publica. El PC nunca firma ni despliega `ga-catalog`.
13. **Esfuerzo:** M0 = 2–3 días y M1 = 9–12 días; total M0–M4 = **22–30 días ideales** (ver §4). Semanas acumuladas (día ideal ≈6 h): a 10 h/semana, ×0,6; a 15 h/semana, ×0,4; a 30 h/semana, ×0,2 (M4: 13,2–18 / 8,8–12 / 4,4–6 semanas).
14. **Prototipo de búsqueda medido:** el código, el dorado, los vectores y los resultados del 28-10-2026 están en `docs/planificacion/prototipo-busqueda/`; el núcleo real congelado y sus alias, en `fixtures/catalog-frozen/core.20261028.1.tsv.gz` y `aliases.20261028.1.tsv`.
15. **Accesibilidad:** axe sin violaciones graves ni críticas en cada hito; pasada con NVDA al cerrar M1; con NVDA, Narrador, TalkBack y VoiceOver al cerrar M3.
16. **App de escritorio en M3 (29-10-2026, decisión del usuario; sustituye a lo que D-01 y la §4 dejaban en Fase 2):** el envoltorio Tauri 2 con `Ctrl+Mayús+Espacio` entra en M3 como una vía más de captura (ADR-010; RF-30; CA3.7 y CA3.8). Sigue siendo la misma web: carga el origen de `ga-web`, no tiene lógica propia y la página no recibe órdenes de Tauri. M3 pasa de 3–4 a **4–6 días** y el total M0–M4, a **23–32 días ideales** (a 15 h/semana, 9,2–12,8 semanas). ADR renumerados por orden de escritura: 010 app de escritorio (M3), 011 sincronización (M4) y 012 cuenta de Steam (Fase 2). Hasta M4, la app de escritorio tiene su propia agenda (WebView2 no comparte datos con el navegador; R-18). El CI no compila Rust: el instalador NSIS sin firma se genera en el PC. Versiones comprobadas en crates.io el 29-10-2026: `tauri` 2.12.5, `tauri-build` 2.7.4, `tauri-plugin-global-shortcut` 2.4.1, `tauri-plugin-single-instance` 2.5.5 y `tauri-plugin-autostart` 2.7.0; `@tauri-apps/cli` 2.12.4. Si casi todo se apunta en el PC (PA-01), la app de escritorio pasa a justo después de M1.
17. **Presupuesto de escritorio de la pulsación (30-10-2026, decisión del usuario; cambia RNF-02, §8.9, §12.4 y CA1.5):** tecla → resultados p95 **≤16 ms con pantallas de ≥120 Hz y ≤2 fotogramas por debajo** (≈33 ms a 60 Hz). El presupuesto con CPU ×4 (≤50 ms) no cambia. Motivo, medido el 29-10-2026: el Worker responde en 0,2 ms, pero Chromium retiene su mensaje hasta el primer fotograma tras la tecla (`DeferRendererTasksAfterInput`) y, a 60 Hz, el suelo es p95 ≈17 ms; la app da 19,7–21,0 ms a 60 Hz y 14,8 ms a 120 Hz. Se descarta precalcular en el Worker la siguiente tecla: cambiaría la §8.7 y gastaría CPU en el móvil. `npm run perf` mide la frecuencia con `requestAnimationFrame` y aplica el límite que toca (ADR-005).
18. **Datos y estilos tal como se han construido (30-10-2026; cambia D-02, D-03, §6.1, §9.5 y §14):** la interfaz pinta desde una agenda en memoria con `useSyncExternalStore` y guarda en Dexie después del fotograma; las pestañas se coordinan con el evento `storagemutated` de Dexie (ADR-004). `useLiveQuery` pintaría lo guardado y no lo pulsado, así que `dexie-react-hooks`, que no se llegó a usar, se retira. Los estilos son hojas CSS normales con *tokens*, una por pantalla: CSS Modules no hacía falta.
19. **Catálogo de M2 tal como se ha construido (31-10-2026; cambia §4.5–4.7, §5.4, §7.6, §8.7, §11.3, §12.3–12.5, §13.3 y CA2.4; sustituye la parte del PC del punto 12):** ADR-007.
    - **Desde el PC se suben las páginas crudas de Steam**, no `pipeline/out/` ni el estado. `catalog.yml` (`source=staging`) vuelve a derivar el catálogo sin red con el código de `main`. Así, las puertas y la firma corren siempre en el CI, y no hace falta otra orden de «puertas y firma sobre un catálogo ya hecho».
    - **`ga-catalog` va en su propia cuenta de Cloudflare** (`gameagenda-cat.workers.dev`), con su *token*: «Workers Scripts: Edit» abarca toda la cuenta y el pipeline procesa datos no confiables.
    - **La versión anterior se baja del `ga-catalog` publicado**, no del estado: es lo que tienen los clientes, y el estado no carga con el catálogo entero.
    - **El cron va en UTC** (04:17) y solo corre con la variable `CATALOG_SCHEDULE` = `on`.
    - **Recientes:** el estado guarda en cada fila su `addedOn` y su `renamedOn`, y un renombrado incluye los cambios de `nameEs`.
    - **«Falla el enriquecimiento»** es un error de Query o una cobertura menor del 95 % de `GetAppList`.
    - **Versión de la app y `minClientVersion`:** la app compara la versión de su `package.json`, y un *manifest* firmado pide la 0.2.0. Por eso el número sube junto con el cliente que verifica la firma: el 31-10-2026 no se hizo y la búsqueda se quedó unos 20 min sin catálogo.
    - **Fallos al bajar un fichero:** solo un error HTTP hace releer el *manifest* al momento; un fallo de red espera al reintento, de 1 min a 1 h. Un *kill switch* necesita otra `version` del catálogo.
    - **CA2.4:** los ≤200 KB son bytes transferidos, es decir, comprimidos.
    - **E2E en WebKit:** el WebKit de Playwright para Windows no trae Ed25519. El *build* `e2e` tiene un gancho que acepta el mini-catálogo firmado con `dev-1` sin verificarlo, y `webkit-movil` prueba además, con el gancho apagado, el camino real sin Ed25519 (RNF-12).
20. **Interfaz de M2 tal como se ha construido (31-10-2026; cambia §9.1, §9.2, §9.5 y §11.2):** ADR-008.
    - **Portadas activadas por defecto** (interés legítimo con oposición en un toque). Esperan a que se haya pintado el aviso de primera capa. La paleta nunca lo hace salir, porque taparía el campo de captura. ~~El Catálogo no lleva portadas en M2: pediría un *shard* por fila al desplazarse.~~ Cambiado el 02-11-2026: ver el punto 22.
    - **Próximos:** fechas en UTC, semana de lunes a domingo, un grupo por mes durante 12 meses, la precisión de trimestre o de año a Más adelante y las fechas ya pasadas a Por confirmar.
    - **Orden por lanzamiento** de lo más antiguo a lo más nuevo, con Por confirmar y los juegos sin datos al final.
    - **Nada de `:has()` en la raíz de la app** (§9.5, regla 7). Dos reglas `.app:has(…)` hacían recorrer Mi lista en cada cambio del DOM. Medido con 500 entradas y CPU ×4: 40 tareas largas, que pasan a 0, y el INP baja de 88 a 40 ms.
21. **App de escritorio tal como se ha construido (31-10-2026; cambia §6.1, §12.5, §13, §14.1, §16 R-18 y §17.3):** ADR-010.
    - **`ga-web` va como origen remoto, no local.** La ventana se crea en código con `ga-web` como URL externa y sin `frontendDist`. Con `frontendDist` apuntando a la URL de producción, Tauri 2.12.5 trata ese origen como local, y cualquier *capability* u orden propia que se añadiera después le llegaría a la página, contra el CA3.8.
    - **Sin `capabilities/` ni órdenes propias**, y con `withGlobalTauri` apagado. `apps/desktop/desktop.test.ts` lo vigila en `npm run check`, sin Rust.
    - **El atajo abre la paleta con un evento fijo** (`gameagenda:capture`) que la parte nativa ejecuta en la página. En Mi lista o en `/apuntar`, la paleta se abre ahí mismo; desde otra pantalla, la página va a `/apuntar`.
    - **Los enlaces `https` de fuera se abren en el navegador del sistema**: sin esto, WebView2 descartaba «Ver en Steam» sin avisar.
    - **El *crate* `windows` 0.62.2**, el mismo que ya usa Tauri, es la única dependencia nueva.
22. **Portadas también en el Catálogo (02-11-2026, decisión del usuario tras probar la app de escritorio; cambia §9.1, §9.5 y el punto 20):** ADR-008.
    - **Las filas del Catálogo llevan portada, como Mi lista**, con las mismas reglas: «Cargar portadas», el *kill switch* `covers`, el aviso de primera capa y la cadena `library_capsule` → `header` → generada.
    - **Solo piden sus detalles con el desplazamiento parado**, 150 ms después del último movimiento (el `isScrolling` del virtualizador). Mientras se desplaza, una fila tampoco se observa. Así, arrastrar la barra por 197 000 juegos no pide un *shard* por fila: lo comprueba un E2E, en el que, sin esa condición, se piden 5 *shards* durante el desplazamiento.
    - **Coste:** cada pantalla parada pide como mucho los *shards* de sus filas, unos 7,5 KB con brotli cada uno, y se guardan en `gacat-details`. Quien recorra mucho el Catálogo puede llegar a los ≈7,5 MiB de los 1 024. Las imágenes van por la caché HTTP del navegador: el Service Worker no las guarda, así que no echan las de Mi lista.
23. **Atajos de teclado de M3 tal como se han construido (02-11-2026; cambia §9.4 y la parte de teclado de CA3.4):** lo que la §9.4 no decía.
    - **`J` y `K` en la ficha** recorren Mi lista tal como se ve, con su vista, filtros y orden, y sustituyen la entrada del historial: Atrás vuelve a la lista y no recorre todas las fichas.
    - **`1`–`5` sobre un juego que no está en la lista** (Catálogo o ficha) lo apuntan en ese estado, como «Apuntar como». Las marcas, la nota y `Supr` solo valen para juegos de la lista.
    - **`F` no actúa en la ficha:** va al filtro de la pantalla que hay detrás solo si se ve (a ≥1 280 px, al lado).
    - **«Atajos de una tecla» es un solo interruptor** para todas las teclas sueltas, también el `+` del Catálogo de M1. El de `/` sigue aparte, como en M1. `Alt+↑/↓` lleva modificador y no se apaga (WCAG 2.1.4 solo pide apagar los de una tecla).
    - **El recorrido solo con teclado del E2E se hace en escritorio.** En el iPhone de Playwright, Tab no pasa por los enlaces, igual que en Safari por defecto. En el móvil, CA3.4 se cumple con los gestos y sus botones, que son la parte siguiente.
24. **Gestos de M3 tal como se han construido (02-11-2026; cambia §9.4 y completa CA3.4):** lo que la §9.4 no decía.
    - **«Avanzar el estado»** es Quiero jugar → Jugando («Empezar»), En pausa → Jugando («Retomar») y Jugando → Completado («Completar»). Completado y Abandonado no avanzan: la fila sigue al dedo unos píxeles y vuelve. Ningún gesto lleva a Abandonado ni quita nada.
    - **← abre una bandeja con las tres marcas** (Comprado, Platinado y Próximo) detrás de la fila. Un toque en una marca la cambia y cierra la bandeja; tocar fuera, desplazar la página o `Esc` la cierran sin cambiar nada, y tocar la propia fila no abre la ficha.
    - **La pulsación larga** (500 ms sin moverse más de 10 px) abre en Mi lista el menú del botón de estado, y en la paleta es `Alt+Intro`: «Apuntar como…» o, si ya está en la lista, la ficha (RF-06). En el Catálogo no hace nada: tiene `(+)` y los atajos `1`–`5`.
    - **Deslizar y mantener pulsado son solo del dedo y del lápiz.** Con el ratón ya están los botones de la fila; un arrastre del ratón seleccionaría texto o abriría la ficha.
    - **El asa `::`** sale en Quiero jugar y A continuación con orden por prioridad y dos filas o más, y va con el ratón, el dedo o el lápiz. La página se desplaza sola cerca de los bordes y `Esc` cancela. Al soltar, la agenda deja la entrada antes o después de la fila sobre la que cae (`move` con `{ before }` o `{ after }`): así vale también con la lista filtrada. Es `aria-hidden`: el teclado tiene `Alt+↑/↓` y todos, «Subir» y «Bajar» en el menú de la fila y en la ficha (WCAG 2.5.7).
    - **↓ cierra la hoja de la paleta** en el móvil (<768 px), solo con su lista arriba del todo. Usa el mismo umbral: el 40 % del ancho, no del alto.
    - **Ajuste «Gestos táctiles»** en Ajustes › Teclado y gestos, activado por defecto: apaga deslizar, la pulsación larga y ↓. El asa `::` no se apaga, porque es un control a la vista.
    - **`preventDefault()` en `touchmove` mientras el gesto es nuestro:** sin eso, Chrome trataba el deslizamiento como un desplazamiento lanzado y se tragaba el toque siguiente, que es el de la bandeja. Lo encontró el E2E: el toque llegaba como `pointerdown` y `pointerup`, sin `click`.
    - **El clic que manda el navegador al soltar un gesto se descarta** durante 400 ms, salvo en lo que el gesto acaba de abrir (la bandeja o el menú de estado): ese clic va a lo que se pulsó, no ahí.
    - **Al avanzar el estado con el dedo, el foco no se mueve.** La regla de pasar el foco a la fila siguiente (§9.5, regla 3) vale solo si el foco estaba en la fila que sale; con el dedo suele estar en la página, y moverlo la desplazaría.
    - **E2E con toques de verdad:** `gestures.spec.ts` usa `Input.dispatchTouchEvent` de CDP en Chromium, que pasa por `touch-action` y por los gestos del navegador como en un Android. El WebKit de Playwright no tiene cómo deslizar, así que esas pruebas, y la del arrastre con el ratón, corren en Chromium (también en el CI). Los botones equivalentes ya los prueban `list.spec.ts` y `shortcuts.spec.ts`.
25. **Índice persistido tal como se ha construido (02-11-2026; cambia §7.2, §7.6, §8.8 y §8.9; CA3.2):** lo que el plan no decía. El ADR-009 lo recogerá junto con el núcleo de arranque.
    - **La clave** es el formato (`INDEX_FORMAT`), la ruta del *chunk* del Worker y los `sha256` del núcleo, de `recent` y de los alias, los mismos que deciden si dos catálogos dan el mismo índice (`sameIndex`). La ruta lleva el *hash* del contenido, así que un índice construido por otro código no vale. Con `vite dev`, la ruta no cambia: allí no se guarda nada.
    - **Dos filas de `meta`:** `searchIndexKey` (la clave) y `searchIndex` (≈27 MB). Al arrancar se lee primero la pequeña, en la misma transacción.
    - **Una versión nueva no se restaura con el índice anterior:** no se puede usar el de otro núcleo. Si se cierra la app antes de que acabe la construcción en segundo plano, el arranque siguiente construye como en M1 (`scan` en ≈2 s). El plan decía que se seguiría usando el anterior mientras tanto: haría falta guardar los dos, y no se ha hecho.
    - **Se guarda después de `full`,** a trozos que ceden el turno, solo sin construcción en marcha y con tiempo en el bloque. Con el catálogo completo, sin estrangular: ≈200 ms tras `full`.
    - **Formato:**
      - las listas de cadenas, en UTF-8 unidas con `\n`: restaurarlas es la mitad de caro que clonar 197 000 cadenas sueltas, y ocupan la mitad que una cadena unida, que pasa a 2 bytes por carácter con un solo nombre fuera de Latin-1;
      - los nombres y las claves base no se parten: se decodifican una vez y `nameOf` y `keyOf` recortan cada fila. Con CPU ×4, partirlos costaba 74 ms cada uno, el 60 % de restaurar. Por eso el buscador pide nombres y claves por función (`KeyData`), y el nivel 4 crea sus bloques de 20 000 claves al usarlos;
      - el pajar, en UTF-8: la construcción deja sus textos a 2 bytes por carácter y, al decodificarlos, la parte de 1 byte vuelve a serlo (ocupa la mitad, y `indexOf` va ≈20 % más deprisa en Node);
      - los *bitsets* se guardan, y la tabla fila → alias se rehace;
      - una cadena con un surrogado suelto no cabe en UTF-8: entonces no se guarda nada y se construye en cada arranque.
    - **Dos fases** (por la tarde del mismo día, a petición del usuario): en el *runner* del CI, leer los ≈27 MB de IndexedDB tardaba el doble que en el PC, y el trabajo «Rendimiento (informa)» salía en rojo (463 ms). Ahora el pajar del nivel 3 (≈5 MB) va en su propia fila de `meta` (`searchIndexHaystack`) y se lee después, como prevé la §8.8; los niveles 0–2 ya responden con lo principal. Si el pajar falta o no cuadra, el índice se construye en segundo plano desde la caché y se vuelve a guardar. El diccionario de tokens tampoco se parte: es una columna (`TokenList`, con `length` y `at()`, que un `string[]` ya cumple). `INDEX_FORMAT` pasa a 2.
    - **Medido con CPU ×4 y el catálogo completo** (`npm run perf`), en dos fases: del arranque a la primera consulta respondida, 162 ms (peor de 2), con IndexedDB en 119 ms y restaurar en 73 ms. En una fase, 275 ms (lo que sigue). Se reparten así: IndexedDB 124 ms, restaurar 114 ms y la primera consulta 21 ms. En la app real, la búsqueda está lista 782 ms después de recargar. Al principio, con los nombres y las claves partidos, salían 473 ms.
    - **Un *chunk* diferido que no importa nada:** el formato (`@gameagenda/core/search-persist`) va aparte, como uFuzzy, para que el de entrada del Worker siga bajo los 40 KB (38,1 KB). Al arrancar se pide a la vez que se lee IndexedDB. Primero importaba código del *chunk* de entrada, y WebKit volvía a evaluar ese módulo: un segundo *host* sin catálogo contestaba vacío a cada consulta. Lo encontró el E2E en `webkit-movil`. Ahora `persist.ts` solo importa tipos y devuelve las partes del índice; el buscador lo monta `searcherFromParts`, desde el *chunk* de entrada. `npm run size` comprueba que ningún *chunk* diferido del Worker importa otro.
    - **Los E2E que paran la construcción** (`hold`) no restauran, para que se queden donde piden.
26. **Captura de M3 tal como se ha construido (02-11-2026; cambia §9.2 y completa RF-07; CA3.3):** lo que la §9.2 no decía.
    - **`/share` mira `url`, `text` y `title` por ese orden**, y basta con que el enlace vaya dentro del texto: es como lo manda la app de Steam («Mira este juego… https://store.steampowered.com/app/…»). Que la app de Steam lo haga así de verdad sigue **a verificar en el Android de referencia**, como «Compartir» con la PWA instalada (*issue* #1).
    - **Con un enlace, se apunta al momento** con su aviso y Deshacer, y la entrada `/share?…` del historial pasa a ser `/`: Atrás no vuelve a compartir. Si ya estaba en la lista, el aviso lo dice y no se duplica. Sin enlace, la paleta se abre con el texto ya buscado.
    - **`Ctrl+V` va con el evento `paste`, no con `navigator.clipboard`:** así no pide permiso para leer el portapapeles. Solo actúa fuera de los campos de texto, los menús y los diálogos (las mismas reglas que las teclas sueltas), y solo con un enlace de Steam. Otro texto no se toca.
    - **El chip «Pegar enlace» va en la paleta vacía, y solo con el dedo** (`pointer: coarse`). Con teclado ya está `Ctrl+V`, y en el PC `readText()` pediría permiso. En iOS sale el «Pegar» del sistema, el tercer toque de la §9.2. Si no hay enlace o no deja leer, se dice junto al campo.
    - **Los tres esperan al catálogo como mucho 500 ms**, como Intro sobre un enlace en la paleta: un arranque en frío desde «Compartir» puede no tener aún el catálogo, y entonces el juego queda provisional y se resuelve después.
    - **La ayuda de atajos** lleva `Ctrl+V`.
    - **E2E:** `share.spec.ts` prueba `/share` y `Ctrl+V` en las dos plataformas, con eventos `paste` sintéticos, más un `Ctrl+V` de verdad con el portapapeles en Chromium. El chip se prueba en Chromium móvil, con `readText` simulado. La PWA instalada, la hoja de «Compartir» de Android y el «Pegar» de iOS solo se pueden probar en el dispositivo.
27. **Panel de rendimiento tal como se ha construido (02-11-2026; cambia §9.1 y §12.7):** lo que la §12.7 no decía.
    - **Se mide siempre, desde el arranque,** con `PerformanceObserver`: las medidas de la §12.4 que ya hacía la app, el INP y el LCP. No hay que encender nada antes de una sesión de medida. Cuesta un observador por tipo y una escritura en IndexedDB 2 s después del último cambio, y `npm run perf` lo confirma: ninguna tarea larga al teclear o apuntar.
    - **Se guardan en `meta.perfSamples`,** las 500 últimas de cada medida, para sumar sesiones: cada reinicio da una muestra de arranque, y CA3.1 pide tres sesiones. Con varias pestañas a la vez gana la última que guarda; para medir basta una.
    - **Los presupuestos son los del móvil** (§3): el panel es para el Android de referencia y el iPhone (CA3.1). En escritorio, tecla → resultados tiene el suyo, por fotogramas (§8.9), que mide `npm run perf`.
    - **El INP es la entrada más lenta de cada interacción,** con `durationThreshold` de 16 ms, el mínimo de Event Timing: las interacciones más rápidas no se ven, así que el p75 sale por lo alto. Safari no tiene Event Timing: allí el INP queda sin muestras, y el panel lo dice.
    - **El LCP es el último antes de la primera tecla o toque,** una muestra por carga, también en los reinicios.
    - **«Copiar informe»** copia texto plano. Si no se puede escribir en el portapapeles, el informe sale en un campo para copiarlo a mano. No se envía nada.
    - **La tabla se desplaza sola** a 320 px: su zona desplazable se puede enfocar con el teclado (axe: `scrollable-region-focusable`).
28. **Auditoría WCAG 2.2 AA de M3 tal como se ha hecho (02-11-2026; cambia §9.7; CA3.5):** lo que la §9.7 no decía.
    - **El contraste se comprueba en los tokens, no solo en pantalla.** axe solo mide el texto que ve en cada prueba, y no mide el anillo de foco ni los bordes (1.4.11). `scripts/tokens-contrast.test.ts` lee `tokens.css` y comprueba 32 pares en cada tema: el texto y el secundario sobre los tres fondos (≥4,5:1); el acento, el borde de los controles y los iconos (≥3:1); cada estado y cada marca sobre su chip y sobre la superficie; y el texto de los gestos armados. Pasan todos sin tocar ningún color. Va en `scripts/` porque necesita leer el fichero desde Node.
    - **El zoom al 400 % se prueba a 320 px de ancho,** que es a lo que equivale en un PC de 1 280 px, en cada pantalla y con la paleta abierta.
    - **2.4.11 se prueba con el teclado,** en una ventana de 390 × 480: cada fila enfocada al bajar con `↓` queda entre la cabecera y las barras de abajo, gracias al `scroll-padding` de la §9.7.
    - **2.5.3 con la regla experimental de axe** `label-content-name-mismatch`, en Mi lista con juegos: sin hallazgos. No se activa en el resto de pruebas, por si da falsos positivos.
    - **Los lectores de pantalla no se pueden automatizar aquí:** la pasada de apuntar → cambiar estado → Deshacer con NVDA, Narrador, TalkBack y VoiceOver la hace el usuario, con `docs/medidas/guia-lectores-pantalla-m3.md`. La de NVDA es la misma de CA1.10 (*issue* #1).
29. **Versiones nuevas de la app sin que se note (02-11-2026, decisión del usuario; cambia §5.2 y §17.3):** lo que el plan no decía.
    - **El problema:** el Service Worker no usa `skipWaiting`, así que una versión nueva espera a que no quede ninguna ventana de la app. En la app de escritorio, la ventana vive en la bandeja, y la versión nueva solo entraba tras «Salir» o al reiniciar Windows (hallazgo de CA3.8, `docs/medidas/ca3.8-20261102.md`).
    - **Cuándo entra:** cuando la página lleva 1 minuto seguido oculta (una pestaña en segundo plano, o la app de escritorio en la bandeja) y no hay nada a medias. Entonces pide el relevo al Service Worker en espera (`SKIP_WAITING`) y se recarga en la misma ruta. A la vista no se recarga nunca.
      - «A medias» es: texto escrito en el campo con el foco; un diálogo, un menú o la lista de la paleta abiertos; un aviso a la vista (8 s, con su Deshacer); o el catálogo aún cargando.
      - Si hay algo a medias, se vuelve a mirar cada minuto.
      - La lógica está en `pwa/update-policy.ts` y `pwa/work-in-progress.ts`.
    - **Nunca con otra ventana de la app a la vista:** el Service Worker solo toma el relevo si las demás ventanas están ocultas. Al activarse borra la precaché anterior, y una ventana a la vista seguiría con el código anterior y sin ella. Una pestaña oculta que se queda con el código anterior (porque otra puso la versión nueva) se recarga con las mismas reglas.
    - **La app mira si hay versión nueva** (`registration.update()`) a los 10 s de arrancar, luego cada hora, y también al ocultarse si hace más de una hora que no mira. El navegador de la app de escritorio no la buscaba solo al abrirla (en 30 s, comprobado el 02-11-2026), y la app puede pasar días sin recargar. Con «Iniciar con Windows», al encender el PC la versión nueva entra en poco más de un minuto.
    - **En la app de escritorio, el WebView se oculta con la ventana** (`Webview::hide` y `show`, sin funciones inestables de Tauri). Sin eso, la página seguía en `visible` dentro de la bandeja y pintaba a ritmo completo (84 fotogramas cada 500 ms), y la regla anterior no se cumplía nunca. Con el cambio, pasa a `hidden` y a 0 fotogramas (medido el 02-11-2026 con CDP en crudo).
      - Ojo al medirlo: Playwright, al conectarse por CDP, emula una página activa, y `visibilityState` sale siempre `visible`.
      - El atajo no se resiente: la paleta tiene el foco a los 32–87 ms de pulsarlo (antes, p50 de 37 ms).
      - Con `--autostart`, ya nace oculta. Los guardados de Mi lista no esperan al fotograma más de 50 ms, y el atajo sigue abriendo la paleta.
      - Hace falta el instalador nuevo.
    - **Pruebas:**
      - `update-policy.test.ts` y `work-in-progress.test.ts`;
      - `pwa-update.spec.ts` (Chromium), con la página oculta por `visibilityState` y el reloj de Playwright: la versión entra tras el minuto y en la misma ruta; con texto en la paleta, no, y al vaciarla, sí; y no entra con otra pestaña a la vista.
      - **En la app de escritorio instalada, con producción (02-11-2026):** se abrió con `--autostart`, oculta, con `index-CYfpGTZv.js`, mientras se publicaba otra versión, y no se tocó nada más. Encontró la nueva y la dejó en espera a los 51 s; a los 112 s ya iba con ella (`index-D8AJgvtc.js`), sin mostrarse y sin «Salir».
      - Playwright no intercepta la petición de `sw.js` con la que el navegador busca versión nueva. Por eso, la vista previa `e2e` sirve un `sw.js` con otro byte cuando la prueba lleva la *cookie* `ga-e2e-sw` (`e2e-sw-plugin.ts`).
30. **Núcleo de arranque tal como se ha construido (04-11-2026, en la rama `m3-arranque`; cambia §4.6, §7.6, §8.8, §9.2, §9.6 y §12.4; RNF-05):** lo que el plan no decía. Lo recoge el ADR-009 con el índice persistido (§10.25).
    - **Es el prefijo del núcleo:** sus 20 000 primeras filas (`BOOT_ROWS`), en su orden y con las seis columnas, +18 incluidos. Como el núcleo va por reseñas (D-08), son los más populares sin otra lista que mantener, y la puerta de integridad lo comprueba fila a fila. Con un núcleo más corto, como el mini-catálogo de `fixtures/catalog`, lleva todas sus filas.
    - **El *manifest* lo cita en `files.boot` y `counts.boot`,** que el esquema de `core` ya admitía como opcionales desde M2. La firma se verifica sobre el JSON tal como llega, así que la app 0.2.0 lo ignora: `minClientVersion` no cambia.
    - **Puertas:** integridad (prefijo exacto, versión, recuento y `sha256`), tamaño (≤512 KiB con brotli 11; hoy, 269 KB) y humo (las mismas consultas sobre un índice del núcleo de arranque, con los mismos alias). Además, `assemble-catalog` comprueba su cabecera antes de desplegar, y `catalog-smoke` avisa si llega sin comprimir. Una versión anterior sin él, como las de M2, sigue valiendo.
    - **Solo en la primera visita:** se baja con los alias, antes que el resto, y se guarda en `gacat-<versión>` sin el *manifest*, así que una visita cortada lo reutiliza. Se indexa solo hasta `scan`, con prioridad sobre el núcleo; nunca se guarda su índice, y ni una actualización ni un reinicio con caché lo usan.
    - **En `boot`, lo que no está no se da por inexistente:** la paleta avisa junto a los resultados y, sin resultados, no resalta la fila manual ni dice que el juego no está en Steam, para que `Intro` no apunte a mano un juego que llega unos segundos después. La ficha y `lookup` responden solo si todo lo pedido está en él; el Catálogo y `matchExact` esperan a `scan`. Al pasar a `scan`, el cliente repite la consulta abierta y vuelve a buscar los provisionales.
    - **Si falla el núcleo en `boot`,** se sigue buscando en el de arranque, se anuncia el error con «Reintentar» y la carga se repite sola con la espera creciente de las actualizaciones (1 min … 1 h). «Actualizar catálogo» y la vuelta de la red durante la primera carga esperan a que acabe: nunca hay dos descargas a la vez.
    - **Medidas** (`npm run perf`, CPU ×4, catálogo completo, en local): `boot` en 613–759 ms en la página de prueba y `search:ready` de la app en 841–859 ms (≤1 500 ms). La medida `search:boot` del panel de rendimiento (p95 ≤1,5 s) es la que servirá en el dispositivo (CA3.1). El Worker pesa 38,7 KB de 40.
    - **Revisión con verificación (05-11-2026):** de 10 hallazgos, se arreglan 3.
      - Al salir de `boot`, las sugerencias del nivel 4 no se volvían a pedir, y las que calculaba el núcleo de arranque aún podían llegar y pintarse: ahora el Worker abandona la tarea en cuanto llega la consulta repetida, y el cliente las vuelve a pedir con la respuesta nueva.
      - El reintento de la carga en `boot` hacía una comprobación del *manifest* de más si el núcleo llegaba antes por «Reintentar» o por la vuelta de la red. Ahora cada reintento sabe si repite la carga o una actualización, y el de la carga se cancela al llegar el núcleo.
      - No se cambian: el aviso a 0 % mientras baja el núcleo de arranque (dura lo que tarda en poder buscarse, ≤1,5 s); bajar el núcleo a la vez que el de arranque (se repartirían el ancho de banda y la primera búsqueda llegaría más tarde); la paleta en `boot` con un error definitivo (no se da: esos errores salen al leer el *manifest*, antes que el núcleo de arranque); y tres de coste despreciable (el núcleo de arranque se queda en la caché hasta la versión siguiente, `lookup` dos veces en `boot` y el «20 000» fijo del aviso).
    - **Entra en `main` después de cerrar M2,** sin romper las ejecuciones programadas: primero el pipeline (`e78eea2`, con el *merge* `947efd4` del 05-11-2026); después, una ejecución programada que publique el núcleo de arranque, comprobada con `catalog-smoke`; y al final, el cliente.
      - La del 06-11-2026 (42214891787, en verde) publicó `20261106.1` con `files.boot` y `counts.boot` = 20 000 (773 256 bytes); el fichero responde con 200 e `immutable`.
      - El cliente entró en `main` ese mismo día, después del rediseño «Tinta» y de la navegación nueva (§10.31–10.33). Solo chocaron `docs/adr/README.md` y este fichero.
31. **Rediseño visual, dirección «Tinta» (05-11-2026, en la rama `rediseno-visual`, decisión del usuario; cambia §9.8):** el usuario pidió un aspecto minimalista y limpio. El encargo está en `docs/planificacion/prompts/rediseno-visual.md`; la auditoría, las opciones y las medidas, en `docs/diseno/rediseno-visual/propuesta.md`. Va en una rama aparte: si no convence, no se integra. El número 30 lo tiene el núcleo de arranque, en `m3-arranque`.
    - **Cómo se eligió:** dos direcciones, «Papel» (cálida, con el rosa) y «Tinta» (monocroma), se inyectaron como CSS encima de `ga-web` de producción con Playwright, con el catálogo y las portadas de verdad (`scripts/rediseno-capturas.ts`). El usuario eligió «Tinta».
    - **Qué cambia:**
      - neutros fríos y el acento en tinta, y `--danger` para lo que hacía el rosa de error y de borrar;
      - menos cajas: filas sin tarjeta dentro de una superficie agrupada por sección, con líneas finas desde el título (`--line`);
      - las vistas, en pestañas subrayadas, y la compra, en píldoras, cada una en una línea que se desliza. A 390 px, la primera sección sube de 436 a ≈280 px;
      - el estado, como un punto de color con el texto en gris, sin caja. Es «Punto», como en GitHub Projects: al usuario no le gustaba la píldora con el icono. Se comparó con «Etiqueta» (Notion, Jira) y «A la izquierda» (Linear, Things) en `docs/diseno/rediseno-visual/estado.mjs`. Se ve de 28 px y se toca en 44, y en el móvil estrecho el texto se queda;
      - portadas de 40 × 60 px con filo (`--row-h` de 76 px; el Catálogo sigue en su hueco de 72 px);
      - texto a 15 px, seis tamaños, tres pesos, tres radios y dos sombras.
    - **Iconos de estado y marcas:** el usuario pidió mejorarlos con diseños profesionales. Se compararon Phosphor, Fluent, Tabler y Heroicons (MIT), descargados con `npm pack` y leídos como datos, y se eligieron los macizos de Phosphor: los únicos con los ocho conceptos y el mismo lenguaje.
      - Platinado es un trofeo propio con la forma de los de PlayStation, a tres tintas de platino; Próximo, una chincheta roja. Las dos solo van en color con la marca puesta, y ambos cambios los pidió el usuario.
      - `--platinum` y `--next` pasan a platino y rojo, y `public/licencias.txt` lleva los avisos de Phosphor y de Lucide.
    - **Logo «Grafito»:** el usuario descartó el rosa porque tenía que ir con la B. Es el marcapáginas de Phosphor con el play hueco sobre un degradado de zinc, siguiendo las guías de iconos de Microsoft y Apple.
      - `scripts/generar-iconos.ts` saca todos los tamaños de dos originales (`public/icons/icon.svg` y `icons/icon-sangre.svg`), con el `.ico` de escritorio vía `tauri icon`.
      - El color de tema deja el rosa por el fondo de la B, claro y oscuro.
    - **Arreglos que salieron por el camino:**
      - en la paleta del móvil, la columna implícita de la lista se ensanchaba hasta el título más largo (395 px en 358) y el año quedaba bajo el botón (i): ahora es `minmax(0, 1fr)`;
      - el hueco entre el aviso de Deshacer y el de portadas usaba `offsetHeight`, que redondea, y con medias alturas salía de 8,5 px: ahora usa `getBoundingClientRect`.
    - **Medido (05-11-2026, CPU al 5 %):**
      - `check` en verde (945 pruebas) y los E2E de Chromium y WebKit (177, con axe, 320 px y foco);
      - JS inicial de 131,2 KB brotli frente a 130,4 KB en `main`, y 133 pares de contraste;
      - `npm run perf` en verde en 2 de 3 pasadas. La otra dio una tarea larga de 52 ms, sin fotograma largo, que no se repitió. INP de 32–64 ms, reinicio con caché hasta `scan` en 1 768 ms y restaurar el índice en 171 ms.
      - **Tras «Punto» (05-11-2026, CPU al 10 %):** todo en verde a la primera. `check` (945), los E2E de Chromium y WebKit (177) y `perf` entero: 0 tareas largas, INP de 40 ms, LCP de 680 ms, `scan` en 1 898 ms (justo bajo 2 000) y restaurar el índice en 182 ms.
    - **Quedan:**
      - el instalador de escritorio con el icono nuevo (`npm run desktop:build`);
      - la pasada con lectores de pantalla (CA3.5) sobre la interfaz nueva, que hace el usuario.
32. **El atajo de escritorio solo pone la app delante (06-11-2026, decisión del usuario; cambia RF-30, §9.2, §17.3 y CA3.7):** el usuario pidió que `Ctrl+Mayús+Espacio` dejara de abrir la paleta y solo pusiera la app en primer plano.
    - **Cómo:** `App.tsx` deja de escuchar `gameagenda:capture`; `desktop/desktop-capture.ts` se conserva sin uso, por si se recupera. La parte nativa no cambia, así que no hace falta reinstalar: con la ventana detrás, la muestra, la pone delante y le da el foco, y sigue lanzando el evento, que la página ya no atiende; con la ventana delante, la oculta. Para apuntar, `Ctrl+K` o `/`.
    - **Pruebas:** `desktop.spec.ts` comprueba ahora lo contrario: el evento no abre la paleta, no cambia de pantalla ni recarga, y con la paleta abierta no la cierra ni le borra el texto.
    - **CA3.7:** el p50 de 1,24 s del 02-11-2026 se midió con el atajo abriendo la paleta. Ahora el recorrido es atajo, `Ctrl+K`, nombre e `Intro`.
    - **Pendiente:** en el próximo instalador, quitar de `main.rs` el `eval` de `CAPTURE_SCRIPT` y su comentario, y la prueba que fija el evento en `desktop.test.ts`.
33. **Navegación nueva entre Mi lista, Catálogo y Ajustes (06-11-2026, decisión del usuario; cambia §9.1):** al usuario no le gustaba («bastante malo»). Había una barra lateral de 200 px para tres secciones y, en el móvil, las pestañas y la barra del buscador apiladas abajo, unos 116 px.
    - **Cómo se eligió:** dos opciones basadas en apps de referencia, inyectadas como CSS encima del *build* y comparadas en `docs/diseno/navegacion/navegacion.mjs`:
      1. pestañas en la cabecera (GitHub, Vercel) con una cápsula flotante en el móvil (iOS 26);
      2. barra lateral de altura completa (Linear, Notion) con la barra de Material 3 en el móvil.

      El usuario se quedó con la barra lateral para el PC, pero «que se pueda encoger», y con la cápsula para el móvil.
    - **PC:** `.app-sidebar` agrupa la cabecera y la navegación en una columna fija de altura completa:
      - arriba, la marca, el botón «Barra lateral» (`aria-expanded`, con `title` «Encoger…» o «Desplegar…») y «Más opciones»; debajo, el buscador, y luego las secciones;
      - encogida (`data-sidebar="collapsed"`, ajuste `sidebarCollapsed`, que se lee antes del primer pintado), la columna pasa de 248 a 64 px con una transición de `grid-template-columns`;
      - los nombres se ocultan solo a la vista y salen en `title`; el buscador queda en una lupa de 40 px que, al abrir la paleta, se despliega hacia el contenido;
      - `--header-h` pasa a 0 en el PC, porque no hay cabecera encima del contenido, y los avisos se centran con `--sidebar-w`.
    - **Móvil:** `.app-sidebar` va con `display: contents`, así que la cabecera vuelve a la rejilla, arriba.
      - Las secciones van en una cápsula flotante de 60 px, a 12 px del borde; el buscador es un botón redondo de 56 px a su derecha. El campo sigue ahí, invisible, para el teclado de iOS.
      - Donde no hay buscador (Catálogo, Ajustes, ficha), la cápsula ocupa todo el ancho, y el filtro del Catálogo sube arriba.
      - `--tabbar-h` y `--capturebar-h` pasan a 64 y 8 px.
    - **Orden del DOM:** sigue al visual: marca, encoger, «Más opciones», buscador y secciones (antes, el buscador iba antes que «Más opciones»).
    - **Pruebas:**
      - `sidebar.spec.ts`: encoger, nombres accesibles y `title`, recordarlo al recargar y la lupa que abre la paleta; en el móvil, la cápsula flotante y sin botón de encoger;
      - `check` (945) y los E2E de Chromium y WebKit (179), en verde.
      - `perf`: 1 o 2 tareas largas de 51–60 ms al apuntar, las mismas que dio `main` medido justo después en las mismas condiciones (CPU al 16 %). Son del equipo, no del cambio.
    - **Lo que llena la barra lateral (06-11-2026, opción 1 «Todo junto», elegida por el usuario frente a «Solo Jugando ahora»; páginas `relleno.mjs`):** al usuario le sobraba el espacio vacío debajo de las secciones. `SidebarLibrary` solo se monta en el PC (≥768 px) y lleva, en este orden:
      - **Vistas**, como las listas de Things: Pendientes, Jugando, Quiero jugar, En pausa, Completado, Abandonado, Próximos y Todos, con su punto de color (el de «Punto»; aro en las que no son un estado) y su contador. Los contadores aplican el filtro de compra, y el de Próximos sale cuando se saben las fechas (`useReleases`).
        - Los enlaces conservan la compra, el orden y la búsqueda, como las pestañas, y la vista abierta sale de la URL (`aria-current`).
        - Con la barra desplegada, las pestañas de vista de Mi lista no se ven en el PC; vuelven con la barra encogida y en el móvil.
      - **Jugando ahora** y **A continuación**, como la biblioteca de Spotify o de Steam: hasta 4 juegos de cada uno, con portada de 28 px, que abren la ficha. Encogida, solo las portadas, con el nombre en `title`.
      - **Un pie anclado abajo** con «Atajos de teclado» y el catálogo («Catálogo: 188 370 juegos», o si está cargando o sin cargar).
      - Se desplaza dentro de la barra si no cabe.
      - **Pruebas:**
        - `sidebar.spec.ts`: contadores, vista abierta, conservar la compra, «Jugando ahora» abre la ficha y las pestañas vuelven al encoger;
        - los E2E que pulsaban las pestañas usan `viewControl`: en el PC, el enlace de la barra; en el móvil, la pestaña;
        - `check` (945), los E2E (181) y `perf` entero en verde con la CPU al 5 %: 0 tareas largas, INP de 40 ms y `scan` en 1 802 ms.

34. **Micro-API de M4, la base (06-11-2026, en la rama `m4-sincronizacion`; cambia §5.2, §6, §7.7, §11.4 y R-10):** lo que el plan no decía. Lo recoge el ADR-011 («propuesta»).
    - **Rama:** M4 va en `m4-sincronizacion` hasta que exista la base de D1 en Cloudflare y el *token* de `deploy-web` tenga permiso de D1. Con el *binding* de D1 en `wrangler.jsonc` de `main`, cada despliegue fallaría hasta entonces.
    - **Encaminamiento:** `main: ./worker/index.ts` y `run_worker_first: ["/api/*"]`. Lo que llegue al *script* fuera de `/api/*` vuelve a los *assets* con `env.ASSETS.fetch()`. La variable `SYNC_ENABLED` vale `"0"`, y con ella toda `/api/*` responde 503 hasta publicar los textos legales (CA4.7).
    - **Contrato en `core`:** `@gameagenda/core/api`, con los esquemas Zod de peticiones (estrictos) y respuestas (abiertos), los códigos de error y el formato de los códigos.
    - **Tipos del entorno escritos a mano** (`apps/web/worker/env.ts`), sin `@cloudflare/workers-types`: son seis métodos de D1, `ratelimits` y `ASSETS`, y así la D1 de las pruebas, sobre `node:sqlite`, implementa la misma interfaz. Hono pasa a la 4.13.16 (parche).
    - **Cookie indicio `__Host-ga_sync=1`,** sin secreto y legible por la app, junto a la credencial `HttpOnly`: con IndexedDB borrada, la app sabe que sigue emparejada sin preguntar al servidor en cada arranque (CA4.3).
    - **Códigos:** 28 símbolos de Crockford (140 bits), en 7 grupos de 4. El emparejamiento se canjea con `DELETE … RETURNING`. Usado, caducado e inventado dan la misma respuesta.
    - **Recuperación:** el código sigue valiendo tras canjearlo. Ruta nueva, `POST /api/v1/recovery`, para crear otro y anular el anterior.
    - **Revocar y canjear borran la fila:** el esquema pierde `revoked_at` y `used_at`, y gana `label`, `created_at` y `last_seen_at` en `device`, `created_at` en `agenda` e `inbox_item`, `recovery_hash` único e índices para las cascadas.
    - **Edad:** el cliente manda la `minAge` que pidió declarar, y si no coincide con la variable `MIN_AGE` (14), el servidor responde 409. El proyecto de ley que la sube a 16 seguía en el Congreso el 06-11-2026 (R-10).
    - **Límites:** `RL_AGENDA`, 5 por minuto, y `RL_REDEEM`, 10 por minuto, por el SHA-256 de la IP.
    - **Pruebas:** 32 de la micro-API con `app.request()` y 4 de los códigos de `core`. También `wrangler dev` con `workerd` y D1 locales: `STRICT`, `WITHOUT ROWID` y `RETURNING` funcionan, el *fallback* de la SPA sigue igual y el límite real da 429 en la quinta alta del minuto.
    - **Sin verificar hasta desplegar:** si el plan gratuito admite la jurisdicción UE de D1 y el *binding* `ratelimits`; la documentación no lo dice.

35. **`POST /api/v1/sync` y el mantenimiento de D1 (06-11-2026, en la rama `m4-sincronizacion`; cambia §7.7 y §11.2; CA4.1):** lo que el plan no decía. Lo recoge el ADR-011.
    - **El LWW, en la `merge()` de `core` y no en SQL.** El servidor lee la `seq` y las filas de las entradas tocadas, aplica el lote con `applyOps()` y escribe lo que cambia (`worker/sync-plan.ts`). Así hay una sola implementación. El desempate por valor del SQL de la §7.7 comparaba UTF-8, y el de JavaScript compara UTF-16.
    - **Concurrencia optimista:** `UPDATE agenda … WHERE seq = <leída>` con un `write_id` nuevo, y el `INSERT` solo escribe si sigue siendo el suyo. Si choca, se repite hasta 3 veces; después, 503 `busy`. La purga sube la `seq` 1 para que un `sync` en curso lo note.
    - **Rechazos por acción:** si una operación no vale, se rechazan todas las de su HLC (`invalid`). Las que van más de 5 min por delante, como `clock`.
    - **`purgedSeq` en la petición:** sin él, cada página de un *reset* volvería a ser un *reset*. Hay *reset* si `0 < cursor < purged_seq` y la app no ha visto esa purga.
    - **Cursor por delante del servidor** (D1 vuelto atrás): baja desde 0, y la app, al ver un cursor menor, vuelve a subirlo todo.
    - **Lotes de 200, no de 500:** con 500 operaciones, filtrar y planificar cuesta en Node p99 4,9 ms en caliente y 8,5 ms en frío, cerca de los 10 ms de CPU del plan gratuito. Con 200, p99 ≈2,3 ms. El servidor admite hasta 1 000 por petición.
    - **Mantenimiento diario** (Cron Trigger a las 03:17 UTC): *tokens* caducados y agendas sin sincronizar en 13 meses; los lunes, la purga de lápidas y esqueletos de más de 90 días.
    - **La cookie y `last_sync_at`** se renuevan al sincronizar, como mucho una vez al día.
    - **Pruebas:** 14 de ejemplo, 6 del mantenimiento y las 3 propiedades de CA4.1 con 1 000 casos cada una, con los generadores de `core`. Fallan las tres con un servidor en el que gana lo último que llega. Comprobado también en `workerd` local, con la purga de un lunes lanzada por la API local de `wrangler dev`.
36. **Cliente de la sincronización tal como se ha construido (07-11-2026, en la rama `m4-sincronizacion`; cambia §5.3, §7.2, §7.4, §7.7, §9.6 y §11.4; CA4.2 y CA4.3):** lo que el plan no decía. El detalle está en el ADR-011, «Cliente».
    - **Fachada en el *chunk* inicial y motor diferido** (`apps/web/src/sync/`). Quien no sincroniza no hace ninguna petición a `/api` ni descarga Zod. `"sideEffects"` en `packages/core` mantiene el inicial en un solo *chunk*: 136,9 KB brotli.
    - **Disparadores** (amplían RF-26): arranque, foco, `online`, volver a la vista, ocultarse con `outbox` y 2 s tras escribir. Hay Web Lock `gameagenda-sync` y espera exponencial de 5 s a 5 min. El aviso «Sincronización fallida» sale tras 3 fallos.
    - **Arreglos tras una revisión independiente con verificación adversarial**, sobre la primera versión (`0d8b9ba`):
      - El *reset* no deja entradas a medias: las páginas solo bajan, se acumulan y se aplican juntas al final. Las páginas que avanzan no cuentan para el tope de 100 peticiones.
      - **La app ya no purga por su cuenta.** La purga de D1 fuerza un *reset* en todos los dispositivos (`purged_seq = seq + 1`). Antes, una escritura vieja subida tras una purga dejaba réplicas distintas a la vista.
      - D1 vuelto atrás: el servidor no escribe un lote con el cursor por delante de su `seq`. Hay además una **época** por agenda (migración `0002_epoca.sql`); el *runbook* del restore la cambia.
      - Sin `meta.syncState`, el motor no escribe nada (ronda `aborted`), y `updateRecord()` no resucita estados. Así no quedan carreras al desemparejar o borrar con una ronda en vuelo.
      - «Borrar todos mis datos» espera el Web Lock. Con un 401 no da por borrada la agenda del servidor: lo dice y no borra nada.
      - La `outbox` se lee y se compacta una vez por ronda; con 1 000 juegos se pasa de 1 246 ms a 33 ms.
      - `join()` no sube el contenido de lápidas de más de 90 días.
      - `referrerPolicy: 'no-referrer'` en las peticiones a la micro-API.
      - El reloj se guarda al escribir.
37. **Ajustes › Sincronización (07-11-2026, en la rama `m4-sincronizacion`; cambia §6, §9.1, §9.5–§9.9, §11.2 y §11.4):** lo que el plan no decía. El detalle está en el ADR-011.
    - Sección `sincronizacion`, entre Privacidad y Rendimiento, con cuatro vistas: sin sincronizar, código de recuperación una vez, emparejada y desemparejada. El aviso de las dos cookies y el hueco de los textos legales van en las vistas que las crean.
    - El QR lleva `<origen>/emparejar#código` y usa **`uqr` 0.1.3** (MIT, sin dependencias) en su propio *chunk*. `/emparejar` quita el código de la URL antes de pintar, y canjear exige pulsar.
    - La cuenta atrás va con un plazo local y el foco sigue a cada cambio de vista, también al 401. Hay huecos reservados (§9.5, regla 3).
38. **E2E de sincronización contra la micro-API real (07-11-2026; cambia §12.1 y §12.3):** `vite preview --mode e2e` sirve `createApp()` con la D1 de `node:sqlite`. Cada prueba tiene su «mundo», elegido con la *cookie* `ga-e2e-api`, y hay rutas de apoyo en `/__e2e/*`.
    - El WebKit de Playwright guarda las cookies `__Host-` por HTTP, pero no las envía. Por eso hay un espejo HTTPS en el puerto + 10 000, con un certificado de `node:crypto`. Chromium va por HTTP: no registra el Service Worker con un certificado autofirmado.
    - Los E2E de CA4.2 y CA4.3 (`e2e/sync.spec.ts`) usan dos contextos y los disparadores naturales.
39. **Buzón del Atajo de iOS (08-11-2026, en la rama `m4-sincronizacion`; cambia §5.2, §7.7, §9.2 y §11.4; RF-08; CA4.5):** lo que el plan no decía. El detalle está en el ADR-011, «Buzón del Atajo de iOS».
    - **El *token*** es un `device` de tipo `inbox` (256 bits, como la credencial de la app; D1 guarda su SHA-256), que se crea con la cookie desde Ajustes, se ve una vez y se revoca en «Dispositivos». Puede haber varios. No vale como cookie de la app.
    - **`POST /api/v1/inbox`** lleva el *token* en `Authorization: Bearer …` y no mira `Origin` ni la cookie. Acepta un texto con un enlace de Steam (`findSteamLink`) y guarda solo el enlace canónico de la tienda (`canonicalStoreUrl`). Un juego que ya espera no se repite. Hay un límite por *token* (`RL_INBOX`, 30 por minuto) y un tope de 200 pendientes por agenda (409 `inbox_full`). Las respuestas llevan un `message` en español, que es lo que enseña el Atajo.
    - **En `sync`:** la respuesta trae `inbox` (50 como mucho) solo en la última página, y la petición siguiente lo confirma con `inboxAck`. La app los apunta con todo bajado, como un enlace pegado, en Quiero jugar y sin tocar lo que ya está en la lista. Lo hace con la agenda de la pestaña (`links/inbox-capture.ts`, fuera de la transacción) y solo confirma lo que después está vivo en IndexedDB.
    - **Los pasos del Atajo** van en Ajustes, junto al *token*. Están sin probar en un iPhone: falta comprobar que el Atajo no envía `Origin` y que manda bien la cabecera y el JSON.
40. **`GET /api/v1/resolve/<appid>` (08-11-2026, en la rama `m4-sincronizacion`; cambia §5.2, §7.3 y §11.4; CA4.5):** el nombre de un juego que no está en el catálogo local.
    - El servidor pregunta a `GetItems` sin clave, sin `data_request`, en español y para España. Si está bloqueado en España, pregunta para EE. UU. Guarda en `resolve_cache` el nombre (30 días) o «no lo conoce» (1 día). Si Steam falla, vale la caché aunque sea vieja; sin caché, 502 `steam_unavailable`. Hay límite por IP (`RL_RESOLVE`, 30 por minuto).
    - **«Steam no lo conoce» es un 200 con `name: null`, no un 404.** Con un 404, el navegador anotaría un error en la consola por cada juego que aún no existe, y los E2E lo cuentan.
    - **La app lo pide sin cookies** (`credentials: 'omit'`) ni `Referer`, desde `catalog-refresh.ts`. Solo para lo que no está en el catálogo entero (`scan` o `full`; en `boot` puede estar en el núcleo), una vez por sesión y juego (desde la §10.43, una vez cada 7 días, también entre sesiones). Sin red, o con 429, 5xx o 503, espera y lo vuelve a intentar. Los juegos apuntados después de cargar el catálogo se buscan 50 ms después de llegar: así el nombre llega en ≤1,5 s (CA4.5, comprobado en E2E).
    - **Solo lo usa quien sincroniza** (decisión del usuario, 08-11-2026; la primera versión lo usaba todo el mundo). La app solo pregunta con la sincronización emparejada o restaurándose (`canResolve` en `catalog-refresh.ts`), y al activarla pregunta lo que esperaba. Así sigue valiendo que quien no sincroniza no hace ninguna petición a `/api`, y lo comprueba su E2E con un juego provisional. La ruta sigue sin credencial (§5.2) y con su límite por IP. Sin sincronizar, el provisional espera al catálogo.
41. **Textos legales (08-11-2026, en la rama `m4-sincronizacion`; cambia §9.1, §11.1 y §11.2; CA4.7):**
    - **La política de privacidad completa** (`/privacidad`, art. 13 RGPD) y **el aviso legal y las condiciones de uso** (`/aviso-legal`, art. 10 LSSI) son datos en `apps/web/src/legal/texts.ts`, que la pantalla pinta como texto (§11.3). La primera capa (art. 11 LOPDGDD) va junto a «Activar sincronización», «Emparejar» y el código de recuperación, con el enlace a la política. Ajustes › Privacidad enlaza la política, en «Datos de Steam que guardamos», y Acerca de, los dos textos.
    - **Bases:** sincronización, buzón y `resolve`, art. 6.1.b. Portadas y seguridad, art. 6.1.f.
    - **Transferencias:** Cloudflare y Valve declaran estar adheridos al Marco de Privacidad de Datos UE-EE. UU., y el DPA de Cloudflare incluye además las cláusulas tipo. Comprobado en sus páginas el 08-11-2026.
    - **Plazos:** los de la §11.2, más el buzón (hasta que se apunta), la caché de `resolve` (30 días) y los contadores. Una prueba ata los plazos del texto a las constantes del código.
    - **El responsable** va en `legal/controller.ts`, sin rellenar hasta que lo dé el usuario: los textos dicen «pendiente». `scripts/legal-guard.test.ts` falla si `SYNC_ENABLED` vale `"1"` en `wrangler.jsonc` sin nombre y correo.
    - **El registro de actividades** (art. 30 RGPD) va en `docs/legal/registro-actividades.md`, interno.
    - **La pantalla va en el *chunk* de Ajustes.** Con uno propio, Rolldown partía el inicial en tres ficheros: 140,7 KB brotli frente a 138,9 en un solo fichero.
42. **CA4.6, estimado en local (08-11-2026):** `node scripts/api-cpu.ts` mide la CPU de cada ruta con `createApp()` y le resta el tiempo de D1 (`docs/medidas/ca4.6-20261108.md`). El peor p99 en caliente es 2,38 ms (`sync` con 200 operaciones). La primera petición de un *isolate* nuevo cuesta ≈6 ms. La medida que cierra CA4.6 es la de producción, en el panel de Workers (parte 5).
43. **Revisión de los arreglos de la parte 3 y de la parte 4 (08-11-2026; `code-review` sobre `4b46155^..HEAD`):** 10 hallazgos, verificados uno a uno. Se arreglan 9, cada uno con su prueba:
    - **El buzón guardaba el enlace canónico sin tope.** `encodeURIComponent` multiplica un *slug* raro, y un enlace de más de 2 048 caracteres rompía el esquema de la respuesta de `sync` para toda la agenda, para siempre. Ahora se guarda sin *slug* si pasa de `INBOX_URL_MAX` (512).
    - **Lo del buzón podía pisar un juego que llegaba en la misma página.** La agenda de la pestaña relee lo que escribe el motor un poco después. Ahora el motor confirma sin apuntar lo que ya está vivo en IndexedDB, y `inbox-capture` espera antes a `agenda.whenIdle()`.
    - **Todas las respuestas del buzón llevan `message`,** también las de error que salen antes de la ruta: el interruptor, el tipo de contenido, el tamaño y el cuerpo. Los mensajes están en `INBOX_MESSAGES` de `http.ts`.
    - **La respuesta de Steam se lee con tope de verdad** (`readCapped`, ahora común), no entera antes de mirar su tamaño.
    - **`resolve` en la app:**
      - un juego que falla él solo (`later` de alcance `one`, con 502 `steam_unavailable`) ya no para a los demás; sin red, con 429 o con 503, todo espera (`all`);
      - lo que llega mientras se pregunta también se pregunta;
      - cada juego, como mucho una vez cada 7 días, también entre sesiones (`meta.resolveAsked`, nueva clave de la §7.2, que es de este dispositivo y se borra con «Borrar todos mis datos»);
      - la agenda solo se vuelve a recorrer cuando crece, no con cada cambio de estado o de nota.
    - **`LegalScreen` usa el `LegalParts` de Ajustes,** ahora que va en su mismo *chunk*, y deja de tener su copia.
    - **Se descarta uno:** acotar el `receive()` de la agenda (`importContext`, `refreshFromCatalog`) a ahora + desfase + 5 min. `core` rechaza con `RangeError` cualquier acción con una HLC que no sea posterior a la de su entrada, así que acotarlo rompería las acciones sobre esas entradas. Lo que va más de 5 min por delante lo vuelve a sellar el motor en la siguiente ronda.
    - **De paso:** la decisión del usuario sobre `resolve` (§10.40), y las pruebas inestables. `data.spec.ts:50` falla en WebKit unas 4 de cada 12 veces, también sin M4; ahora espera al catálogo antes de cada navegación (`catalogSettled`) y pasa 12 de 12. `boot.spec.ts:273` no se reproduce en 40 ejecuciones, ni con 8 *workers*; se deja como está.
