## 12. Calidad e ingeniería

Nivel de prototipo de una persona: se automatiza lo que protege la captura, los datos y la clave de Steam; sin SLO ni entorno de *staging*.

### 12.1 Estrategia de pruebas

| Nivel | Qué cubre | Herramienta |
|---|---|---|
| Unitarias | `packages/core`: normalización con los vectores compartidos (ver §8), niveles de *ranking* sobre el mini-catálogo, parser de enlaces, códecs TSV y *shards*, reglas de estados y marcas (ver §3), HLC | Vitest 5.0.5 |
| Calidad de búsqueda | Dorado, 2 000 exactos, prefijos de 4 letras y negativas, con los umbrales de la §8.10 (exactos y prefijos, con +18 visible). Sin red, sobre una copia congelada y comprimida del núcleo real y sus alias en `fixtures/catalog-frozen/` (≈3 MB gzip; se renueva a mano con `npm run fixtures:freeze`, como mucho una vez por hito). `catalog.yml` aplica las mismas puertas al núcleo recién construido antes de publicar | Vitest |
| Propiedades | `merge()` y normalización (§12.2) | fast-check 4.10.2 en Vitest |
| Contrato | Esquemas Zod 4.6.7 de `GetAppList`, `Query` y `GetItems` contra *fixtures* grabados; formato de exportación | Vitest |
| Pipeline | Ejecución con *fixtures*: clasificación, lógica de las puertas (ver §4), plan B sin clave y determinismo (regenerar el mini-catálogo da los mismos bytes) | Vitest |
| E2E y rendimiento | §12.3 y §12.4, en Chromium de escritorio y móvil emulado (WebKit, en local) | Playwright 1.64.1 |
| Micro-API (M4) | Rutas con `app.request()` de Hono; sincronización con dos contextos de navegador | Vitest, Playwright |

### 12.2 Propiedades, contrato y canario

- **`merge()`** (1 000 casos por propiedad): las mismas operaciones, en cualquier orden o repetidas, dan el mismo estado; `merge(a, b)` = `merge(b, a)`; la reparación de invariantes (Platinado ⇒ Completado, según los relojes) se cumple siempre; importar dos veces el mismo JSON equivale a importarlo una (ver §7).
- **Normalización:** idempotente; la salida no tiene mayúsculas, diacríticos, apóstrofos, ™ ℠ ® © ni espacios sobrantes, y quitar apóstrofos de la entrada no la cambia.
- **Contrato:** los esquemas solo describen los campos usados (ignoran los desconocidos, exigen los obligatorios) y el pipeline valida en vivo con ellos. `npm run fixtures:record` guarda URL, estado HTTP, fecha y cuerpo, nunca cabeceras (la clave va en `x-webapi-key`), y falla si un fichero contiene la clave. Casos: los del mini-catálogo (§13.5), `success 15`, 429 con y sin `Retry-After`, 5xx, JSON roto y lista vacía.
- **Sin red real en CI:** con `STEAM_MODE=fixtures`, el cliente HTTP del pipeline falla ante una petición sin *fixture*; Playwright aborta lo que no vaya al origen local; `ci.yml` no tiene secretos.
- **Canario diario:** el primer paso de `catalog.yml` valida con esos esquemas una petición pequeña a cada endpoint que vaya a usar; si falla, se actúa como ante cualquier violación de contrato (ver §4) y se abre un *issue*.

### 12.3 E2E «apuntar un juego en <3 s»

- **Inicio:** el evento que abre la paleta (`keydown` de `Ctrl+K` o `/`; en móvil, el toque en la barra «Apunta un juego…»). **Fin:** el primer fotograma con la confirmación («Apuntado en Quiero jugar: … · Deshacer», ver §9). La app lo registra como `capture:palette-to-confirm` y el test lee esa medida, no su reloj.
- **Guion y criterio:** 5 juegos distintos del mini-catálogo (`hollow`, `elden`, `baldurs`, `celeste`, `stardew`): abrir la paleta, teclear con `pressSequentially(q, { delay: 100 })`, esperar el nombre accesible del primer `option`, Intro (en móvil, toque en la fila) y esperar al `status`. Pasa si la mediana de las 5 es ≤3 000 ms y `ui:feedback` ≤100 ms en cada una, sin reintentos.
- **Entorno:** *build* del modo `e2e` (el de producción, con el mini-catálogo en el mismo origen y, desde M2, firmado con la clave de desarrollo) servido por `vite preview` con la CSP de `PREVIEW_CSP` (`apps/web/vite.config.ts`). El `_headers` de producción es esa misma CSP más el origen de `ga-catalog` en `connect-src` y `upgrade-insecure-requests`; `deploy-web.yml` comprueba la de producción tras desplegar (ADR-003). Falla ante cualquier `securitypolicyviolation`.
- **Ganchos del *build* `e2e`** (desde M2), que nunca van en el de producción:
  - `unverifiedDevSignature` acepta el mini-catálogo firmado con `dev-1` sin verificarlo, porque el WebKit de Playwright para Windows no trae Ed25519 (§11.3);
  - el de detalles (`__GA_DETAILS_TEST__`) da el índice de *shards* y los *kill switches*. WebKit no intercepta las peticiones del Worker ni las que pasan por el Service Worker, así que las pruebas no reescriben el *manifest*, y las que usan este gancho no registran el Service Worker;
  - `setup()` sirve desde una ruta del contexto todas las peticiones a `*.steamstatic.com`, de modo que ningún test llega a Valve, y apaga por defecto los *kill switches* de portadas y detalles. Las pruebas de portadas y detalles los fijan con `serveDetails`.
- **Otros E2E:** Deshacer, juego ya apuntado, carrera de Intro (con `delay: 0`, Intro apunta el juego de la consulta final), pegar un enlace, juego manual, estado y marca en un toque, sin red, exportar e importar, Catálogo completo, solo teclado, axe-core en cada pantalla (ver §3) y `/share` (M3).

### 12.4 Rendimiento, tamaño y dónde se mide

Las medidas son las mismas en los tests y en el panel: `performance.measure` y, para el INP, Event Timing; «fotograma» es el `requestAnimationFrame` tras el *commit* de React.

| Medida | Desde | Hasta |
|---|---|---|
| `search:keystroke-to-results` | `event.timeStamp` del `input` | Fotograma con los resultados de esa consulta (misma secuencia) |
| `ui:feedback` | Evento que actúa (Intro, `pointerup`) | Fotograma con el cambio visible |
| `capture:palette-to-confirm` | Apertura de la paleta | Fotograma con la confirmación |
| `app:list-visible` · `search:ready` · `search:full` | Inicio de la navegación | Mi lista con datos · primer `status` con estado distinto de `none` (`scan`, `boot` o `full`: ya se busca en el catálogo) · estado `full` |
| `search:index-restored` (M3) | Inicio de la lectura del índice persistido | Índice listo para la primera consulta |
| INP | Inicio de la interacción (`PerformanceObserver` de tipo `event`, agrupado por `interactionId`) | Siguiente pintado |

- **`perf`:** Playwright en Chromium con CPU ×4 (`Emulation.setCPUThrottlingRate` por CDP) y, como umbrales, los presupuestos (ver §3) y los propios de la búsqueda (ver §8.9). Como CDP **no estrangula los Workers dedicados** (medido; ver §8.9), la prueba tiene dos partes:
  1. **Búsqueda:** una página de prueba ejecuta la búsqueda de `packages/core` (índice y *ranking*) en el hilo principal, sobre la copia congelada del núcleo real (§12.1) o sobre `pipeline/out/`. Desde M2, `perf` necesita un catálogo firmado: `npm run catalog:frozen` lo genera desde la copia congelada con la clave `dev-1`, con ≈4 000 recientes y *shards* sintéticos, y el CI lo hace antes de cada pasada. Con un `pipeline/out/` sin firma, como el de M1, la app lo rechaza. Mide el tiempo hasta poder buscar (`scan`; en M3, `boot`) y hasta el índice completo (`full`) y, desde M3, la restauración del índice; teclea carácter a carácter el conjunto realista (ver §8.11) y calcula p50/p95 de pulsación → resultados y del nivel 4. El Worker real se valida en el Android de referencia (§13.4). En el Chromium de Playwright tampoco se estrangula, ni adjuntándolo con `Target.setAutoAttach`: lo comprueba `perf/worker-throttling.perf.ts` en cada pasada (ver §8.9).
  2. **App real**, con el mismo catálogo y 500 entradas en Mi lista: teclea 20 nombres, apunta 10 y mide INP, `ui:feedback`, `capture:palette-to-confirm`, el reinicio con caché (`app:list-visible`) y el LCP; sin estrangular, `search:keystroke-to-results` para el presupuesto de escritorio, que depende de la frecuencia de la pantalla, medida con 60 `requestAnimationFrame` (ver §8.9). Falla si un `PerformanceObserver` de `longtask` ve una tarea del hilo principal de más de 50 ms al teclear o apuntar, o si, ya calentadas las fuentes de reserva, la primera maquetación de han, kana, hangul o emoji pasa de 50 ms. Sin calentar, en Windows y con ×4, cuesta 30–130 ms por escritura y peso (medido el 30-10-2026). La app las calienta en ratos ociosos en cuanto se puede buscar.
- **Tamaño:** `scripts/size-gate.ts` comprime con brotli (calidad 11) el JS inicial, según el `build.manifest` de Vite, y el *chunk* del Worker de búsqueda, y los compara con su presupuesto (ver §6).

| Comprobación | CI | Local | Móvil real |
|---|---|---|---|
| Biome, `tsc`, Vitest (con las puertas de calidad de búsqueda), E2E, tamaño, clave | Bloquea | `npm run check` y `npm run e2e` | — |
| `perf` | Informa (*runners* ruidosos) | **Bloquea** si se toca búsqueda, paleta o Mi lista | — |
| Presupuestos en dispositivo | — | — | Android de referencia (§13.4): **bloquea** el cierre de M1 y M3 (en M1, con la excepción de la §15.4); iPhone, con el panel |

### 12.5 CI/CD

| Flujo | Disparador | Qué hace | Secretos |
|---|---|---|---|
| `ci.yml` (≤10 min, `ubuntu-latest`) | PR y `push` a `main` (salvo cambios solo en documentación) | La columna CI de §12.4 | Ninguno |
| `deploy-web.yml` | `workflow_run` de `ci` (`types: [completed]`, `branches: [main]`), solo si `conclusion` es `success` y `event` es `push`; o manual | *Build* de producción de `workflow_run.head_sha` (el SHA que pasó el CI; con este evento, `GITHUB_SHA` es el último *commit* de `main`), búsqueda de la clave, `wrangler deploy` de `ga-web`, prueba de humo | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| `catalog.yml` | Diario a las 04:17 UTC, con la variable `CATALOG_SCHEDULE` = `on`, y manual (ver §4) | Canario, pipeline, puertas (también las de calidad de búsqueda, ver §8.10), firma, `ga-catalog` con la versión anterior, prueba de humo, estado en la *Release*, *issue* si falla y *dead-man switch* | `STEAM_API_TOKEN` (la clave, que el flujo pasa como `STEAM_WEB_API_KEY`), `CATALOG_SIGNING_KEY`, `CATALOG_CLOUDFLARE_API_TOKEN` y `CATALOG_CLOUDFLARE_ACCOUNT_ID` (los de la cuenta de `ga-catalog`), `HEALTHCHECKS_PING_URL`. Variables y *runbook*: ADR-007 |

- **Repositorio público** desde M0 (el plan lo daba por privado; ver ADR-003). Con el plan Free, un repositorio público también admite entornos y protección de ramas, pero de momento bastan los secretos de repositorio, legibles por cualquier flujo. Se acepta con una sola persona con escritura: solo dos flujos los citan, con `permissions` mínimos (`catalog.yml` añade `contents: write` e `issues: write`), *actions* fijadas por SHA y sin `pull_request_target`; el *token* de Cloudflare solo tiene «Workers Scripts: Edit» (y D1 en M4; alcance: ver §11). Con colaboradores, un entorno protegido para los secretos de despliegue.
- **Búsqueda de la clave:** `scripts/scan-secrets.ts` falla si `dist/` contiene `x-webapi-key`, `STEAM_WEB_API_KEY` o una palabra de 32 caracteres alfanuméricos cuyo SHA-256, tal cual o en mayúsculas, coincida con la variable `STEAM_KEY_SHA256`: `ci.yml` no necesita la clave. La clave son 32 dígitos hexadecimales (128 bits) que Steam muestra en mayúsculas; Valve no lo documenta y se verificó en fuentes secundarias el 30-10-2026. `catalog.yml` revisa `pipeline/out/` con el valor real.
- No se fusiona en rojo y solo se despliega un SHA con el CI en verde: [`workflow_run`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) se dispara sea cual sea el resultado, también tras el CI de una PR, y de ahí sus condiciones (verificado el 28-10-2026). *Rollback*: [`npx wrangler rollback`](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/).
- **Minutos:** en un repositorio público, los de los *runners* estándar no cuentan. El primer `ci.yml` tardó 2 min 52 s, con sus tres trabajos en paralelo (30-10-2026). Si pasara a privado, la estimación es ≈1 070–1 140 de los 2 000 al mes (`catalog.yml` ≈330–400: 30–31 ejecuciones × ≈11–13 min, ver §4.7; `ci.yml` ≈640 en 80 ejecuciones; despliegues ≈100).
- **App de escritorio (M3):** el CI no compila Rust, así que sigue en ≤10 min y no gasta minutos en *runners* de Windows. Sí vigila sin Rust lo que importa para la seguridad: `apps/desktop/desktop.test.ts`, dentro de `npm run check`, falla si aparecen *capabilities* u órdenes propias, si el nombre del evento del atajo no coincide entre Rust y la web o si un *crate* no va fijado. Las pruebas de Rust (`cargo test`) y `clippy` se pasan en el PC. El instalador se genera en el PC con `npm run desktop:build` y se publica en la *Release* de la etiqueta del hito (`gh release create v0.3.0 <instalador>`); la parte nativa se prueba a mano con CA3.7 y CA3.8 (ver §15.6).
- **Pipeline desde el PC:** si faltan minutos o los *runners* compartidos reciben 429 (ver §4), el PC construye con el estado vigente y sube las páginas crudas de Steam a la *Release* `catalog-staging` (`npm run catalog:stage`, ver §13.3). Después, `gh workflow run catalog.yml -f source=staging` las toma de ahí, sin canario ni llamadas a Steam: comprueba que el estado no ha cambiado y que el paquete tiene ≤36 h, vuelve a derivar el catálogo sin red (`--from-raw`) y hace el resto: puertas, búsqueda de la clave, firma, `ga-catalog`, estado y *dead-man switch*. La clave privada de firma solo está en el secreto `CATALOG_SIGNING_KEY`: desde M2, el PC nunca firma ni despliega `ga-catalog`.

### 12.6 Convenciones y definición de terminado

- **Biome 2.6.4** (formato y lint) y **TypeScript 7.0.2**: `tsc --noEmit` por *workspace*, con `strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`, `verbatimModuleSyntax` y `allowImportingTsExtensions`, más `module: nodenext` en `core` y `pipeline`, que también se ejecutan en Node. Así `tsc` rechaza lo que Node no ejecutaría: `enum`, imports relativos sin la extensión `.ts` e imports de tipos sin `type` ([documentación de Node](https://nodejs.org/api/typescript.html), verificado el 28-10-2026).
- **Trunk-based** (`main` siempre desplegable, ramas de ≤2 días, lo incompleto tras una constante de *build*) y **Conventional Commits** con tipo en inglés y descripción en español: `feat(search): añade el nivel de subcadena`.
- **SemVer 0.x por hito:** `v0.0.1` al cerrar M0 y `v0.1.0`, `v0.2.0`… al cerrar cada hito, en el orden en que se cierran (con el orden por defecto, `v0.N.0` = MN); las correcciones, como *patch*. Ajustes muestra versión y SHA; con esa versión se compara `minClientVersion` (ver §7).
- **CHANGELOG.md** en español al cerrar cada hito (Añadido, Cambiado, Corregido, Eliminado, Seguridad). **ADR** en `docs/adr/NNN-titulo.md`, con la plantilla MADR y su estado (lista inicial: ver §5).
- **Definición de terminado** (*Definition of Done*): criterios del hito (ver §15) probados en `ga-web`; pruebas de la lógica nueva y E2E si toca captura, Mi lista o Catálogo; CI en verde, y `npm run perf` si toca búsqueda, paleta o Mi lista; teclado y nombres accesibles (ver §9); dependencia nueva justificada y con versión exacta; ADR y CHANGELOG al día.

### 12.7 Observabilidad mínima, sin telemetría de usuarios

| Dónde | Qué | Aviso |
|---|---|---|
| `catalog.yml` | Resumen en `$GITHUB_STEP_SUMMARY` y `run-report.json` (artefacto): versión, recuentos, llamadas por endpoint y estado HTTP, 429, duraciones, puertas, tamaños y `enrichmentAgeDays` | Fallo: email de GitHub e *issue* con la etiqueta `catalogo` |
| healthchecks.io (gratuito) | Solo el ping del pipeline al terminar bien (`/fail` al fallar); periodo de 24 h y 12 h de gracia | Email a las 36 h sin éxito (cubre un `schedule` retrasado o perdido) |
| Panel de rendimiento (Ajustes, M3) | p50/p95 de §12.4 (500 últimas muestras), versión y antigüedad del catálogo, índice, `persist()` y espacio usado | No envía nada: «Copiar informe» |
| Errores (desde M1) | `console.error` y búfer circular con los 100 últimos en `meta.errorLog` (ver §7.2): `window.onerror`, `unhandledrejection`, Workers y *error boundary*, sin búsquedas ni datos de la lista | Se exporta en JSON desde Ajustes › Datos a partir de M1 y, desde M3, también desde el panel |

**Panel de rendimiento tal como se ha construido** (02-11-2026; `DECISIONES.md` §10.27):
- **Qué mide:** las medidas de la tabla de la §12.4 que hace la app con `performance.measure`, el INP (Event Timing: la entrada más lenta de cada `interactionId`) y el LCP (el último antes de la primera tecla o toque). Safari no tiene Event Timing: allí el INP sale sin muestras, y el panel lo dice.
- **Dónde se guarda:** las 500 últimas de cada medida, en `meta.perfSamples`. Se escriben en segundo plano, 2 s después del último cambio y al ocultar la página, así que se suman las sesiones: cada reinicio da una muestra de arranque. «Borrar todos mis datos» y «Borrar las medidas» las borran.
- **Qué enseña:** n, p50, p75 y p95, frente a los presupuestos de la §3 en el móvil: tecla → resultados p95 ≤50 ms, toque → respuesta p95 ≤100 ms, INP p75 ≤200 ms, apuntar p50 ≤3 s, LCP p75 ≤2,5 s, Mi lista p95 ≤1 s y poder buscar p95 ≤2 s. Debajo, la versión de la app, el navegador, el catálogo, el estado del índice (restaurado o construido), `persist()` y el espacio usado.
- **«Copiar informe»** copia todo en texto. Si el navegador no deja escribir en el portapapeles, el informe sale en un campo para copiarlo a mano.
