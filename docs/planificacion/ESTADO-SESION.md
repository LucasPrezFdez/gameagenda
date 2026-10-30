# Estado del proyecto — punto de partida de la próxima sesión

**Actualizado:** 29-10-2026, al final de la sesión 3.
**Cómo retomar:** escribe *«Retoma GameAgenda desde docs/planificacion/ESTADO-SESION.md»*.

## 1. Dónde estamos

- **Planificación terminada.** `prototipe.md` (raíz del repo) es el plan completo del prototipo: 19 secciones, ≈226 KB (versión 0.2). Para leerlo rápido: §1 (resumen) y §15 (hitos con criterios de aceptación).
- **Cambio del 29-10-2026:** la app de escritorio para Windows (envoltorio Tauri de la misma web, con el atajo global `Ctrl+Mayús+Espacio`) pasa de Fase 2 a **M3**. M3 sube a 4–6 días y el total, a 23–32 días ideales. Detalle en la §17.3 y la §15.6 de `prototipe.md`; el porqué, en `DECISIONES.md` §10.16.
- **Repositorio:** <https://github.com/LucasPrezFdez/gameagenda> (`main`). El usuario pidió el 29-10-2026 ir haciendo *commits* y subirlos sin preguntar, dejar los despliegues para más adelante y centrarse en la app.
- **M0 · Esqueleto:** pasos 1–3 hechos (repositorio, *workspaces*, herramientas). Los pasos 4–8 (CI, despliegues, comprobaciones «a verificar en M0», ADR-001 a 003, `v0.0.1`) quedan **aplazados** hasta que haya cuentas de GitHub Actions y Cloudflare.
- **M1 · Apuntar: casi terminado** (29-10-2026). Todo está en `main` y subido, sin agentes ni *worktrees* abiertos:
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
  - **Pruebas:** 529 unitarias y 98 E2E en verde (6 saltadas a propósito). `npm run perf` aún sale en rojo: ver «Pendiente de M1».
  - **Nota para los E2E:** WebKit en Windows tarda ≈260 ms en guardar un alta en IndexedDB. Las pruebas que recargan después de una acción esperan con `expectStored` (`apps/web/e2e/storage.ts`). Si hay otra vista previa abierta, lanza los E2E con otro `E2E_PORT`, porque `reuseExistingServer` la reutilizaría.
- **Pendiente de M1** (por orden; después vienen CHANGELOG y `v0.1.0`):
  1. ~~**Presupuesto de la pulsación en escritorio.**~~ **Hecho el 30-10-2026** (sesión 4): ≤16 ms a ≥120 Hz y ≤2 fotogramas por debajo (≈33 ms a 60 Hz), decisión del usuario. Cambiados RNF-02, §8.9, §12.4, CA1.5, ADR-005 y `DECISIONES.md` §10.17. `npm run perf` mide la frecuencia y aplica el límite: 23,1 ms de p95 frente a ≤33,3 ms a 60 Hz.
  2. **CA1.11: optimizado el 30-10-2026, falta confirmarlo en reposo.**
     - Antes: con ×4, el escaneo estaba listo en ≈2,2 s tras un reinicio con caché, frente a ≤2 s.
     - Cambios en `core`: `normalize`, pajar, nombres españoles, tabla de exactos, `articleLength` y lector del TSV.
     - En A/B dentro de Chromium con ×4, claves −20 a −36 % y TSV −20 %. Detalle en `docs/medidas/builder-m1-20261030.md`.
     - Ese día había un juego abierto y todo salía ≈1,4× más lento. `perf` dio 2 604 ms, frente a 3 005–3 122 ms con el código anterior; descontando la carga, ≈1,85 s.
     - **Hay que repetir `npm run perf` con el equipo en reposo.** El nivel 4 dio 70,6 ms frente a ≤70 ms; con el código anterior y la misma carga daba 68,7–69,0 ms. Se confirma en la misma pasada.
     - Con la carga, axe en WebKit (`a11y.spec.ts`) superó los 60 s en la tanda completa de E2E. Solas pasan, con el código nuevo y con el anterior.
  3. **Dos tareas largas con ×4 (66–76 ms):** el primer pintado de texto CJK y de un emoji (fuentes de reserva de Windows). Se pueden calentar en un momento ocioso. Además, Intro al apuntar ronda 45–55 ms con ×4.
  4. **RNF-08:** falta el aviso para exportar tras 30 días sin copia, que es de M1.
  5. **Arreglos del plan detectados al escribir los ADR:**
     - la §7.4 no recoge el reenvío de `merge()` al cambiar `mergedInto`;
     - la §13.2 dice `git config --global`, pero se configura en el repositorio;
     - la §8.9/§12.4 debe anotar que CDP no estrangula el Worker (medido);
     - `dexie-react-hooks` no se usa (la agenda va con `useSyncExternalStore`): quitarlo o justificarlo, y ajustar la §6 y D-02;
     - D-02 y la §6.1 hablan de CSS Modules, pero son hojas CSS normales;
     - `biome.json` no tiene las reglas de dependencias de la §14.3 (`noRestrictedImports` y `noUndeclaredDependencies`);
     - en `DECISIONES.md`, la §2 y D-01 siguen con Tauri en Fase 2 (manda la §10.16).
  6. **Lo que mide el usuario:** el Android de referencia (CA1.4, CA1.11 y RNF-02) y la pasada con NVDA (CA1.10). Si no hay Android, se cierra con `perf` y su medición pasa a M3 con un *issue*.
- **Hallazgos de M0 para el ADR-002** (paso 7):
  - Biome 2.6.4 y `wrangler` 4.155.0 en lugar de 2.6.3 y 4.154.0 (publicados el 28-10-2026; la §6 ya está al día). `wrangler` 4.153–4.155 depende de `miniflare` 5.x *beta*: es su dependencia interna, no una elección nuestra.
  - npm 11.19 no ejecuta los *scripts* de instalación sin autorización: `esbuild` y `workerd` funcionan sin ellos y quedan denegados en `allowScripts` de `package.json`.
  - Biome 2.6 formatea Markdown y cambiaría `*cursiva*` por `_cursiva_`: los `.md` quedan fuera de Biome. `biome migrate` convirtió `"recommended": true` en `"preset": "none"` (apagaba todas las reglas); se fijó a mano `"preset": "recommended"` y se comprobó que las reglas saltan.
  - `tsc` rechaza en `core` imports sin `.ts`, `enum`, `document` y `process` (comprobado).
  - `git config core.longpaths true` y `core.autocrlf false` se han puesto en el repositorio, no en la configuración global, para no cambiar otros proyectos.

## 2. Antes de la próxima sesión (lo haces tú)

| Qué | Para qué | Cómo |
|---|---|---|
| Pedir la clave de la Steam Web API | Columna vertebral documentada del catálogo desde M2 (M1 funciona sin clave) | https://steamcommunity.com/dev/apikey — exige una cuenta no limitada (≥5 US$ gastados) y Steam Guard móvil; en «dominio» vale `localhost`. **No la pegues en el chat:** se guardará solo en `.env.local` y en un secreto de GitHub |
| Cuenta de GitHub | Repositorio privado, CI y pipeline | En M0 se instala `gh` (`winget install --id GitHub.cli -e`) y se hace `gh auth login` |
| Cuenta gratuita de Cloudflare | *Hosting* de `ga-web` y `ga-catalog` | https://dash.cloudflare.com/sign-up; en M0, `npx wrangler login` |
| Cuenta de healthchecks.io (gratis) | Aviso si el pipeline diario deja de ejecutarse | No es urgente: se usa en M2 |
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
4. `ci.yml` (≤10 min): Biome, `tsc`, Vitest, Playwright, puerta de tamaño (JS inicial ≤150 KB brotli) y búsqueda de la clave en el *build*.
5. Despliegues: `ga-web` (página mínima + `_headers` con la CSP) y `ga-catalog` (mini-catálogo de `fixtures/` + `_headers` con CORS y los TSV como `text/plain; charset=utf-8`).
6. Comprobaciones «a verificar en M0»: compresión del TSV (`br`, `gzip` o `zstd`); `_headers` y CORS también en los 404; campos de Query sin `include_basic_info` (`is_free`…); estrangulamiento del Worker por CDP (`Target.setAutoAttach`); importación de la clave pública Ed25519 en WebCrypto; formato de la clave de Steam. Cada resultado va al ADR que corresponda o a un *issue*.
7. ADR-001 (arquitectura), ADR-002 (stack y repositorio) y ADR-003 (*hosting*, despliegue y CI) en `docs/adr/`.
8. Cerrar M0 con los criterios CA0.1…CA0.5 y la etiqueta `v0.0.1`.

## 5. Reglas para el asistente en la próxima sesión

- **Fuente de verdad:** `prototipe.md`. El porqué de cada decisión está en `docs/planificacion/DECISIONES.md` (su §10 recoge los ajustes hechos tras medir y manda sobre lo anterior). No reabras decisiones cerradas sin un motivo nuevo (una medición o un cambio externo).
- **No repitas** la investigación ni la redacción: costaron ≈11 M de tokens en total y sus resultados están guardados.
- **Editar el plan:** se cambian los ficheros de `docs/planificacion/secciones/NN-*.md` y se vuelve a montar con `node docs/planificacion/montar-prototipe.mjs . --write` (sin `--write`, solo pasa el *lint*).
- **Búsqueda:** el punto de partida es `docs/planificacion/prototipo-busqueda/`, que en M1 se porta a TypeScript en `packages/core/src/search/`. El núcleo real congelado está en `fixtures/catalog-frozen/`.
- **Seguridad:** la clave de Steam nunca va en el chat, el repo ni el *bundle*; solo en `.env.local` y en secretos de GitHub.
- **Idioma:** español de España en la interfaz y en la documentación; código e identificadores en inglés.
- **Commits:** desde el 29-10-2026, el usuario quiere que se hagan y se suban a `origin/main` en cuanto el trabajo esté en verde, sin preguntar cada vez.

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
