# Registro de cambios

Cambios de GameAgenda por versión. Cada hito cierra una versión SemVer 0.x (§12.6 de `prototipe.md`). Las fechas van en formato dd-mm-aaaa.

## [Sin publicar]

Será la **0.2.0 · M2 Catálogo vivo**: el catálogo se actualiza solo cada día, firmado, y la app muestra portadas, la ficha completa y los próximos lanzamientos. La app ya es la versión 0.2.0 desde el 31-10-2026, porque el catálogo firmado la pide. La etiqueta `v0.2.0` llega con CA2.1: tres ejecuciones programadas seguidas en verde, desde el 01-11-2026. Al etiquetar, esta cabecera pasa a `## [0.2.0] · M2 Catálogo vivo · <fecha>`.

### Añadido

#### Para el usuario

- **Catálogo al día, sin hacer nada:**
  - cada mañana se publica uno nuevo y la app lo adopta sola;
  - los juegos nuevos o renombrados en los últimos 14 días llegan con los recientes, aunque el núcleo local sea de hace unos días;
  - entran los ≈205 juegos bloqueados en España que faltaban en M1.

  En Ajustes › Datos se ve la edad del catálogo, y «Actualizar catálogo» baja el completo.
- **Portadas** en Mi lista, en la paleta (tras 150 ms sin teclear) y en la ficha. Sale la `library_capsule`; si falla, el `header`, y si falla también, una portada generada con las iniciales. Ocupan un hueco fijo de 2:3, para que no salte nada al cargar.
- **Aviso de primera capa** antes de la primera portada: las portadas vienen de servidores de Valve en EE. UU., que reciben tu IP. Tiene «Más información», «Entendido» y «Desactivar portadas». Va fijo abajo, debajo del aviso de Deshacer, y no tapa la paleta.
- **Ajustes › Privacidad:** «Cargar portadas» (activado por defecto) y «Datos de Steam que guardamos».
- **Ficha completa:** portada, lanzamiento o «Por confirmar» con cuenta atrás, reseñas, plataformas y Steam Deck. Sin detalles, la ficha básica de M1.
- **Vista Próximos** (`/?vista=proximos`), por lanzamiento: Ya disponibles (14 días), Esta semana, por meses, Más adelante y Por confirmar. Mi lista se puede ordenar también por lanzamiento.
- **Si el navegador no verifica firmas Ed25519**, sigue con el catálogo guardado y pide otro navegador. Sin catálogo guardado, avisa sin «Reintentar» y se puede apuntar a mano (RNF-12).

#### Ingeniería

- **Contrato de M2 en `core`:**
  - JSON canónico (RFC 8785) y los bytes que se firman;
  - claves públicas con `kid` y uso: `prod-1` y `dev-1`, que ningún *build* de producción acepta;
  - *shards* de detalles por FNV-1a mod 1024, con sus esquemas;
  - `applyRecent`, en menos de 200 ms con el núcleo real.
- **Pipeline diario** (ADR-007):
  - `GetAppList` con clave, que es la única petición que la lleva; Query y `GetItems`, sin ella;
  - recientes de 14 días, con `addedOn` y `renamedOn` en cada fila del estado;
  - detalles en 1 024 *shards* con su índice, y *kill switches* `covers` y `details`;
  - firma ed25519 solo en GitHub Actions;
  - si falla Query, se publican los nombres y crece `enrichmentAgeDays`;
  - puertas nuevas de integridad y de tamaño por despliegue, y códigos de salida 0–3.
- **`catalog.yml`**, cada día a las 04:17 UTC, con `CATALOG_SCHEDULE` = `on`:
  - canario de Steam y estado en la *Release* `catalog-state` (7 copias);
  - versión anterior conservada en cada despliegue (CA2.4);
  - prueba de humo de cada fichero publicado;
  - *issue* `catalogo` si falla y *dead-man switch* con healthchecks.io.

  Además, `npm run catalog:stage` sube desde el PC las páginas crudas, y el CI las vuelve a derivar sin red. `npm run catalog:publish` solo funciona en Actions.
- **Worker de búsqueda:**
  - verifica la firma con WebCrypto (en producción, solo claves `prod`) y aplica `recent`;
  - regla de los 7 días (CA2.4): con un núcleo local de 7 días o menos, solo baja el *manifest*, los recientes y lo que cambió;
  - ante un 404, relee el *manifest* una vez y reintenta de 1 min a 1 h;
  - una versión que solo cambia un *kill switch* se adopta sin reconstruir el índice;
  - el *manifest* se comprueba como mucho cada 12 h (`meta.catalog`, en IndexedDB, sin Dexie), y siempre al volver la red y con «Actualizar catálogo».
- **Cliente de detalles**, en un *chunk* diferido: comprueba el índice y cada *shard* (*hash* y Zod), los guarda en Cache Storage `gacat-details` y cede el hilo entre *shards*.
- **`ga-catalog` en su propia cuenta de Cloudflare** (https://ga-catalog.gameagenda-cat.workers.dev), con su *token*: el del pipeline no puede desplegar `ga-web` (§11.3, ADR-003).
- **Primera publicación** (31-10-2026, ejecución 41201112633, a mano):
  - versión `20261031.1`: 197 786 juegos, 3 562 alias y 197 607 con detalles;
  - 218 llamadas a Steam, 4 con clave, como mucho 0,334 por segundo;
  - 12 min 7 s en total y todas las puertas en verde.
- **Pruebas:**
  - 698 unitarias y 134 E2E en la lista local (Chromium y WebKit con un iPhone 15). En el CI, solo Chromium;
  - el mini-catálogo de `fixtures/` va firmado con `dev-1` y trae recientes y *shards* sintéticos;
  - `npm run perf` necesita antes `npm run catalog:frozen`, porque el catálogo tiene que ir firmado;
  - `npm run smoke:web`, prueba de humo de `ga-web` en producción con un Chromium real: primera y segunda visita, sin red y errores. Con `--profile`, mide la actualización de un cliente con el catálogo de ayer (CA2.4).
- **ADR:**
  - 007 (pipeline y publicación) y 008 (portadas), propuestos;
  - la parte de M2 del Worker en el ADR-005 y la cuenta nueva en el ADR-003.

#### Adelantado de M3: app de escritorio para Windows

Entra en `main` antes de la etiqueta, así que va en esta versión. Sus criterios (CA3.7 y CA3.8) se cierran con M3. Ver ADR-010.
- **`apps/desktop`**: ventana de Tauri 2 que carga `ga-web`.
  - **`Ctrl+Mayús+Espacio`** desde cualquier aplicación la pone delante con la paleta abierta, sin recargar la página; pulsado otra vez, la oculta.
  - **Bandeja:** «Abrir», el estado del atajo (con «Reintentar» si otra aplicación lo tiene), «Iniciar con Windows» y «Salir». Una sola instancia.
  - **Instalador** NSIS por usuario, sin derechos de administrador y sin firma: `npm run desktop:build`.
- **La página no puede invocar nada de Tauri:** sin *capabilities* ni órdenes propias, y `ga-web` como origen remoto. Lo vigila `apps/desktop/desktop.test.ts` en `npm run check`, que no necesita Rust.
- **Comprobado por el agente con la app instalada, el 31-10-2026:**
  - el atajo pone la paleta delante con el foco en 20 ms (p50), y de pulsarlo a la confirmación pasan 1,23 s (p50), con el tecleo simulado;
  - abre y apunta sin red;
  - la página no logró ninguna de 11 llamadas a Tauri.

#### Estado de los criterios de aceptación

| CA | Estado | Evidencia |
|---|---|---|
| CA2.1 Pipeline diario | Pendiente | La primera publicación, lanzada a mano, salió en verde: 218 llamadas, 4 con clave, 0,334/s y 12 min 7 s. Faltan 3 ejecuciones programadas seguidas, desde el 01-11-2026 |
| CA2.2 Puertas | Cumplido con *fixtures*; falta un fallo real | `publish.test.ts` fuerza cada puerta y el «solo falla el enriquecimiento». El *issue* y el aviso del trabajo `report` no se han visto en un fallo real |
| CA2.3 Firma y *kill switch* | Cumplido en Chromium | `catalog-update.spec` (*manifest* manipulado), `covers.spec` (*kill switch* `covers`) y `host.test`. El WebKit de Playwright para Windows no trae Ed25519 |
| CA2.4 Actualización ligera | Cumplido en pruebas | `catalog-update.spec` y `host.test` (solo el *manifest* y los recientes); `assemble-catalog` y la prueba de humo (versión anterior). Falta medir lo transferido en producción tras la segunda publicación |
| CA2.5 *Dead-man switch* | Pendiente | El *check* de healthchecks.io existe y respondió al `/start`. Falta probarlo deteniendo el cron |
| CA2.6 Portadas | Parcial | `covers.spec`: ninguna URL fuera de `asset_url_format`, y la cadena `library_capsule` → `header` → generada. Falta la agenda de 300 juegos reales (ADR-008) |
| CA2.7 Privacidad y clave | Cumplido | `covers.spec`: aviso antes de la primera portada, 0 peticiones con «Cargar portadas» apagado y 0 violaciones de CSP. La clave se busca en el *build*, `pipeline/out`, `pipeline/dist` y los artefactos |
| CA2.8 Ficha y Próximos | Cumplido | `details.spec`: ficha completa, sin detalles y Próximos, que solo pide los *shards* que hacen falta |

### Cambiado

- **La app pasa a la versión 0.2.0 antes de la etiqueta:** un *manifest* firmado pide `minClientVersion` 0.2.0.
- **`ga-catalog` cambia de cuenta y de origen:** del subdominio `gameagenda.workers.dev` a `gameagenda-cat.workers.dev`. `VITE_CATALOG_URL` y el `connect-src` de `ga-web` lo siguen.
- **`catalog:stage`** sube las páginas crudas de Steam y no `pipeline/out/` ni el estado, como decía el plan. Así, las puertas y la firma corren siempre en el CI (ADR-007).
- **`deploy-catalog.yml` se retira:** desplegaría el mini-catálogo sin firma encima del real.
- **El plan recoge lo construido en M2** (`DECISIONES.md` §10.19 y §10.20). Cambian:
  - §4.5–4.7: el estado y las cifras medidas;
  - §5.4: qué fallos hacen releer el *manifest*;
  - §7.6: tamaños medidos, `gacat-local.json` y lo que no entra en los detalles;
  - §8.7: el `status` con `catalog`;
  - §9.1, §9.2 y §9.5: orden por lanzamiento, reglas de Próximos y la regla 7, sin `:has()` en la raíz;
  - §11.2 y §11.3: el aviso de portadas, la cuenta propia de `ga-catalog` y los E2E sin Ed25519;
  - §12.3–12.5 y §13.3: los ganchos E2E y `catalog:stage`;
  - CA2.4: los ≤200 KB son comprimidos.

### Corregido

- **`ga-web` no volvía a abrir tras la primera visita** (desde el despliegue del 30-10-2026). Workers Static Assets redirige `/index.html` a `/`, y el Service Worker guardaba esa respuesta redirigida, que Chrome no acepta para una navegación: cada visita siguiente fallaba con `net::ERR_FAILED`, también sin red. Ahora guarda una copia sin la redirección, y quien tenía la versión rota se recupera solo en la siguiente visita (comprobado en producción). `vite preview` no redirige, así que hay un E2E nuevo que reproduce el 307.
- **Clave de Steam:** el cliente HTTP la mandaba a todas las peticiones, unas 220 con clave al día frente a las ≤10 del CA2.1. Ahora solo la lleva `GetAppList`.
- **`--from-raw`** vuelve a derivar con clave si las páginas crudas traen `GetAppList`, aunque no haya clave en el entorno.
- **Sin conexión**, el cliente de detalles no hace peticiones que fallarían igual.
- **Producción sin catálogo, el 31-10-2026, unos 20 min:** el cliente nuevo era todavía la 0.1.0 y rechazaba el catálogo firmado (`client-too-old`), así que la búsqueda solo ofrecía «Apuntar a mano». Lo arregla el paso a 0.2.0.
- **Tareas largas al teclear con CPU ×4:** dos reglas `.app:has(…)` del aviso de portadas obligaban a recorrer Mi lista entera en cada cambio del DOM. Con 500 entradas daban 40 tareas largas; ahora, 0, y el INP baja de 88 a 40 ms.
- **`host.test.ts`:** una prueba fallaba solo en el *runner* de GitHub por un orden de carga no fijado.

### Seguridad

- ***Manifest* firmado con ed25519:**
  - en producción, el cliente solo confía en las claves `prod`;
  - la privada de `prod-1` solo existe en un secreto de GitHub;
  - el PC nunca firma con ella ni despliega, y `catalog:publish` se niega fuera de Actions.
- **El *token* del pipeline es de otra cuenta de Cloudflare:** no puede desplegar `ga-web`.
- **Portadas:**
  - solo se piden desde `asset_url_format`, y `library_capsule` y `header` solo se aceptan con forma de fichero de imagen (uno traía `manuals/…pdf#/../../../`);
  - van con `referrerpolicy="no-referrer"` y `crossorigin="anonymous"`;
  - la CSP solo admite imágenes propias y de `shared.akamai.steamstatic.com`.
- **La clave de Steam** se busca también en `pipeline/out`, en `pipeline/dist`, en los artefactos (que son públicos) y en las páginas crudas que sube `catalog:stage`.

### Pendiente

- **CA2.1:** tres ejecuciones programadas seguidas en verde. Después, ADR-007 y ADR-008 pasan a «aceptada» y se etiqueta `v0.2.0`.
- **CA2.5:** probar el *dead-man switch* deteniendo el cron.
- **CA2.6:** la agenda de prueba con 300 juegos reales.
- **CA2.2 en un fallo real:** el *issue* `catalogo`, el `/fail` de healthchecks.io y `gh run download` desde el trabajo `report`.
- **Safari:** Ed25519 y el resto de la firma, en el dispositivo (§11.3).
- **R-04:** comprobar que un flujo sin `schedule` no se desactiva y que `…/enable` reactiva uno desactivado.
- **Medir:**
  - `recent` en régimen, a los 14 días;
  - lo que transfiere el núcleo completo (ADR-003);
  - el reinicio con caché hasta `scan`, que va justo: 1 893 ms frente a 2 000 con 4 000 recientes. Si se pasa, hay dos salidas: abaratar `applyRecent` (copias en bloque en vez de fila a fila) o esperar al índice persistido de M3.
- **De M1, en M3** ([issue #1](https://github.com/LucasPrezFdez/gameagenda/issues/1)): el Android de referencia y la pasada con NVDA.

### M0 · Esqueleto, cerrado después de M1 (30-10-2026)

Sin etiqueta propia: `v0.0.1` quedaría después de `v0.1.0`, así que M0 va dentro de la próxima versión (decisión del usuario). El detalle está en el [ADR-003](docs/adr/003-hosting-despliegue-y-ci.md).

#### Añadido

- **CI** (`.github/workflows/ci.yml`), con tres trabajos en paralelo:
  - `check`: Biome, `tsc`, Vitest, *build*, puerta de tamaño y búsqueda de la clave;
  - `e2e`: Chromium;
  - `perf`: solo informa.

  Las *actions* están fijadas por SHA, con permisos de solo lectura. La primera ejecución pasó en verde en 2 min 52 s.
- **Búsqueda de la clave de Steam en el *build*** (`scripts/scan-secrets.ts`): `x-webapi-key`, `STEAM_WEB_API_KEY` o la clave por su SHA-256 (`STEAM_KEY_SHA256`). Tiene pruebas con una clave falsa.
- **Despliegue en Cloudflare Workers Static Assets**, en el subdominio `gameagenda.workers.dev`:
  - `ga-web` (https://ga-web.gameagenda.workers.dev) lleva la CSP y las cabeceras de la §11.3 en `_headers`;
  - `ga-catalog` (https://ga-catalog.gameagenda.workers.dev) sirve el mini-catálogo, montado por `scripts/assemble-catalog.ts`. El *manifest* va en `no-cache`, los TSV como `text/plain` comprimidos con zstd, br o gzip, y el CORS solo admite a `ga-web`;
  - `deploy-web.yml` despliega `ga-web` tras cada `ci` en verde de `main`, y `deploy-catalog.yml` desplegaba `ga-catalog` a mano (en M2 lo sustituye `catalog.yml`). Los dos acaban con una prueba de humo. El primer despliegue automático, del 30-10-2026, tardó 33 s.
- **Comprobaciones de M0** (`docs/medidas/verificaciones-m0-20261030.md`): Ed25519 en WebCrypto, formato de la clave de Steam y campos de `Query` sin `include_basic_info`.

#### Corregido

- **Catálogo:** el Worker de búsqueda vuelve a pedir sin la caché HTTP (`cache: 'reload'`) un fichero con *hash* que falla. `ga-catalog` sirve también los 404 como `immutable`, y sin este reintento uno transitorio dejaría fuera esa versión del catálogo.

#### Pendiente

- Nada de M0. La variable `STEAM_KEY_SHA256` está puesta desde el 31-10-2026, así que el CI también busca la clave por su *hash*.

## [0.1.0] · M1 Apuntar · 30-10-2026

Primera versión: buscar en el catálogo completo de Steam y apuntar un juego en segundos, sin red tras la primera visita y con los datos en el dispositivo. De M0 solo están hechos los pasos 1–3: no hay `v0.0.1` ni despliegues.

### Añadido

#### Para el usuario

- **Paleta de captura** con `Ctrl+K`, con `/` (desactivable en Ajustes) y, en móvil, con la barra fija de abajo. Muestra hasta 8 resultados, «En tu lista», «¿Quizás buscabas…?» y una fila para apuntar a mano. `Intro` apunta en Quiero jugar, `Ctrl+Intro` apunta y deja la paleta abierta, `Alt+Intro` apunta con otro estado y `Mayús+Intro` abre la ficha. Tecleando sin pausa, `Intro` espera hasta 500 ms al resultado de la consulta completa.
- **Búsqueda local en todo el catálogo** de Steam (núcleo `20261029.1`, 197 031 juegos), en un Web Worker: exactos y alias, siglas, romanos ↔ arábigos, nombre en español, CJK, `appid:` explícito y nivel difuso diferido. Mientras se construye el índice, un escaneo lineal da los mismos resultados.
- **Mi lista:** vista «Pendientes» por secciones (Jugando ahora, A continuación, Quiero jugar…) y una vista por estado; filtros de compra y de texto y orden (prioridad, fecha de apuntado o nombre), en la URL.
- **Estados** (Quiero jugar, Jugando, En pausa, Completado y Abandonado) y **marcas** (Platinado, Comprado y Próximo) a dos toques, con fechas automáticas que no se sobrescriben. Platinado marca también Completado. Orden manual desde el menú de la fila.
- **Deshacer:** aviso de 8 s que se pausa con el foco o el puntero, `Ctrl+Z` con hasta 20 niveles y «Deshacer último cambio» en el menú.
- **Ficha básica** (`/juego/<id>`): datos del núcleo; edita estado, marcas, fechas, nota y «Juego en», con Deshacer.
- **Catálogo virtual** con contador, +18 oculto por defecto, filtros en la URL, `Inicio`, `Fin`, `RePág` y `AvPág`, y apuntar con `+` o `(+)`.
- **Juegos manuales** con «Vincular» cuando hay una única coincidencia exacta en el catálogo.
- **Enlaces de Steam pegados en la paleta**, en los seis formatos de la §9.2: apuntan `steam:<appid>`. Si el juego aún no está en el catálogo, queda provisional con el título del *slug* (o «Juego de Steam <appid>») y se completa cuando llega una versión del catálogo que lo trae.
- **Datos en el dispositivo:** IndexedDB con Dexie y `persist()`, y pestañas coherentes entre sí. En Ajustes › Datos:
  - exportar JSON (con lápidas y HLC) y CSV;
  - importar JSON (fusiona; reimportar no duplica) o CSV (solo altas), hasta 10 MB y con copia previa;
  - «Borrar todos mis datos» y exportar el registro de errores.
- **Avisos:** guardado fallido con «Exportar» y «Reintentar» (sin IndexedDB, la app sigue en memoria y lo dice); sin conexión; Safari de iOS sin instalar; y exportar tras 30 días sin copia, aplazable 7 días con «Ahora no» (RNF-08).
- **PWA** que abre sin red tras la primera visita, con un Service Worker propio, el *manifest* en español, un icono propio y el acceso directo «Apuntar juego».
- **Ajustes:** tema (el del sistema, claro u oscuro, sin parpadeo al abrir), +18 visible, `/` y «Acerca de», con la versión, el SHA y el aviso de marca de Valve.

#### Ingeniería

- **`packages/core`**, sin E/S y con un *subpath* por módulo:
  - búsqueda: `normalize`, `catalog-format` (núcleo TSV `#gacat-core v1`, alias y esquema del *manifest*, lectura por trozos con `step(deadline)`), `search` (niveles 0–4, puente de escaneo y construcción incremental `none` → `scan` → `full`), `search-quality` y `bench`;
  - agenda: `entries`, `sync` (HLC, `merge()` con LWW por campo y compactación de la `outbox`), `steam-link` y `schemas` (Zod 4, exportación e importación JSON y CSV).
- **Worker de búsqueda** con el protocolo de la §8.7. Construye en bloques de ≈6 ms que ceden el turno y guarda el catálogo en Cache Storage `gacat-<versión>`. Sin red, usa el último catálogo válido. Un *plugin* de Vite sirve `CATALOG_DIR` en `/catalog-dev/`.
- **Pipeline del catálogo sin clave** (`npm run catalog:build -- --keyless`, pasos 0–5 de la §4.5):
  - cliente HTTP con la política de la §4.7 y contratos Zod;
  - plan B para el nombre base;
  - páginas crudas para reanudar y para volver a derivar sin red (`--from-raw`);
  - informe de cobertura (`--compare`) y puertas de publicación;
  - pruebas sin red sobre respuestas grabadas en `fixtures/steam/`.

  `npm run catalog:frozen` genera el mini-catálogo de 298 juegos de `fixtures/catalog/`.
- **Pruebas:** 536 unitarias (Vitest, con propiedades de fast-check de 1 000 casos) y 108 E2E en Chromium y en WebKit con un iPhone 15 emulado (6 se saltan a propósito). Incluyen axe en cada pantalla, con los dos temas.
- **Calidad de búsqueda**, sobre la copia congelada (`fixtures/catalog-frozen/`, 196 665 juegos): dorado top-1 94,9 % y top-5 99,0 %; exactos 99,9 % en el top 5; prefijos 93,1 % en el top 10. El escaneo y el índice dan las mismas listas.
- **`npm run perf`**, un proyecto de Playwright con su propio puerto (`PERF_PORT`):
  - una página de prueba con el núcleo de búsqueda en el hilo principal y CPU ×4;
  - la app real con 500 entradas: LCP, INP, `ui:feedback`, `capture:palette-to-confirm`, `app:list-visible`, `search:ready` y tareas largas atribuidas con Long Animation Frames (traza con `PERF_TRACE=1`);
  - la comprobación de que CDP no estrangula el Worker dedicado.
- **Puerta de tamaño** (`npm run size`, al final de `npm run check`): JS inicial ≤150 KB y chunk de entrada del Worker ≤40 KB, en brotli 11. Hoy son 114,9 KB y 32,7 KB. También falla si el *build* de producción lleva la página de prueba de `perf`.
- **Rendimiento:**
  - filas de Mi lista con `content-visibility: auto` y paleta sin maquetación forzada: la pulsación sin estrangular baja de 30 a 21 ms de p95 (29-10-2026);
  - *builder* hasta `scan` más rápido: con ×4, de ≈2,2 s a 1,55–1,64 s;
  - fuentes de reserva CJK y emoji calentadas en ratos ociosos: su primera maquetación baja de 30–130 ms a ≤4 ms.
- **Monorepo** (M0, pasos 1–3) con npm *workspaces* y versiones exactas: TypeScript 7.0.2, Biome 2.6.4, Vitest 5.0.5, Playwright 1.64.1, Vite 8.3.5 + React 19.3.1 y `wrangler` 4.155.0, con `npm run setup` y `npm run check`. Biome vigila las fronteras de la §14.3 con `noRestrictedImports` por carpeta y `noUndeclaredDependencies`.
- **ADR** 001 (arquitectura), 002 (stack y repositorio), 004 (datos del usuario) y 005 (búsqueda en un Web Worker), aceptados, y 006 (alcance y formato del catálogo), propuesto. El índice está en `docs/adr/README.md` y las mediciones, en `docs/medidas/`.

#### Estado de los criterios de aceptación

| CA | Estado | Evidencia |
|---|---|---|
| CA1.1 Completo | Cumplido | `catalog:build --keyless` del 29-10-2026: 197 031 juegos y todas las puertas. Los 225 juegos del volcado que faltan tienen su motivo (ADR-006) |
| CA1.2 Listable | Cumplido en Chromium; falta el Android | `catalog.spec` y `full-catalog.spec` (a mano, con 197 031 filas) |
| CA1.3 Buscable | Cumplido | Puertas de `core` sobre la copia congelada (`npm test`; el CI está aplazado) y en cada `catalog:build` |
| CA1.4 Apuntar en <3 s | Cumplido en escritorio y en móvil emulado; falta el Android | E2E «apuntar 5 juegos» (mediana ≤3 s); `perf`: p50 de 1 265,6 ms |
| CA1.5 Rendimiento | Cumplido | `npm run perf`, entero en verde (`docs/medidas/perf-m1-20261030.md`), y puerta de tamaño. La pulsación de escritorio va justa: 31,2 ms frente a 33,3 |
| CA1.6 Estados y marcas | Cumplido | `list.spec` y `agenda-dexie.spec` (≤2 toques, `ui:feedback` ≤100 ms); `undo()` probado como propiedad |
| CA1.7 Carrera de Intro | Cumplido | `palette.spec`: Intro con `delay: 0` y `Ctrl+Intro` |
| CA1.8 Sin red | Cumplido en Chromium | `search.spec`, `agenda-dexie.spec` y `pwa.spec`, sin red tras la primera visita |
| CA1.9 Datos | Cumplido | `data.spec` y `links.spec`; propiedades de exportar → importar en `core` |
| CA1.10 Accesibilidad | Parcial: falta NVDA | `a11y.spec` (axe) y la captura solo con teclado en `palette.spec` |
| CA1.11 Puente de búsqueda | Cumplido en el PC; falta el Android | `search.spec` (`scan` → `full` sin perder la consulta); `perf`: escaneo listo en 1 644 ms y p95 de 23,9 ms |
| CA1.12 Ficha básica | Cumplido | `agenda-dexie.spec`, `navigation.spec` y `palette.spec` (`Mayús+Intro`) |

### Cambiado

Respecto al plan 0.2 y al prototipo de búsqueda medido:

- **Presupuesto de escritorio de la pulsación:** ≤16 ms a ≥120 Hz y ≤2 fotogramas por debajo (≈33 ms a 60 Hz); con ×4 sigue en ≤50 ms (`DECISIONES.md` §10.17). Chromium retiene la respuesta del Worker hasta el primer fotograma tras la tecla. Cambian RNF-02, la §8.9, la §12.4, CA1.5 y ADR-005, y `npm run perf` mide la frecuencia con `requestAnimationFrame`.
- **Pintado y estilos** (§10.18): la interfaz pinta desde una agenda en memoria con `useSyncExternalStore` y guarda en Dexie después del fotograma. Los estilos son hojas CSS normales con *tokens*, una por pantalla. Cambian D-02, D-03, la §6.1, la §9.5 y la §14.
- **App de escritorio:** la app para Windows (Tauri 2, `Ctrl+Mayús+Espacio`) pasa de Fase 2 a M3 (§10.16). No forma parte de esta versión.
- **`merge()`:** reenvía todo el estado del juego manual cuando cambia `mergedInto` (§7.4 y ADR-004). Sin eso, el resultado dependía del orden de llegada de las operaciones.
- **Búsqueda:** los niveles 1 y 2 reúnen siempre `limit` filas nuevas (§8.3). `normalize` quita también los apóstrofos después de NFKD, para ser idempotente («ŉ»).
- **Herramientas:** Biome 2.6.4 y `wrangler` 4.155.0 en lugar de 2.6.3 y 4.154.0, y `@tanstack/react-virtual` 3.14.24. `core.longpaths` y `core.autocrlf` van en la configuración del repositorio, no en la global (§13.2).

### Eliminado

- `dexie-react-hooks`, que no se llegó a usar: `useLiveQuery` pintaría lo guardado y no lo pulsado (§10.18).
- CSS Modules, del plan.

### Seguridad

- **CSP de `ga-web`** (§11.3), aplicada en `vite preview`: los E2E fallan ante una violación. Para cumplirla, Zod va en modo `jitless`, el Service Worker se registra sin *scripts* en línea y no hay `<select>` nativo, porque en WebKit viola `style-src 'self'`.
- **Clave de Steam:** el catálogo de M1 se construye sin clave. El pipeline solo lee `STEAM_WEB_API_KEY` del entorno o de `.env.local`, que git ignora. `fixtures:record` borra y falla ante cualquier fichero grabado que contenga la clave, algo con su forma o la cabecera `x-webapi-key`. La búsqueda de la clave en el *build* llega con el CI.
- **Catálogo:** el Worker valida el *manifest* con su esquema y comprueba el sha256 de cada fichero con WebCrypto. La firma del *manifest* llega en M2.
- **CSV:** las celdas que empiezan por `=`, `+`, `-` o `@` llevan `'` delante (inyección de fórmulas). La importación JSON rechaza las HLC más de 5 min por delante.
- **Conocido:** `npm audit` da 4 avisos leves de `deepmerge`, que llega a través de `workbox-build` y solo se usa en el *build*. No se ha tocado, porque la versión que propone npm (`workbox-build` 5.1.4) rompe cosas.

### Pendiente

- **Android de referencia:** faltan las mediciones en el dispositivo (CA1.2, CA1.4, CA1.11 y RNF-02). La §15.4 permite cerrar M1 con `npm run perf` y pasarlas a M3 con un *issue*. Si el Intro pasa de 50 ms en ese dispositivo, la §9.5 prevé virtualizar Mi lista por secciones.
- **Pasada con NVDA** de apuntar → cambiar estado → Deshacer (CA1.10): no se ha hecho.
- **M0, pasos 4–8, aplazados:** CI (`ci.yml`), despliegues de `ga-web` y `ga-catalog`, comprobaciones «a verificar en M0», ADR-003 y `v0.0.1`. Por eso aún no se ha probado nada en `ga-web`: los E2E y `perf` usan `vite preview` y `/catalog-dev/`.
- **Catálogo sin clave** (ADR-006): faltan ≈204 juegos bloqueados en España, que se pueden apuntar pegando el enlace, y ≈750 nombres traducidos no tienen su nombre base. Se corrige en M2 con `GetAppList`.
- **Fuera de M1** (§15):
  - M2: pipeline diario, portadas, ficha completa y vista Próximos;
  - M3: índice persistido, núcleo de arranque, atajos de una tecla, gestos, «Compartir» y la app de escritorio;
  - M4: sincronización.
