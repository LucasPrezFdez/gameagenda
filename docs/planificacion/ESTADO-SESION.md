# Estado del proyecto — punto de partida de la próxima sesión

**Actualizado:** 29-10-2026, en la sesión 3.
**Cómo retomar:** escribe *«Retoma GameAgenda desde docs/planificacion/ESTADO-SESION.md»*.

## 1. Dónde estamos

- **Planificación terminada.** `prototipe.md` (raíz del repo) es el plan completo del prototipo: 19 secciones, ≈226 KB (versión 0.2). Para leerlo rápido: §1 (resumen) y §15 (hitos con criterios de aceptación).
- **Cambio del 29-10-2026:** la app de escritorio para Windows (envoltorio Tauri de la misma web, con el atajo global `Ctrl+Mayús+Espacio`) pasa de Fase 2 a **M3**. M3 sube a 4–6 días y el total, a 23–32 días ideales. Detalle en la §17.3 y la §15.6 de `prototipe.md`; el porqué, en `DECISIONES.md` §10.16.
- **Repositorio:** <https://github.com/LucasPrezFdez/gameagenda> (`main`). El usuario pidió el 29-10-2026 ir haciendo *commits* y subirlos sin preguntar, dejar los despliegues para más adelante y centrarse en la app.
- **M0 · Esqueleto:** pasos 1–3 hechos (repositorio, *workspaces*, herramientas). Los pasos 4–8 (CI, despliegues, comprobaciones «a verificar en M0», ADR-001 a 003, `v0.0.1`) quedan **aplazados** hasta que haya cuentas de GitHub Actions y Cloudflare.
- **M1 · Apuntar, en curso** (29-10-2026), con agentes en paralelo:
  - Fase 1, ya en `main`: búsqueda en `core` (`normalize`, `catalog-format`, `search`; pasa todas las puertas de la §8.10 sobre el catálogo congelado: dorado 94,9 % / 99,0 %, exactos 99,9 %, prefijos 93,1 %; `scan` = `full`), agenda en `core` (`entries`, `sync`, `steam-link`, `schemas`; 12 propiedades × 1 000 casos) e interfaz de M1 en `apps/web` (paleta, Deshacer, rutas, PWA; JS inicial 80,5 KB brotli) con cliente de búsqueda falso y agenda en memoria.
  - Fase 2, en marcha: Worker de búsqueda real con el catálogo (Cache Storage, `/catalog-dev/`, mini-catálogo en `fixtures/catalog/`, Catálogo virtual) y agenda en Dexie (persistencia, exportar/importar, pegar enlace, Vincular).
  - Después: pipeline de la §4.8 sin clave (CA1.1), arnés `npm run perf` (CA1.5), medición en el Android de referencia, ADR-004 a 006 y `v0.1.0`.
- **Notas para los ADR-004 y 005:** `merge()` reenvía el estado actual de un manual cuando cambia `mergedInto` (con el pseudocódigo literal el resultado dependía del orden de llegada); apuntar escribe 15 campos; el *manifest* de M1 usa `format: 'gacat'`, `v: 1` (a confirmar en M2); `browse` filtra con los niveles 0–2.
- **Hallazgos de M0 para el ADR-002** (paso 7):
  - Biome 2.6.4 y `wrangler` 4.155.0 en lugar de 2.6.3 y 4.154.0 (publicados el 28-10-2026; la §6 ya está al día). `wrangler` 4.153–4.155 depende de `miniflare` 5.x *beta*: es su dependencia interna, no una elección nuestra.
  - npm 11.19 no ejecuta los *scripts* de instalación sin autorización: `esbuild` y `workerd` funcionan sin ellos y quedan denegados en `allowScripts` de `package.json`.
  - Biome 2.6 formatea Markdown y cambiaría `*cursiva*` por `_cursiva_`: los `.md` quedan fuera de Biome. `biome migrate` convirtió `"recommended": true` en `"preset": "none"` (apagaba todas las reglas); se fijó a mano `"preset": "recommended"` y se comprobó que las reglas saltan.
  - `tsc` rechaza en `core` imports sin `.ts`, `enum`, `document` y `process` (comprobado). `pipeline/` aún no tiene código, así que todavía no está en `npm run typecheck`.
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
| 3 | 29-10-2026 | App de escritorio (Tauri) adelantada de Fase 2 a M3 y plan 0.2; M0, pasos 1–3 (repositorio, *workspaces* y herramientas) |
