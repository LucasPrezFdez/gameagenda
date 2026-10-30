# Registro de cambios

Cambios de GameAgenda por versión. Cada hito cierra una versión SemVer 0.x (§12.6 de `prototipe.md`). Las fechas van en formato dd-mm-aaaa.

## [Sin publicar]

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
  - `deploy-web.yml` despliega `ga-web` tras cada `ci` en verde de `main`, y `deploy-catalog.yml` despliega `ga-catalog` a mano. Los dos acaban con una prueba de humo. El primer despliegue automático, del 30-10-2026, tardó 33 s.
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
