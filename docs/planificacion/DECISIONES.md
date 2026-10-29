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

**Consecuencias:** buscar y apuntar funcionan **sin red** tras la primera visita; un único cliente web para móvil y escritorio; Steam nunca está en el camino crítico; coste 0 €/mes; no hay atajo global del sistema en Windows hasta el envoltorio Tauri opcional (Fase 2); iOS no tiene *Web Share Target* (se cubre con «Pegar enlace» y, en M4, un Atajo de iOS que envía a un buzón).

---

## 3. Decisiones

**D-01 Plataforma.** PWA instalable (Android, iOS, escritorio) con un solo código. Sin servidor propio hasta M4, salvo *hosting* estático. Tauri 2 queda como envoltorio **opcional** de la misma build en Fase 2 (atajo global `Ctrl+Mayús+Espacio`), nunca como segundo motor.

**D-02 Framework.** **React 19.3.1 + Vite 8.3.5 como SPA**, TypeScript 7.0.2. **Sin SvelteKit** (motivos: `svelte-check` exige TypeScript 6 porque TS 7.0 no tiene API hasta la 7.1; Kit 3 deja obsoletos muchos tutoriales; cinco pantallas no necesitan meta-framework). **Sin librería de enrutado**: un *router* propio mínimo sobre la History API. Rutas: `/` (Mi lista), `/catalogo`, `/juego/<id>` (por ejemplo `/juego/steam:730`), `/ajustes`, `/apuntar` (abre la paleta; atajo del *manifest*) y `/share` (destino de «Compartir»). Estilos: CSS nativo con variables (*tokens*) y CSS Modules de Vite; sin Tailwind. Estado: `useLiveQuery` de Dexie + estado local de React; sin Redux ni similares. El presupuesto de JS inicial está en la §5 de este documento (≤150 KB brotli, medido).

**D-03 Datos del usuario en el cliente.** **Dexie 4.4.7** (IndexedDB) + `dexie-react-hooks` 4.4.0. **No** se usa SQLite WASM en el cliente. El modelo relacional (SQL) es la referencia lógica y el esquema de **D1** (SQLite) del servidor en M4. Tablas Dexie: `entries`, `outbox`, `settings`, `meta` (versión de catálogo, índice persistido, etc.). `navigator.storage.persist()` en la primera escritura; exportación/importación JSON (con marcas HLC) y CSV desde M1.

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
| **M3** Rápida y ágil | Cumplir los presupuestos en dispositivos reales y multiplicar las vías de captura | Índice persistido, núcleo de arranque, atajos de teclado completos, gestos móviles, destino de «Compartir» y accesos directos, pegar en cualquier pantalla, panel de rendimiento, accesibilidad WCAG 2.2 AA, medición en el Android de referencia y en iPhone | 3–4 |
| **M4** Sincronización | Una sola agenda en el móvil y el PC, y copia fuera del dispositivo | Micro-API Hono + D1 UE, emparejamiento, `sync`, buzón para el Atajo de iOS, resolución de `appid` desconocidos, código de recuperación, política de privacidad completa | 4–6 |
| **Fase 2** | Después del prototipo | Steam OpenID + importación; IGDB y otras plataformas; envoltorio Tauri con atajo global; DLC notables; marcas propias; avisos de lanzamiento; inglés | — |

Total del prototipo (M0–M4): **22–30 días ideales** de una persona (día ideal ≈6 h; ajustado el 28-10-2026 por el alcance añadido en la §10).

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
| Presupuestos | tecla → resultados **≤50 ms p95** en el Android de referencia (CPU ×4 en CI) y ≤16 ms en escritorio; toque → respuesta visible **≤100 ms**; **INP p75 ≤200 ms**; **LCP ≤2,5 s**; reinicio con caché ≤2 s (Mi lista visible ≤1 s); apuntar un juego **p50 ≤3 s** (desde abrir la paleta hasta ver la confirmación); búsqueda lista ≤1,5 s tras la primera carga (M3) |
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
| Dexie / `dexie-react-hooks` | 4.4.7 / 4.4.0 |
| `@tanstack/react-virtual` | 3.14.24 |
| `@leeoniya/ufuzzy` | 1.0.19 |
| Zod | 4.6.7 |
| `uuid` (v7) | 14.0.3 |
| Hono (M4) / `wrangler` / `@cloudflare/workers-types` | 4.13.14 / 4.155.0 / 5.20261028.1 |
| `steam-signin` (Fase 2) | 1.0.5 |
| Biome | 2.6.4 |
| Vitest / fast-check | 5.0.5 / 4.10.2 |
| Playwright (`@playwright/test`) | 1.64.1 |
| Tauri CLI (Fase 2) | 2.12.4 |

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
4. **Pipeline (D-07):** `data_request` de Query = `include_release`, `include_assets`, `include_reviews`, `include_platforms` + `include_best_purchase_option:false`; **sin `include_basic_info`** (pesa ≈2,6× y D-08 no usa sus campos; la ficha no muestra descripción ni desarrollador). Verificar en M0 que `is_free` sigue llegando. Presupuesto: ≈4 + ≈208 + ≈5–20 ≈ **220 llamadas/día (≤230)**, ≈50 MB gzip al día, ≈11–13 min. Consulta de humo «counter strike» → 730 **entre los 3 primeros** (el exacto «Counter-Strike», appid 10, va antes). El catálogo es la unión de GetAppList y Query.
5. **Orden del núcleo (D-08):** no retirados por reseñas descendentes; a igualdad, **`appid` descendente** (lo más reciente primero); los retirados al final. Tamaños reales del núcleo D-08 (196 665 juegos): 7,00 MB · 3,05 MB gzip -9 · 2,59 MB brotli 5 · 2,25 MB brotli 11; núcleo de arranque (20 000): 269 KB brotli 11 / 345 KB gzip; `aliases` (3 563 pares, formato `alias compacto TAB appid`): 16 KB brotli. El *manifest* lista `core`, `recent`, `aliases` y un índice de *shards* (`details/index.<hash>.json`); cada *shard* se verifica por el *hash* de su nombre.
6. **«A continuación» (D-05):** agrupa las entradas con la marca Próximo cuyo estado es **Quiero jugar o En pausa**. En los demás estados la marca se conserva sin efecto.
7. **Relojes (D-06/D-13):** la micro-API rechaza operaciones con HLC **más de 5 min por delante** de su reloj; cada respuesta de `sync` incluye la hora del servidor y el cliente corrige con ese desfase la parte física de su HLC y vuelve a sellar las operaciones rechazadas. El nodo de la HLC es aleatorio por sesión o pestaña.
8. **Medición de rendimiento (D-17):** el estrangulamiento de CPU por CDP **no afecta a los Workers dedicados** (medido). La prueba de búsqueda con ×4 ejecuta el núcleo de búsqueda en el hilo principal de una página de prueba (a verificar en M0 si se puede estrangular el Worker con `Target.setAutoAttach`); el Worker real se valida en el Android de referencia. INP, toque → respuesta y tareas largas se miden en la app real con ×4.
9. **Puertas de calidad de búsqueda en CI:** el CI no llama a la red, pero sí ejecuta el dorado, los 2 000 exactos y los prefijos sobre una **copia congelada y comprimida del núcleo real** en `fixtures/` (≈3 MB gzip, se renueva a mano como mucho una vez por hito). `catalog.yml` ejecuta las mismas puertas sobre el núcleo recién construido antes de publicar.
10. **Hitos:** M1 incluye una **ficha básica** (datos del núcleo y todos los campos de la entrada); M2 trae la **ficha completa** (portada y datos de los *shards*) y la vista **Próximos** de Mi lista (`/?vista=proximos`). M3 y M4 pueden intercambiarse si se usa la app en dos dispositivos desde el principio o en un iPhone sin instalar; el orden por defecto es M3 → M4.
11. **Otros detalles aceptados:** `workbox-build` 7.4.1 como dependencia de desarrollo; Vitest 5.0.5 admite Vite ^6.4, ^7 y ^8; `not_found_handling: single-page-application` en `ga-web`; ADR en `docs/adr/NNN-titulo.md`; migración a Node 26 al cerrar M4; carpeta `scripts/` en la raíz; esquemas Zod en `packages/core/src/schemas/`; la búsqueda del valor de la clave en `ci.yml` compara *hashes* SHA-256 (variable `STEAM_KEY_SHA256`); `deploy-web.yml` se lanza con `workflow_run` tras el CI en verde; *build* `e2e` con un catálogo de prueba firmado con una clave de desarrollo; la importación CSV solo crea entradas nuevas; los números de la interfaz usan espacio fino irrompible como separador de millares a partir de 5 cifras.
12. **Firma del *manifest*:** la clave privada ed25519 vive **solo** en un secreto de GitHub. Si hay que ejecutar el pipeline desde el PC (429 en los *runners* compartidos o falta de minutos), el PC solo descarga y construye, y sube el resultado como *asset* de una *Release* de preparación (`catalog-staging`); después se lanza `catalog.yml` con `workflow_dispatch` (`source=staging`), que pasa las puertas, firma y publica. El PC nunca firma ni despliega `ga-catalog`.
13. **Esfuerzo:** M0 = 2–3 días y M1 = 9–12 días; total M0–M4 = **22–30 días ideales** (ver §4). Semanas acumuladas (día ideal ≈6 h): a 10 h/semana, ×0,6; a 15 h/semana, ×0,4; a 30 h/semana, ×0,2 (M4: 13,2–18 / 8,8–12 / 4,4–6 semanas).
14. **Prototipo de búsqueda medido:** el código, el dorado, los vectores y los resultados del 28-10-2026 están en `docs/planificacion/prototipo-busqueda/`; el núcleo real congelado y sus alias, en `fixtures/catalog-frozen/core.20261028.1.tsv.gz` y `aliases.20261028.1.tsv`.
15. **Accesibilidad:** axe sin violaciones graves ni críticas en cada hito; pasada con NVDA al cerrar M1; con NVDA, Narrador, TalkBack y VoiceOver al cerrar M3.
16. **App de escritorio en M3 (29-10-2026, decisión del usuario; sustituye a lo que D-01 y la §4 dejaban en Fase 2):** el envoltorio Tauri 2 con `Ctrl+Mayús+Espacio` entra en M3 como una vía más de captura (ADR-010; RF-30; CA3.7 y CA3.8). Sigue siendo la misma web: carga el origen de `ga-web`, no tiene lógica propia y la página no recibe órdenes de Tauri. M3 pasa de 3–4 a **4–6 días** y el total M0–M4, a **23–32 días ideales** (a 15 h/semana, 9,2–12,8 semanas). ADR renumerados por orden de escritura: 010 app de escritorio (M3), 011 sincronización (M4) y 012 cuenta de Steam (Fase 2). Hasta M4, la app de escritorio tiene su propia agenda (WebView2 no comparte datos con el navegador; R-18). El CI no compila Rust: el instalador NSIS sin firma se genera en el PC. Versiones comprobadas en crates.io el 29-10-2026: `tauri` 2.12.5, `tauri-build` 2.7.4, `tauri-plugin-global-shortcut` 2.4.1, `tauri-plugin-single-instance` 2.5.5 y `tauri-plugin-autostart` 2.7.0; `@tauri-apps/cli` 2.12.4. Si casi todo se apunta en el PC (PA-01), la app de escritorio pasa a justo después de M1.
