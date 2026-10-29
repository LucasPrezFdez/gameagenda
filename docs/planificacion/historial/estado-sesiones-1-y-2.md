# Estado de la sesión — planificación del prototipo de GameAgenda

**Guardado:** 28-10-2026, ~02:45 (hora local), a petición del usuario («guarda donde estamos ahora mismo para seguir donde lo dejamos en la sesión de mañana»).
**Objetivo:** `prototipe.md` en la raíz del repo (el nombre lo eligió el usuario; mantenerlo). **Terminado el 28-10-2026 (sesión 2).** Para editarlo, cambia los ficheros de `secciones/` y vuelve a montarlo (`NN-*.md` en orden, con el índice).
**Cómo retomar:** en la nueva sesión, escribe *«Retoma GameAgenda desde docs/planificacion/ESTADO-SESION.md»*.

---

## 1. Lo que pidió el usuario (literal)

1. «quiero crear una app que funcione a modo de agenda. En ella obviamente tiene que poderse listar todos los juegos que haya en steam para empezar. Realiza un estudio de como hacerlo de manera profesional, decide tu. Crea el plan en un prototipe.md.»
2. «ten en cuenta que la principal funcion de la app va a ser apuntar juego que quieras jugar. Tambien tendras las opciones de poner juegos que has completado, platinado, comprado, etc. Tiene que ser rapida y agil»
3. «abre agentes en paralelo para agilizar el proceso»

## 2. Progreso

| Paso | Estado | Resultado guardado en |
|---|---|---|
| Revisión del entorno y pruebas en vivo de la API de Steam | ✅ | §3 de este fichero |
| **Workflow 1 — Investigación**: 6 investigadores (catálogo, metadatos e imágenes, cuenta de Steam y aspectos legales, otras fuentes, producto/UX, stack 2026) + 3 verificadores que intentan refutarlos | ✅ 9/9 agentes | `investigacion/` (01, 02, 03 = resúmenes con veredictos; `resultado-completo.json` = todo) |
| **Workflow 2 — Líneas paralelas**: T1 UX, T2 modelo de datos, T3 benchmark de búsqueda real en este PC, T4 ingeniería y roadmap; cada una con borrador + revisión | ⏳ 7/8 al guardar (falta la revisión de T3) | `lineas-paralelas/` (`*.revisado.md` es la versión buena; `T3-*.borrador.md` + `T3-*.datos.json`) |
| **Workflow 3 — Panel de arquitectura**: 3 propuestas (A PWA local-first, B Tauri nativo, C cuentas + sincronización desde el primer día) + 3 jueces (velocidad/UX, viabilidad/coste, robustez/cumplimiento) | ✅ 6/6 | `panel-arquitectura/` (`propuesta-*.json`, `juez-*.json`, `resultado-completo.json`) |
| Borradores de secciones de `prototipe.md` | ✅ §4 Estudio Steam, §10 Cuenta Steam, §11 Seguridad/legal, §17 Multiplataforma | `borradores/` |
| **`prototipe.md`** | ✅ (sesión 2) | raíz del repo |
| Memoria persistente (idioma, entorno, prioridades, preferencia por paralelizar) | ✅ | memoria de Claude Code |
| **Sesión 2 (28-10-2026, desde ~11:45):** decisiones cerradas (ADR-001, D-01…D-19, hitos, cifras y versiones exactas comprobadas en npm; JS medido: React 58,5 KB br, + Dexie y lista virtual 94,5 KB br) | ✅ | `DECISIONES.md` |
| **Workflow 4 — Redacción**: 8 redactores (§2–§7, §9–§18) + responsable de búsqueda (revisión pendiente de T3, re-medición del diseño elegido con popularidad real de Query y §8) | ✅ 9/9 (≈3,7 M tokens, 54 min) | `secciones/02…18-*.md`, `lineas-paralelas/T3-*.revisado.md`, `redaccion-datos.json`; script en `workflows/4-redaccion.js` |
| Conflictos entre secciones zanjados con los datos medidos (ranking, puente de escaneo en M1, `data_request`, orden del núcleo, «A continuación», HLC, medición ×4, puertas en CI, ficha por hitos) | ✅ | `DECISIONES.md` §10 |
| **Workflow 5 — Revisión**: §1 y §19 + 4 críticos (160 hallazgos) + 9 correctores (≈111 aplicados) + lector final («listo con retoques», 23 pendientes) | ✅ 15/15 (≈4,2 M tokens, 72 min) | `secciones/`, `revision-pendientes.json`; script en `workflows/5-revision.js` |
| Prototipo de búsqueda medido y núcleo real congelado guardados en el repo | ✅ | `prototipo-busqueda/`, `fixtures/catalog-frozen/` |
| Decisiones finales (firma solo en GitHub, esfuerzo 22–30 días, accesibilidad) | ✅ | `DECISIONES.md` §4 y §10.12–15 |
| **Workflow 6 — Retoques**: 10 correctores en paralelo + lector rápido (8 pendientes menores, aplicados a mano) | ✅ 11/11 (≈1,8 M tokens, 30 min) | `secciones/`; script en `workflows/6-retoques.js` |
| **`prototipe.md` montado** (índice, 19 secciones, 12 diagramas Mermaid, ≈221 KB) con *lint* limpio | ✅ 28-10-2026 | raíz del repo (se regenera desde `secciones/`) |

> Si esta sesión sigue abierta cuando terminen los dos agentes que faltan, se actualizarán estos ficheros. Si no, se pueden rehacer con **un agente cada uno**: los *prompts* están en `workflows/2-lineas-paralelas.js` y `workflows/3-panel-arquitectura.js`.
> **No repetir el workflow 1**: costó ≈1,8 M de tokens y ≈54 min, y su resultado completo está guardado.

## 3. Hallazgos clave (verificados el 28-10-2026)

- **`ISteamApps/GetAppList/v2` ya no existe:** lo retiraron el 13-11-2025 y hoy da 404. Casi todos los tutoriales están obsoletos.
- **Columna vertebral del catálogo:** `IStoreService/GetAppList/v1`, documentado y **con clave**. Son ≈196 600 juegos (≈133 900 publicados + ≈62 700 «próximamente»), que se obtienen en **4 llamadas** de 50 000. Incluye próximos lanzamientos, juegos gratuitos y para adultos; no incluye los retirados.
  - Requisitos de la clave: cuenta **no limitada** (≥ 5 US$ gastados) + **Steam Guard móvil**.
  - ToU: 100 000 llamadas/día, clave confidencial (nunca en el cliente) y política de privacidad.
- **Enriquecimiento sin clave (no documentado):** `IStoreQueryService/Query` (1 000 ítems/llamada, `sort=2`) y `IStoreBrowseService/GetItems` (lotes de ≈200; `country_code` obligatorio). Aportan tipo, fechas, «próximamente», retirado (`unlisted`), descriptores de adultos, reseñas, portadas y plataformas. Plan B si falla la clave: enumerar solo con Query.
- **Las APIs de Steam no envían CORS**, así que el navegador no puede llamarlas: hace falta un snapshot estático o un proxy propio. El CDN de imágenes **sí** envía CORS y caché de unos 10 años.
- **Tamaño del catálogo:** el índice `[appid, nombre]` de todos los juegos ocupa **1,91 MB en brotli** y cabe en el dispositivo. En este PC, un índice de prefijos responde en **0–0,3 ms**; un escaneo por subcadena tarda 7–14 ms; Fuse.js no sirve (~394 ms).
- **Portadas:** `https://shared.akamai.steamstatic.com/store_item_assets/` + `asset_url_format` (sustituyendo `${FILENAME}`). Orden de preferencia: `library_capsule` → `header` → *placeholder*. **No adivinar rutas antiguas.**
- **Modelo de producto recomendado (benchmark de más de 15 apps):**
  - 5 estados **exclusivos**: Quiero jugar (por defecto), Jugando, En pausa, Completado, Abandonado.
  - *Flags* independientes de un toque: **Platinado** (implica Completado), **Comprado**, **Próximo**; además, una Nota.
  - Fechas automáticas y «Deshacer» en lugar de diálogos de confirmación.
  - Juego manual (solo el título) y pegar un enlace o `appid` de Steam.
- **Presupuestos de rendimiento:**
  - tecla → resultados ≤ 50 ms (p95);
  - toque → respuesta visible ≤ 100 ms;
  - INP p75 ≤ 200 ms;
  - LCP ≤ 2,5 s;
  - reinicio con caché ≤ 2 s.
- **Cuenta de Steam (después del MVP):**
  - Inicio de sesión solo por OpenID 2.0 (`steam-signin` 1.0.5) con verificación en el servidor.
  - `GetOwnedGames` (con clave) necesita «Detalles de juegos: Público».
  - La lista de deseados se lee sin clave.
  - Platinado sigue siendo **manual**: la beta de Achievement Sets (oct-2026) cambia qué cuenta como 100 %.
- **Legal (España/UE):**
  - RGPD/LOPDGDD (edad de consentimiento 14), ToU de Steam y aviso de marca (sin «Steam» en el nombre ni en el icono).
  - La IP del usuario llega al CDN de Valve: hay que indicarlo.
  - Sin analítica de terceros → no hace falta banner de *cookies*.
- **Multiplataforma (más adelante):** IGDB como catálogo maestro (gratis con atribución, solo desde el backend, cruce con Steam por `external_games`). PSN no tiene API oficial, así que Platinado se marca a mano.
- **Stack a 28-10-2026:**
  - Node 24 en LTS de mantenimiento (hasta 2028-04-30); Node 26 pasa a Active LTS hoy.
  - Vite 8.3 (Rolldown), React 19.3, SvelteKit 3.1.
  - TypeScript 7.0.2: sin API hasta la 7.1, así que `svelte-check` y ESLint con tipos necesitan TS 6.
  - Dexie 4.4.7, Hono 4.13, Biome 2.6, Vitest 5, Playwright 1.64, Tauri 2.12.
  - Prisma: en npm `latest` apunta a una RC (fijar versión).
  - **InstantDB cierra** su nube el 2027-08-31, así que no usarlo.
- **Entorno de este PC:**
  - Instalado: Node 24.21, npm 11.19, git 2.56, Rust 1.99 + VS Build Tools 2022 + WebView2 (Tauri se puede compilar ya).
  - No instalado: Docker, Python, PostgreSQL, pnpm (corepack sí viene incluido).

## 4. Decisión de arquitectura — PROVISIONAL

Resultado del panel (completo):

| Juez | Ranking | Totales |
|---|---|---|
| Velocidad / UX | **A > C > B** | A 48 · B 45 · C 45 |
| Viabilidad para un solo desarrollador en este PC | **A > C > B** | A 42 · C 29 · B 25 |
| Robustez / cumplimiento | **C > B > A** | C 48 · B 44 · A 42,5 |

**A gana en dos de los tres jueces.** Los tres proponen la misma base (**A**) y le añaden cosas distintas:

- **Velocidad:** el rigor de búsqueda de B y una sincronización ligera de C, adelantada.
- **Robustez:** la capa de durabilidad e identidad de C y los ids y el *manifest* de control de B.
- **Viabilidad:** recortar A a unas 3 semanas de trabajo:
  - **React 19.3.1 + Vite 8.3.5 SPA**, sin SvelteKit («5 pantallas no necesitan un meta-framework; Kit 3 deja obsoletos la mayoría de tutoriales»).
  - npm workspaces y TS 7.0.2.
  - **Sin código de servidor, base de datos ni cuentas en el prototipo**: dos Workers solo de assets.
  - *Pipeline* Node 24 que se ejecuta igual en el PC y en GitHub Actions.
  - Hasta tener la clave, semilla con el volcado de jsnli + `GetItems` sin clave.

Fallos fatales señalados:
- **B (Tauri):** no hay captura en el móvil hasta el hito 4 y obliga a mantener dos clientes.
- **C:** exige un backend multiusuario antes de poder apuntar el primer juego.
- **A, tal como estaba escrita:** la importación de Steam no tenía autenticación. Se corrige exigiendo login OpenID antes de cualquier llamada por usuario.

**Dirección provisional:**
- **PWA local-first instalable** (móvil + escritorio). Búsqueda y escritura **sin red**.
- **Catálogo:** snapshot estático con *hash* de contenido, generado a diario con **GitHub Actions** (Node 24): `GetAppList` con clave en la cabecera `x-webapi-key` + `GetItems` sin clave a ≤0,4 peticiones/s.
  - Se sirve desde **Cloudflare Workers Static Assets**: núcleo TSV + deltas + *shards* de detalles con rutas de portada.
  - Publicación bloqueada si falla algún control: recuentos, `appid` centinela, tamaño y consultas de humo.
  - `manifest.json` firmado (ed25519) con *kill switches*.
- **Búsqueda:** índice de prefijos en un **Web Worker**.
  - Normalización: quitar ™®© y apóstrofos, NFKD, sin acentos, ligaduras.
  - Se indexan el nombre base, el alias en español, los numerales romanos y los acrónimos (cs2, rdr2, gta5).
  - *Ranking* por niveles: exacto > inicio de título > todos los prefijos > subcadena. La popularidad solo desempata dentro de cada nivel.
  - Contenido +18 oculto por defecto.
- **Datos del usuario:** IndexedDB con **Dexie**.
  - Ids naturales: `steam:<appid>` y `manual:<uuidv7>`.
  - Marcas HLC por campo + *outbox* desde el primer día.
  - `persist()` y exportación/importación JSON/CSV.
- **Micro API** en un Cloudflare Worker (Hono): resolver `appid` desconocidos o retirados, la ficha bajo demanda y, después, la sincronización y Steam. **Nunca** interviene en la búsqueda ni al apuntar.
- **Sincronización ligera, adelantada al hito siguiente a estados y flags:** Hono + **D1 (UE)**, LWW/HLC, emparejamiento de dispositivos por QR o *token* de ≥128 bits y cookie `__Host-` `HttpOnly`.
- **Después:** Steam OpenID + importación (comprado, deseados, sugerencia de platinado), IGDB y Tauri como envoltorio opcional con atajo global (Ctrl+Shift+Espacio).

**Por decidir mañana:**
1. ¿**React 19.3** o **SvelteKit 3.1** (estático)? El juez de velocidad prefiere SvelteKit (JS ≤90 KB brotli, aunque exige TS 6). El de viabilidad prefiere **React + Vite SPA** (ecosistema, tutoriales, TS 7). **Inclinación: React + Vite** con un presupuesto estricto de tamaño de JS.
2. ¿Sincronización en el hito 3 (velocidad y robustez) o después del prototipo (viabilidad)? **Inclinación:** dejar el modelo listo para sincronizar desde el primer día (HLC + *outbox*) e implementar la sincronización como último hito del prototipo.
3. Confirmar los ids naturales y el formato de los *shards*.

## 5. Próximos pasos (en orden)

1. Leer `panel-arquitectura/` (las 3 propuestas y los jueces), `lineas-paralelas/*.revisado.md` y `T3-benchmark-busqueda.*`.
2. Opcional: un agente para la revisión de T3 si sigue faltando. El panel ya está completo.
3. Cerrar la decisión (ADR-001) y el stack con versiones exactas.
4. Escribir `prototipe.md` según el índice de §6, reutilizando `borradores/` y `lineas-paralelas/`. Hay que adaptar los borradores a la decisión final; hoy hablan de «Edge API (Worker)».
5. Workflow de revisión final con 3–4 críticos (exactitud frente a la investigación, coherencia y completitud, implementabilidad, español) y aplicar las correcciones.
6. Preguntar al usuario si `docs/planificacion/` se queda en el repo o se borra al terminar.

## 6. Índice previsto de `prototipe.md`

1. Resumen ejecutivo
2. Visión, principios y objetivos medibles
3. Requisitos (RF/RNF, MoSCoW, modelo de estados)
4. Estudio: cómo obtener todos los juegos de Steam — *borrador listo*
5. Arquitectura (diagramas, flujos, alternativas evaluadas, ADR)
6. Stack con versiones
7. Modelo de datos
8. Búsqueda instantánea
9. UX y pantallas
10. Integración con la cuenta de Steam — *borrador listo*
11. Seguridad, privacidad y cumplimiento — *borrador listo*
12. Calidad e ingeniería
13. Entorno de desarrollo en este PC
14. Estructura del repositorio
15. Roadmap e hitos con criterios de aceptación
16. Riesgos y mitigaciones
17. Multiplataforma — *borrador listo*
18. Preguntas abiertas
19. Referencias

## 7. Preguntas para el usuario (no bloquean; se pueden incluir en §18)

- ¿Usarás la app sobre todo en el **móvil** o en el **PC**? ¿Tu móvil es **iPhone** o **Android**? (En iPhone no se puede «compartir con la PWA».)
- ¿Tienes una cuenta de Steam con **≥ 5 US$ gastados y Steam Guard móvil** para crear la Web API key? (Para el prototipo basta el volcado público como semilla.)
- ¿«Platinado» significa el 100 % del juego base o también los DLC?
- ¿Quieres los **DLC/expansiones** en el catálogo (≈63 000)?
- ¿Tienes previsto **monetizar**? Los ToU de Steam no dicen nada sobre uso comercial; habría que consultar a Valve.

---

## 8. Cierre de la sesión 2 (28-10-2026)

- `prototipe.md` está terminado. Sus fuentes son `secciones/01…19-*.md`; las decisiones, `DECISIONES.md` (incluida su §10, ajustes tras la redacción).
- Pendiente del usuario: decidir si `docs/planificacion/` se queda en el repo (el plan remite a `docs/planificacion/prototipo-busqueda/`) y responder las preguntas abiertas de la §18 del plan (móviles, clave de Steam, DLC, «Platinado», monetización).
- Siguiente paso de desarrollo: hito **M0** (ver §15 del plan), empezando por pedir la clave de Steam.
