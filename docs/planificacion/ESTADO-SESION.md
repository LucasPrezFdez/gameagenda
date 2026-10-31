# Estado del proyecto — punto de partida de la próxima sesión

**Actualizado:** 31-10-2026, al cerrar la sesión 5.
**Cómo retomar:** escribe *«Retoma GameAgenda desde docs/planificacion/ESTADO-SESION.md»*.

## 0. Lo primero en la próxima sesión

Todo está en `main` y subido, con el CI y el despliegue en verde y sin agentes en marcha. Por orden:

1. **Mirar las ejecuciones programadas del catálogo:** 01-11, 02-11 y 03-11 a las 04:17 UTC (05:17 en Madrid). Con `gh run list --workflow catalog.yml --limit 5`, o en la web de Actions.
   - Si alguna falla, se abre el *issue* `catalogo`; se sigue el *runbook* del ADR-007.
   - Relanzar el flujo a mano lo tiene que hacer el usuario: el modo automático no deja al asistente.
   - La del 01-11 es la primera con un estado anterior: traerá recientes por primera vez y pasará las puertas de variación. Hay que mirar sus cifras en el resumen.
2. **Medir CA2.4 en producción** tras la publicación del 01-11:
   - lanzar `npm run smoke:web -- --profile=.cache/smoke-web`;
   - el perfil se sembró el 31-10 a las 15:43 UTC con el catálogo `20261031.1`, y han pasado más de 12 h, así que la primera visita comprueba el *manifest*;
   - la línea «de ga-catalog» dice lo que baja un cliente con el núcleo de ayer: tiene que ser ≤200 KB y no incluir el núcleo;
   - se guarda en `docs/medidas/ca2.4-AAAAMMDD.md`.

   Sin `--profile`, `smoke:web` es la prueba de humo de cada despliegue: primera visita (el 31-10, en `full` en 1,9 s con 3 017 KB), segunda visita sin pedir el *manifest*, y sin red.
3. **Cerrar M2** cuando haya 3 ejecuciones programadas seguidas en verde (CA2.1):
   - poner al día la tabla de CA del CHANGELOG (CA2.1 y CA2.4, y CA2.5 si se ha probado);
   - cabecera `## [0.2.0] · M2 Catálogo vivo · <fecha>`;
   - ADR-007 y ADR-008 a «aceptada», también en `docs/adr/README.md`;
   - etiqueta anotada `v0.2.0` y *push* de la etiqueta.

   Después ya se puede tocar el pipeline: núcleo de arranque, abaratar `applyRecent` y ADR-009.
4. **Preguntar al usuario por la app de escritorio:** si la instaló y si el atajo y las 10 capturas van bien (CA3.7 y CA3.8). El instalador está en `apps/desktop/src-tauri/target/release/bundle/nsis/GameAgenda_0.2.0_x64-setup.exe`; si no está, `npm run desktop:build`.
5. **Seguir con M3**, por este orden si el usuario no dice otra cosa:
   1. atajos de una tecla, gestos y reordenar arrastrando (CA3.4);
   2. índice persistido (CA3.2): no necesita el pipeline;
   3. «Compartir» en Android, `Ctrl+V` en cualquier pantalla y chip «Pegar enlace»;
   4. panel de rendimiento;
   5. WCAG 2.2 AA (CA3.5) y prueba guiada (CA3.6).

   Hay que avisar al usuario al acabar cada parte.

## 1. Dónde estamos

- **Planificación terminada.** `prototipe.md` (raíz del repo) es el plan completo del prototipo: 19 secciones, ≈226 KB (versión 0.2). Para leerlo rápido: §1 (resumen) y §15 (hitos con criterios de aceptación).
- **Cambio del 29-10-2026:** la app de escritorio para Windows (envoltorio Tauri de la misma web, con el atajo global `Ctrl+Mayús+Espacio`) pasa de Fase 2 a **M3**. M3 sube a 4–6 días y el total, a 23–32 días ideales. Detalle en la §17.3 y la §15.6 de `prototipe.md`; el porqué, en `DECISIONES.md` §10.16.
- **Repositorio:** <https://github.com/LucasPrezFdez/gameagenda> (`main`). El usuario pidió el 29-10-2026 ir haciendo *commits* y subirlos sin preguntar, dejar los despliegues para más adelante y centrarse en la app.
- **M0 · Esqueleto: cerrado** (30-10-2026, sin etiqueta; detalle en ADR-003 y en el CHANGELOG, «Sin publicar»):
  - **CI:** `ci.yml` en verde en 2 min 52 s.
  - **Despliegue:** `ga-web` (https://ga-web.gameagenda.workers.dev) y `ga-catalog` (https://ga-catalog.gameagenda.workers.dev), desplegados a mano con `wrangler`, en el subdominio `gameagenda` que eligió el usuario.
  - **Comprobaciones «a verificar en M0»:** cerradas (`docs/medidas/verificaciones-m0-20261030.md` y ADR-003).
  - **Falta:**
    - ~~los secretos de Cloudflare en GitHub~~ **hecho**: el usuario los creó y el despliegue automático funciona (`ci` 41140409104 y `deploy-web` 41140742020). CA0.1–CA0.5 cumplidos;
    - M0 no lleva etiqueta: `v0.0.1` quedaría después de `v0.1.0` (decisión del usuario, 30-10-2026). Su cierre va en el CHANGELOG, en «Sin publicar».
  - **Repositorio público:** el plan lo daba por privado. Los minutos de Actions no cuentan, pero el *cron* se desactiva a los 60 días sin *commits* (R-04).
- **M2 · Catálogo vivo: en curso** (31-10-2026, sesión 4, con cuatro agentes en paralelo):
  - **Contrato en `core`** (`4f6877e`): JSON canónico y firma, *shards* de detalles, `applyRecent` y `StatusMessage.catalog`. Claves de firma `dev-1` (privada en `fixtures/signing/`) y `prod-1` (`9ace9f8`; privada solo para el secreto de GitHub).
  - **En `main`:**
    - A1, la construcción: recientes, *shards*, *kill switches*, firma, puertas, ADR-007 y el arreglo de la clave, que ahora solo va a `GetAppList`. Ejecución real: 217 llamadas, 4 con clave, 0,33 pet./s y 11,3 min.
    - A2, la publicación: `catalog.yml` (04:17 UTC, encendido con la variable `CATALOG_SCHEDULE=on`), estado en la *Release* `catalog-state`, canario, *issue* si falla una puerta, *dead-man switch*, versión anterior conservada y `catalog:stage`. Se retira `deploy-catalog.yml`. Su parte del ADR-007 ya está fundida en `007-pipeline-del-catalogo.md`; el borrador se conserva, marcado como desfasado.
    - C, la interfaz: portadas con «Cargar portadas» (activado por defecto), aviso de primera capa, Ajustes › Privacidad, ficha completa, Próximos, orden por lanzamiento, edad del catálogo y ADR-008.
    - B, el cliente (integrado el 31-10-2026 en la sesión 5, `5d0b95f`): la verificación de la firma, recientes, regla de los 7 días, 404 y mini-catálogo firmado con *shards* sintéticos. Pasan 698 pruebas unitarias y 122 E2E. `ga-web` apunta ya a `https://ga-catalog.gameagenda-cat.workers.dev` (`VITE_CATALOG_URL` y `connect-src`).
  - **Puesta en marcha (31-10-2026, sesión 5):**
    - El usuario creó los secretos `CATALOG_SIGNING_KEY`, `HEALTHCHECKS_PING_URL`, `CATALOG_CLOUDFLARE_API_TOKEN` y `CATALOG_CLOUDFLARE_ACCOUNT_ID`, y la segunda cuenta de Cloudflare, con el subdominio `gameagenda-cat.workers.dev` (§11.3; ADR-003). La variable `CATALOG_ORIGIN` lleva el origen nuevo. `CATALOG_SIGNING_KID` no hace falta: `catalog.yml` usa `prod-1` por defecto.
    - El modo automático no deja al asistente escribir secretos, lanzar `catalog.yml` (despliega en producción) ni cambiar `CATALOG_SCHEDULE`: lo hace el usuario, desde la web de GitHub o con `gh`. `CATALOG_ORIGIN` sí la pudo poner el asistente.
    - **Primera publicación firmada** (ejecución 41201112633, con `no_previous=true`): en verde en 12 min 7 s. Versión `20261031.1`: 197 786 juegos, 3 562 alias, 0 recientes (no hay estado anterior con el que comparar), 197 607 con detalles en 1 024 *shards*. Núcleo de 2,16 MiB en brotli. 218 llamadas a Steam, 4 con clave. Todas las puertas en verde; las de variación se saltan sin versión anterior. La firma con `prod-1` se ha comprobado aparte, con la pública de `core`.
    - **Tres arreglos al integrar B:**
      - **La app pasa a la versión 0.2.0** (`653db54`). Un *manifest* firmado pide `minClientVersion` 0.2.0, y el cliente entró como 0.1.0: en producción rechazaba el catálogo con `client-too-old` y la búsqueda se quedaba sin catálogo durante unos 20 min. Con el cambio, en un Chromium limpio el catálogo llega a `full` en 4,2 s. La etiqueta `v0.2.0` y el CHANGELOG van al cerrar M2.
      - **Prueba de `host.test.ts`** (`07ce4f5`): en el *runner*, el reintento se programaba antes de que la caché llegara a `full`; ahora espera las dos cosas.
      - **Tareas largas por `:has()` en `.app`** (`15090b6`): `npm run perf` daba 40 tareas largas con ×4 (dos por nombre tecleado, casi todo recálculo de estilos). Las causaban dos reglas de C, `.app:has(.cover-notice)` y `.app:has(.palette.is-open)`. No se veían porque el catálogo de `perf` no traía detalles hasta B. Ahora: 0 tareas largas, INP de 40 ms (antes, 88) y `perf` entero en verde. Se encontró con `PERF_TRACE=1` y el seguimiento de invalidaciones de la traza.
    - **`ga-web` no volvía a abrir tras la primera visita** (roto desde el despliegue del 30-10-2026; arreglado en `e8f6dd5`). Workers Static Assets redirige `/index.html` a `/` (307), el Service Worker precacheaba la respuesta redirigida y Chrome la rechaza para una navegación (`net::ERR_FAILED`). Lo encontró una prueba en producción con Playwright; `pwa.spec` lo reproduce ahora con `context.route`. Un navegador con la versión rota se recuperó solo en la primera visita tras el despliegue. En producción, la segunda visita ya no pide el *manifest* (regla de las 12 h). Ver ADR-003.
    - **`perf` en local** necesita un catálogo firmado con `dev-1`: `npm run catalog:frozen` (el de `pipeline/out/` de M1 no lleva firma y el cliente lo rechaza). Así se ha regenerado el 31-10-2026; el catálogo real se vuelve a sacar de las páginas crudas con `--from-raw`.
  - **Falta:**
    1. ~~`CATALOG_SCHEDULE=on`~~ **hecho** por el usuario (31-10-2026, 13:47 UTC);
    2. tres ejecuciones programadas en verde (CA2.1): la primera, el 01-11-2026 a las 04:17 UTC (05:17 en Madrid); como pronto, del 1 al 3 de noviembre;
    3. ~~borrar `%USERPROFILE%\gameagenda-firma-catalogo-PRIVADA.pem`~~ **hecho** (31-10-2026): la privada solo está en el secreto `CATALOG_SIGNING_KEY`;
    4. ~~fundir la parte de publicación en el ADR-007~~ **hecho** (31-10-2026), con la puesta en marcha real, el *runbook* al día y la primera publicación. El borrador no se borra (decisión del usuario): lleva un aviso de que está fundido y desfasado;
    5. CHANGELOG: **redactado** en «Sin publicar» con la forma de la 0.2.0, con la tabla de CA2.1–CA2.8. Al cerrar M2:
       - poner al día la fila de CA2.1 (y la de CA2.5, si se prueba);
       - cambiar la cabecera a `## [0.2.0] · M2 Catálogo vivo · <fecha>`;
       - pasar ADR-007 y ADR-008 a «aceptada»;
       - etiqueta anotada `v0.2.0`;
    6. ~~pasar al plan los cambios que anotaron los informes de M2~~ **hecho** (31-10-2026):
       - `DECISIONES.md` §10.19 (catálogo) y §10.20 (interfaz);
       - las secciones 4, 5, 7, 8, 9, 11, 12, 13 y 15, y `prototipe.md` montado de nuevo.

       Los informes estaban en las transcripciones de los subagentes de la sesión 4, en las llamadas `SubagentHandback` de `~/.claude/projects/…/ba53a48a-…/subagents/`. De ellos salieron dos pendientes de código:
       - `meta.catalog` con la comprobación cada 12 h: **hecho** (31-10-2026, `catalog-meta.ts`). Hay 13 pruebas unitarias nuevas, un E2E y el gancho `checkEveryStart` para los E2E que publican y recargan. El Worker pesa 37,4 KB de 40;
       - abaratar `applyRecent` si el arranque pasa de 2 s: no se ha hecho;
    7. ~~borrar la rama `m2-cliente` y las ramas y carpetas `worktree-agent-*`~~ **No se borran** (decisión del usuario, 31-10-2026: «por si acaso»), aunque todas están integradas.
  - **Avisos de los agentes:** el reinicio con caché sube a ≈1,85 s con recientes (≤2 s; con el equipo cargado, a veces se pasa; el 31-10-2026, 1 893 ms); el Worker pesa 36,9 KB de 40; los cambios del plan de sus informes ya están aplicados (punto 6).
- **M3 · Rápida y ágil: empezado** (31-10-2026, sesión 5; adelantado mientras corren las ejecuciones de CA2.1). **Hasta cerrar M2, no se toca el pipeline** (`pipeline/`, `scripts/catalog-*`, `catalog.yml`): cada ejecución programada usa el código de `main`. Eso deja para después del 3-11 el núcleo de arranque.
  - **App de escritorio para Windows:** hecha e integrada (`a3bce6a`; ADR-010, «propuesta»). La hizo un agente en un *worktree*.
    - `apps/desktop` con Tauri 2: `ga-web` como origen remoto, sin *capabilities* ni órdenes propias, con `desktop.test.ts` en `npm run check`.
    - El atajo lanza `gameagenda:capture` en la página, y `App.tsx` abre la paleta.
    - Instalador: `npm run desktop:build` → `apps/desktop/src-tauri/target/release/bundle/nsis/GameAgenda_0.2.0_x64-setup.exe`.
    - El agente lo comprobó instalado: atajo → paleta en 20 ms (p50), atajo → «Apuntado» en 1,23 s con el tecleo simulado, sin red, y 11 llamadas de la página a Tauri rechazadas.
    - Plan al día: §6.1, §12.5, §13, §14.1, §16 (R-18), §17.3 y DECISIONES §10.21.
    - **Le toca al usuario:** instalarla y hacer 10 capturas reales (CA3.7, p50 ≤3 s); el modo avión de verdad; mirar el menú de la bandeja, también con el atajo cogido por otra aplicación; y el aviso de SmartScreen.
    - Limitaciones conocidas, en el ADR: el arranque con Windows deja un valor `StartupApproved` en el registro al desactivarlo, «borrar datos» del desinstalador borra la agenda de escritorio y un atajo pulsado antes de que cargue la página no abre la paleta.
    - **Incidencias del agente:** al preparar la prueba abrió el Bloc de notas, y Windows restauró la sesión con `.env.local` abierto. El agente dice que lo cerró sin leerlo. También abrió una pestaña de Steam en Brave al probar «Ver en Steam».
  - **Siguiente propuesto:** atajos de una tecla, gestos y reordenar arrastrando (CA3.4); índice persistido (CA3.2, sin pipeline); «Compartir», `Ctrl+V` y panel de rendimiento.
- **M1 · Apuntar: cerrado con `v0.1.0`** (30-10-2026; etiqueta anotada en GitHub, con `CHANGELOG.md`). Las mediciones en el dispositivo pasan a M3 (ver «Pendiente de M1», punto 6). Todo está en `main` y subido, sin agentes ni *worktrees* abiertos:
  - **Búsqueda.** En `core`: `normalize`, `catalog-format`, `search` y `search-quality`. Sobre la copia congelada: conjunto dorado 94,9 % / 99,0 %, exactos 99,9 %, prefijos 93,1 %, y `scan` da lo mismo que `full`.
  - **Worker y catálogo.** Worker real con Cache Storage `gacat-<versión>`, `/catalog-dev/` y Catálogo virtual. Mini-catálogo de 298 juegos en `fixtures/catalog/`, generado con `npm run catalog:frozen`.
  - **Agenda.** En `core`: `entries`, `sync`, `steam-link` y `schemas`. En la app, Dexie:
    - guarda después del fotograma y coordina las pestañas con `storagemutated`;
    - exporta e importa JSON y CSV, y «Borrar todos mis datos»;
    - pegar enlace (con juego provisional) y Vincular;
    - aviso «Guardado fallido · Exportar · Reintentar».
  - **Pipeline sin clave (CA1.1 ✓).** `npm run catalog:build -- --keyless`.
    - Núcleo real `20261029.1`: 197 031 juegos, que pasan todas las puertas.
    - Del volcado `jsnli`, los 225 que faltan tienen su motivo (204 bloqueados en ES, que entran en M2 por H1).
    - Las páginas crudas están en `pipeline/state/raw-2026-10-29/` (con `--from-raw` se rederiva sin red) y los informes, en `pipeline/state/reports/20261029.1/`. No se versionan.
    - `pipeline/out/` contiene ya ese catálogo real.
  - **Rendimiento.** `npm run perf` (con `PERF_PORT`) y `npm run size`, que va dentro de `check`: JS inicial de 113,8 KB y Worker de 32,5 KB, en brotli. La tabla está en `docs/medidas/perf-m1-20261029.md`.
  - **ADR:** 001, 002, 004, 005 y 006 (propuesta), con índice en `docs/adr/README.md`. ADR-003 espera a los despliegues.
  - **Pruebas:** 536 unitarias y 102 E2E en verde (6 saltadas a propósito). `npm run perf`, en verde desde el 30-10-2026.
  - **Nota para los E2E:** WebKit en Windows tarda ≈260 ms en guardar un alta en IndexedDB. Las pruebas que recargan después de una acción esperan con `expectStored` (`apps/web/e2e/storage.ts`). Si hay otra vista previa abierta, lanza los E2E con otro `E2E_PORT`, porque `reuseExistingServer` la reutilizaría.
- **Pendiente de M1** (M1 se cerró con `v0.1.0`; solo queda el punto 6, que pasa a M3):
  1. ~~**Presupuesto de la pulsación en escritorio.**~~ **Hecho el 30-10-2026** (sesión 4): ≤16 ms a ≥120 Hz y ≤2 fotogramas por debajo (≈33 ms a 60 Hz), decisión del usuario. Cambiados RNF-02, §8.9, §12.4, CA1.5, ADR-005 y `DECISIONES.md` §10.17. `npm run perf` mide la frecuencia y aplica el límite: 23,1 ms de p95 frente a ≤33,3 ms a 60 Hz.
  2. ~~**CA1.11.**~~ **Hecho el 30-10-2026:** con ×4, el escaneo está listo en 1 553–1 644 ms tras un reinicio con caché (antes, ≈2,2 s). Se optimizaron `normalize`, el pajar, los nombres españoles, la tabla de exactos, `articleLength` y el lector del TSV. Detalle en `docs/medidas/builder-m1-20261030.md`.
  3. ~~**Tareas largas con ×4.**~~ **Hecho el 30-10-2026:**
     - **Fuentes de reserva:** la primera maquetación de han, kana, hangul o emoji costaba 30–130 ms con ×4, por escritura y peso. `src/perf/fallback-fonts.ts` las calienta en ratos ociosos en cuanto se puede buscar; tras eso, ≤4 ms. `perf` lo comprueba con una fila nueva.
     - **El Intro que apunta:** analizado. En reposo no pasa de 50 ms. Con el equipo cargado, el primer Intro de la sesión (código en frío) llegaba a 58–60 ms. Si vuelve a pasar en el Android de referencia, la §9.5 prevé virtualizar Mi lista por secciones.
     - **`npm run perf` sale entero en verde por primera vez.** La pulsación de escritorio va justa: 31,2 ms frente a 33,3. Tabla y análisis en `docs/medidas/perf-m1-20261030.md`.
  4. ~~**RNF-08.**~~ **Hecho el 30-10-2026:** aviso arriba de Mi lista tras 30 días sin exportar (JSON o CSV), contando desde la primera entrada si nunca se ha exportado. «Ahora no» lo aplaza 7 días; no sale con el de iOS. Se guarda en `meta.copyReminder` (§7.2) y se describe en la §9.6. Tiene pruebas unitarias, de Dexie entre pestañas y E2E con `page.clock`.
  5. ~~**Arreglos del plan detectados al escribir los ADR.**~~ **Hecho el 30-10-2026:**
     - la §7.4 recoge el reenvío de `merge()` al cambiar `mergedInto`;
     - la §13.2 configura `core.longpaths` y `core.autocrlf` en el repositorio;
     - la §8.9 y la §12.4 anotan que CDP no estrangula el Worker, ni con `Target.setAutoAttach`;
     - `dexie-react-hooks` se ha retirado, y la §6, la §9.5, la §14, D-02, D-03 y la §10.18 lo recogen;
     - CSS Modules ya no aparece: son hojas CSS normales;
     - `biome.json` vigila la §14.3 con `noRestrictedImports` por carpeta y `noUndeclaredDependencies`, y se ha comprobado que cada regla salta;
     - en `DECISIONES.md`, la §2, D-01, la tabla de hitos y la de versiones llevan Tauri en M3, y la §5, el presupuesto de la §10.17.
     - De paso: `npm audit` da 4 avisos leves de `deepmerge` (vía `workbox-build`, solo en el *build*). npm propone bajar `workbox-build` a la 5.1.4, que rompe cosas; no se ha tocado.
  6. **Lo que mide el usuario:** el Android de referencia (CA1.4, CA1.11 y RNF-02) y la pasada con NVDA (CA1.10). Si no hay Android, se cierra con `perf` y su medición pasa a M3 con un *issue*.
     - Guía paso a paso en `docs/medidas/guia-dispositivo-m1.md` (30-10-2026), con un fragmento de DevTools para p50 y p95 y una tabla de resultados. El usuario pega la tabla en el chat y se guarda en `docs/medidas/dispositivo-m1-AAAAMMDD.md`.
     - Pasan a M3 por decisión del usuario (30-10-2026), en el *issue* [#1](https://github.com/LucasPrezFdez/gameagenda/issues/1).
     - Dudas abiertas de la guía: en Android, «con la barra» (la de Chrome no se arrastra) y «Fin» (necesita un teclado); y CA1.11 en el móvil con ≈10 entradas, frente a las 500 de `perf` (se puede generar una copia de 500 para importar).
- **Hallazgos de M0 para el ADR-002** (paso 7):
  - Biome 2.6.4 y `wrangler` 4.155.0 en lugar de 2.6.3 y 4.154.0 (publicados el 28-10-2026; la §6 ya está al día). `wrangler` 4.153–4.155 depende de `miniflare` 5.x *beta*: es su dependencia interna, no una elección nuestra.
  - npm 11.19 no ejecuta los *scripts* de instalación sin autorización: `esbuild` y `workerd` funcionan sin ellos y quedan denegados en `allowScripts` de `package.json`.
  - Biome 2.6 formatea Markdown y cambiaría `*cursiva*` por `_cursiva_`: los `.md` quedan fuera de Biome. `biome migrate` convirtió `"recommended": true` en `"preset": "none"` (apagaba todas las reglas); se fijó a mano `"preset": "recommended"` y se comprobó que las reglas saltan.
  - `tsc` rechaza en `core` imports sin `.ts`, `enum`, `document` y `process` (comprobado).
  - `git config core.longpaths true` y `core.autocrlf false` se han puesto en el repositorio, no en la configuración global, para no cambiar otros proyectos.

## 2. Antes de la próxima sesión (lo haces tú)

| Qué | Para qué | Cómo |
|---|---|---|
| ~~Pedir la clave de la Steam Web API~~ | **Hecho (31-10-2026):** en `.env.local` (`STEAM_WEB_API_KEY`) y en el secreto de GitHub `STEAM_API_TOKEN`, con su *hash* en la variable `STEAM_KEY_SHA256` del CI. Funciona: `GetAppList` responde 200 | `catalog.yml` (M2) mapea `STEAM_API_TOKEN` a `STEAM_WEB_API_KEY` |
| ~~Cuenta de GitHub~~ | **Hecho el 30-10-2026:** `gh` 2.103.3 instalado (`C:\Program Files\GitHub CLI\gh.exe`; una terminal abierta antes de instalarlo no lo encuentra en el `PATH`) y con sesión como `LucasPrezFdez` (ámbitos `repo`, `read:org` y `gist`). No toca las credenciales de git | — |
| ~~Cuenta gratuita de Cloudflare~~ | **Hecho el 30-10-2026:** `wrangler login` con la cuenta del usuario y subdominio `gameagenda.workers.dev` | Falta el *token* de la API para GitHub (ver §1) |
| ~~Cuenta de healthchecks.io~~ | **Hecho (31-10-2026):** *check* «catalog» (1 día + 12 h) y secreto `HEALTHCHECKS_PING_URL`. Si llega un correo suyo, el cron no ha corrido: ver el *runbook* del ADR-007 | — |
| Probar la app de escritorio | CA3.7 y CA3.8 (M3) | Instalar `apps/desktop/src-tauri/target/release/bundle/nsis/GameAgenda_0.2.0_x64-setup.exe` (SmartScreen: «Más información» → «Ejecutar de todas formas»). Hacer 10 capturas con `Ctrl+Mayús+Espacio` desde otros programas, probar el modo avión y mirar el menú de la bandeja. Ojo: tiene su propia agenda hasta M4 |
| Mirar el correo de GitHub del 1 al 3 de noviembre | CA2.1 | Un fallo de `catalog.yml` abre el *issue* `catalogo` y manda correo. Relanzar el flujo lo hace el usuario: Actions › catalog › Run workflow |
| Opcional: renovar la clave de Steam | Por si acaso | Un agente abrió por error `.env.local` en el Bloc de notas y dice que lo cerró sin leerlo. Si se renueva: `.env.local`, el secreto `STEAM_API_TOKEN` y la variable `STEAM_KEY_SHA256` |
| Móviles reales | Medir los presupuestos de rendimiento | Un Android de gama media de referencia (M1) y un iPhone, aunque sea prestado (M3 y M4) |
| Responder las preguntas de la §18 | Afinar el orden de los hitos y el alcance | Sobre todo PA-01 (¿apuntarás desde el móvil y el PC desde el principio?) y PA-02 (¿iPhone o Android?) |

## 3. Decisiones pendientes del usuario

| Pregunta | Supuesto mientras no respondas |
|---|---|
| ¿`docs/planificacion/` se queda en el repo? | **Sí.** `prototipe.md` remite a `docs/planificacion/prototipo-busqueda/`. No se borra nada sin confirmarlo |
| Preguntas abiertas PA-01…PA-10 (§18 de `prototipe.md`) | Los supuestos escritos en la propia §18 (por ejemplo: orden M3 → M4; Android de gama media como referencia) |
| ¿Importar un JSON también aplica los ajustes que trae? | **Sí** (el formato de exportación los incluye; antes se guarda copia en `meta.backup`) |
| Nombre base del catálogo sin clave: `GetItems` en inglés para los nombres que parecen españoles (+18 peticiones; recupera el 75,7 %) o una segunda pasada de Query en inglés (+208) | **`GetItems` en inglés**, como está. En M2 lo resuelve `GetAppList` con clave |

## 4. Guion de M0 (el detalle manda en §15.3, §12, §13 y §14 de `prototipe.md`)

1. `git init`, `.gitattributes` con `eol=lf`, `git config core.longpaths true`, `.npmrc` con `save-exact=true` y `.gitignore` (`.env.local`, `node_modules`, `dist`, `pipeline/out`).
2. npm workspaces y carpetas: `apps/web`, `packages/core`, `pipeline/`, `fixtures/` (ya existe `fixtures/catalog-frozen/`), `docs/adr/`, `scripts/` (§14).
3. Herramientas con las versiones exactas de la §6: TypeScript 7.0.2, Biome 2.6.4, Vitest 5.0.5, Playwright 1.64.1 (`npx playwright install chromium webkit`), Vite 8.3.5 + React 19.3.1, `wrangler` 4.155.0. Antes de instalar, comprueba con `npm view <paquete> version` si hay parches nuevos; cambiar de versión mayor obliga a actualizar la §6.
4. ✓ (30-10-2026) `ci.yml` (≤10 min): Biome, `tsc`, Vitest, Playwright, puerta de tamaño (JS inicial ≤150 KB brotli) y búsqueda de la clave en el *build*.
5. ✓ (30-10-2026, a mano; el automático espera a los secretos) Despliegues: `ga-web` (página mínima + `_headers` con la CSP) y `ga-catalog` (mini-catálogo de `fixtures/` + `_headers` con CORS y los TSV como `text/plain; charset=utf-8`).
6. ✓ (30-10-2026) Comprobaciones «a verificar en M0»: compresión del TSV (`br`, `gzip` o `zstd`); `_headers` y CORS también en los 404; campos de Query sin `include_basic_info` (`is_free`…); estrangulamiento del Worker por CDP (`Target.setAutoAttach`; **ya medido**: no se estrangula, ver §8.9); importación de la clave pública Ed25519 en WebCrypto; formato de la clave de Steam. Cada resultado va al ADR que corresponda o a un *issue*.
7. ✓ (30-10-2026) ADR-001 (arquitectura), ADR-002 (stack y repositorio) y ADR-003 (*hosting*, despliegue y CI) en `docs/adr/`.
8. Cerrar M0 con los criterios CA0.1…CA0.5 y la etiqueta `v0.0.1`.

## 5. Reglas para el asistente en la próxima sesión

- **Fuente de verdad:** `prototipe.md`. El porqué de cada decisión está en `docs/planificacion/DECISIONES.md` (su §10 recoge los ajustes hechos tras medir y manda sobre lo anterior). No reabras decisiones cerradas sin un motivo nuevo (una medición o un cambio externo).
- **No repitas** la investigación ni la redacción: costaron ≈11 M de tokens en total y sus resultados están guardados.
- **Editar el plan:** se cambian los ficheros de `docs/planificacion/secciones/NN-*.md` y se vuelve a montar con `node docs/planificacion/montar-prototipe.mjs . --write` (sin `--write`, solo pasa el *lint*).
- **Búsqueda:** el punto de partida es `docs/planificacion/prototipo-busqueda/`, que en M1 se porta a TypeScript en `packages/core/src/search/`. El núcleo real congelado está en `fixtures/catalog-frozen/`.
- **Seguridad:** la clave de Steam nunca va en el chat, el repo ni el *bundle*; solo en `.env.local` y en secretos de GitHub.
- **Idioma:** español de España en la interfaz y en la documentación; código e identificadores en inglés.
- **Commits:** desde el 29-10-2026, el usuario quiere que se hagan y se suban a `origin/main` en cuanto el trabajo esté en verde, sin preguntar cada vez.
- **Ritmo:** se pueden usar subagentes para trabajos independientes, pero hay que avisar al usuario al acabar cada parte y preguntar si sigue.
- **No borrar** ramas, *worktrees* ni borradores sin que el usuario lo pida (31-10-2026: «no borres nada por si acaso»).
- **Lo que el modo automático no deja hacer al asistente:** escribir secretos de GitHub, lanzar `catalog.yml` (despliega en producción) y cambiar `CATALOG_SCHEDULE`. Se le dan al usuario los pasos en la web de GitHub. Las variables normales, como `CATALOG_ORIGIN`, sí se pueden poner.
- **Hasta cerrar M2, no tocar el pipeline** (`pipeline/`, `scripts/catalog-*`, `catalog.yml`): las ejecuciones programadas usan `main`.
- **Después de cada despliegue de `ga-web`, `npm run smoke:web`.** `vite preview` esconde diferencias con Workers Static Assets: el 31-10, el Service Worker roto desde el 30-10.
- **`npm run perf` en local** necesita antes `npm run catalog:frozen` (catálogo firmado con `dev-1`). Con procesos pesados en marcha (Discord, `cargo`), `perf` y los E2E de WebKit sensibles al tiempo fallan sueltos: se repiten antes de culpar al código.
- **Los informes de los subagentes** llegan por `SubagentHandback`; los antiguos están en `~/.claude/projects/<proyecto>/<sesión>/subagents/agent-*.jsonl`.
- **Nunca** meter comillas invertidas de Markdown dentro de un `node -e "…"` en Bash: la *shell* las ejecuta como órdenes. Para texto, Write o Edit.

## 6. Mapa de ficheros

| Ruta | Qué es |
|---|---|
| `prototipe.md` | El plan del prototipo |
| `CLAUDE.md` | Instrucciones del proyecto para Claude Code |
| `docs/adr/` | ADR del proyecto (índice en `README.md`) |
| `docs/medidas/` | Mediciones guardadas (p. ej., la tabla de `perf` de M1) |
| `pipeline/state/` | Estado, páginas crudas e informes del pipeline (no se versiona: solo en este PC) |
| `fixtures/catalog-frozen/` | Núcleo real del catálogo (196 665 juegos) y sus alias, del 28-10-2026 |
| `docs/planificacion/DECISIONES.md` | Decisiones cerradas y su porqué |
| `docs/planificacion/secciones/` | Fuente de cada sección de `prototipe.md` |
| `docs/planificacion/montar-prototipe.mjs` | Monta `prototipe.md` y pasa el *lint* |
| `docs/planificacion/prototipo-busqueda/` | Búsqueda medida: código, conjunto dorado, vectores y resultados |
| `docs/planificacion/medicion-js/` | Medición del tamaño de React + Dexie con Vite 8.3.5 |
| `docs/planificacion/investigacion/` | Investigación verificada de la sesión 1 (Steam, legal, UX, stack) |
| `docs/planificacion/lineas-paralelas/`, `panel-arquitectura/`, `borradores/` | Trabajo de la sesión 1: líneas paralelas, las tres arquitecturas con sus evaluaciones y borradores |
| `docs/planificacion/redaccion/` | Registros y datos de la redacción, la revisión y los retoques (sesión 2) |
| `docs/planificacion/workflows/` | Scripts de los 6 workflows (los de 5 y 6 leen ficheros que ahora están en `redaccion/`) |
| `docs/planificacion/historial/estado-sesiones-1-y-2.md` | Estado detallado de las sesiones 1 y 2 |

## 7. Historial

| Sesión | Fecha | Qué se hizo |
|---|---|---|
| 1 | 27/28-10-2026 (noche) | Investigación verificada (catálogo y API de Steam, cuenta de Steam y legal, otras fuentes, producto y UX, stack de 2026), cuatro líneas paralelas (UX, modelo de datos, benchmark de búsqueda, ingeniería) y evaluación de tres arquitecturas |
| 2 | 28-10-2026 | Decisiones cerradas; redacción en paralelo (9 agentes); benchmark de búsqueda con el catálogo real; revisión (4 críticos y 9 correctores); retoques (11 agentes); `prototipe.md` terminado |
| 3 | 29-10-2026 | App de escritorio (Tauri) adelantada de Fase 2 a M3 y plan 0.2. M0, pasos 1–3 (repositorio, *workspaces* y herramientas). M1 casi completo con agentes en paralelo: búsqueda, Worker y Catálogo virtual; agenda en Dexie con exportar/importar y enlaces; pipeline sin clave con el catálogo real (CA1.1); `npm run perf` y la puerta de tamaño; ADR-001, 002, 004, 005 y 006 |
| 4 | 30-10-2026 | Pendiente de M1, puntos 1–5: presupuesto de la pulsación según la frecuencia (§10.17); *builder* y lector del TSV más rápidos (CA1.11, 1,64 s); fuentes de reserva CJK y emoji calentadas; `npm run perf` entero en verde; aviso de copia a los 30 días (RNF-08); arreglos del plan, retirada de `dexie-react-hooks` y reglas de Biome de la §14.3. `CHANGELOG.md`, versión 0.1.0 y guía de medidas en el dispositivo |
| 5 | 31-10-2026 | M2, puesta en marcha: secretos, segunda cuenta de Cloudflare (`gameagenda-cat.workers.dev`) y healthchecks.io; primera publicación firmada con `prod-1` (`20261031.1`, 197 786 juegos, 12 min 7 s); cliente de M2 (B) integrado en `main` y `ga-web` apuntando al catálogo nuevo; la app pasa a la versión 0.2.0 (la que pide el catálogo firmado); fuera los `:has()` de `.app`, que daban 40 tareas largas con ×4 (`perf` entero en verde); ADR-007 fundido, CHANGELOG de la 0.2.0 y el plan al día con lo construido (DECISIONES §10.19–10.21); `meta.catalog` y la comprobación cada 12 h; arreglado el Service Worker de `ga-web`, que no volvía a abrir tras la primera visita desde el 30-10; M3 empezado con la app de escritorio (Tauri) |
