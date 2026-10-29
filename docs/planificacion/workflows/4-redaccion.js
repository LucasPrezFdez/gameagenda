export const meta = {
  name: 'gameagenda-redaccion-prototipe',
  description: 'Redacta en paralelo las secciones 2-18 de prototipe.md siguiendo DECISIONES.md, y revisa y re-mide el benchmark de búsqueda',
  phases: [
    { title: 'Búsqueda', detail: 'revisión pendiente del benchmark, re-medición del diseño elegido y §8' },
    { title: 'Redacción', detail: '9 redactores en paralelo, un fichero por sección' },
  ],
}

const ROOT = 'C:\\Users\\lucas\\Documents\\Programacion\\GameAgenda'
const PLAN = ROOT + '\\docs\\planificacion'
const OUT = PLAN + '\\secciones'
const OLD = 'C:\\Users\\lucas\\AppData\\Local\\Temp\\claude\\C--Users-lucas-Documents-Programacion-GameAgenda\\56497ade-bd80-409d-8199-9f2b9ba10c3e\\scratchpad'
const NEW = 'C:\\Users\\lucas\\AppData\\Local\\Temp\\claude\\C--Users-lucas-Documents-Programacion-GameAgenda\\8bfa44f3-e578-483c-8387-cce517f4f6a7\\scratchpad'

const SRC = {
  decisiones: PLAN + '\\DECISIONES.md',
  estado: PLAN + '\\ESTADO-SESION.md',
  t1: PLAN + '\\lineas-paralelas\\T1-ux-e-interaccion.revisado.md',
  t2: PLAN + '\\lineas-paralelas\\T2-modelo-de-datos.revisado.md',
  t3b: PLAN + '\\lineas-paralelas\\T3-benchmark-busqueda.borrador.md',
  t3d: PLAN + '\\lineas-paralelas\\T3-benchmark-busqueda.datos.json',
  t4: PLAN + '\\lineas-paralelas\\T4-ingenieria-y-roadmap.revisado.md',
  digest: PLAN + '\\lineas-paralelas\\resumen-decisiones-y-preguntas.txt',
  inv1: PLAN + '\\investigacion\\01-catalogo-y-metadatos-steam.txt',
  inv2: PLAN + '\\investigacion\\02-cuenta-steam-legal-y-otras-fuentes.txt',
  inv3: PLAN + '\\investigacion\\03-producto-ux-y-stack.txt',
  inv3b: PLAN + '\\investigacion\\03b-producto-ux-y-stack-resumen.txt',
  propA: PLAN + '\\panel-arquitectura\\propuesta-gameagenda-local-first-pwa-static-steam-snapshot-m.json',
  propB: PLAN + '\\panel-arquitectura\\propuesta-gameagenda-escritorio-nativo-tauri-2-sqlite-fts5-w.json',
  propC: PLAN + '\\panel-arquitectura\\propuesta-gameagenda-cloud-a-local-first-pwa-on-a-cloudflare.json',
  juezV: PLAN + '\\panel-arquitectura\\juez-core-use-case-and-speed-capture-a-game-i.json',
  juezF: PLAN + '\\panel-arquitectura\\juez-feasibility-for-one-developer-on-this-ma.json',
  juezR: PLAN + '\\panel-arquitectura\\juez-robustness-compliance-and-future-proofin.json',
  b04: PLAN + '\\borradores\\04-steam-data.md',
  b10: PLAN + '\\borradores\\10-steam-account.md',
  b11: PLAN + '\\borradores\\11-legal.md',
  b17: PLAN + '\\borradores\\17-future.md',
}

const INDEX = 'Índice general de prototipe.md: §1 Resumen ejecutivo · §2 Visión, principios y objetivos medibles · §3 Requisitos · §4 Estudio: cómo obtener todos los juegos de Steam · §5 Arquitectura · §6 Stack con versiones · §7 Modelo de datos · §8 Búsqueda instantánea · §9 UX y pantallas · §10 Integración con la cuenta de Steam · §11 Seguridad, privacidad y cumplimiento · §12 Calidad e ingeniería · §13 Entorno de desarrollo en este PC · §14 Estructura del repositorio · §15 Roadmap e hitos · §16 Riesgos y mitigaciones · §17 Multiplataforma · §18 Preguntas abiertas · §19 Referencias.'

const COMMON = `CONTEXTO
Proyecto «GameAgenda»: carpeta ${ROOT} (aún sin código ni git). Se está redactando prototipe.md, el plan profesional del prototipo, en español de España. Hoy es 28-10-2026. Usuario: desarrollador hispanohablante en Windows 11 Pro con Node 24.21, npm 11.19, git 2.56 y Rust 1.99 (sin Docker, Python ni PostgreSQL). Con Bash, las rutas C:\\Users\\... se escriben /c/Users/...
${INDEX}

PASO 0 (obligatorio): lee ENTERO ${SRC.decisiones}. Manda sobre cualquier otra fuente: decisiones D-01…D-19, ADR-001, hitos M0–M4 y Fase 2, cifras canónicas, stack con versiones, glosario, guía de estilo (§8) y reparto de secciones (§9). Si una fuente lo contradice, sigue DECISIONES.md. Si crees que DECISIONES.md se equivoca en algo importante, aplícalo igualmente y explícalo en deviations_from_brief.

REGLAS
- Escribe SOLO tus ficheros (herramienta Write) en ${OUT}. No toques ningún otro fichero del proyecto.
- Cumple la guía de estilo (DECISIONES.md §8), incluida la lista de referencias internas prohibidas en el texto (T1–T4, línea/track, juez, brief, borrador, workflow, agente, DECISIONES.md, rutas temporales o de scratchpad). Respeta el tamaño orientativo de §9 (+20 % como mucho si está justificado; no rellenes).
- Cada fichero empieza por «## N. Título» y usa «### N.M» para subsecciones. Para remitir a otras secciones usa «(ver §N)»; usa subsecciones (§N.M) solo de tus propias secciones.
- Un dato, un hogar: no repitas lo que pertenece a otra sección; remite a ella.
- Las fuentes de docs/planificacion/ son materia prima: condensa, corrige y adapta. Los ficheros lineas-paralelas/*.revisado.md ya pasaron una revisión crítica, pero se escribieron ANTES de decidir la arquitectura: adáptalos a DECISIONES.md (por ejemplo, no hay cuentas por email, la búsqueda es local en un Web Worker, los datos del cliente van en Dexie y los hitos son M0–M4 + Fase 2, nunca P0/P1/P2).
- No contradigas hechos verificados en ${PLAN}\\investigacion. Puedes usar WebSearch/WebFetch (cárgalos con ToolSearch "select:WebSearch,WebFetch") solo para comprobar un dato concreto que necesites; lo que no compruebes márcalo «a verificar en M0» (o en el hito que toque).
- Antes de terminar, relee tu fichero completo y corrige: coherencia con DECISIONES.md, cifras canónicas, nombres del glosario, Mermaid válido, wireframes de ≤78 columnas, tablas bien formadas y ninguna referencia interna prohibida.
- Tu respuesta final es un resumen estructurado (no lo lee el usuario): ficheros escritos, desviaciones, datos de detalle que otras secciones deben respetar, preguntas abiertas, afirmaciones sin verificar y referencias externas citadas.`

const REF_ITEM = { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } }, required: ['title', 'url'] }
const DEV_ITEM = { type: 'object', properties: { topic: { type: 'string' }, what: { type: 'string' }, why: { type: 'string' } }, required: ['topic', 'what', 'why'] }
const WRITER_PROPS = {
  files_written: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, section: { type: 'string' }, bytes: { type: 'number' } }, required: ['path', 'section', 'bytes'] } },
  summary: { type: 'string', description: 'Qué contiene cada sección, en 3-6 frases' },
  deviations_from_brief: { type: 'array', items: DEV_ITEM },
  facts_other_sections_must_match: { type: 'array', items: { type: 'string' }, description: 'Detalles que has fijado y que otras secciones deben respetar (nombres de campos, rutas, cifras, alcance por hito…)' },
  open_questions: { type: 'array', items: { type: 'string' } },
  unverified_claims: { type: 'array', items: { type: 'string' } },
  references: { type: 'array', items: REF_ITEM, description: 'Fuentes externas citadas (para la §19)' },
}
const WRITER_REQ = ['files_written', 'summary', 'deviations_from_brief', 'facts_other_sections_must_match', 'open_questions', 'unverified_claims', 'references']
const WRITER_SCHEMA = { type: 'object', properties: WRITER_PROPS, required: WRITER_REQ }

const SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    ...WRITER_PROPS,
    revised_benchmark_path: { type: 'string' },
    methodology_issues: { type: 'array', items: { type: 'string' } },
    query_fetch: {
      type: 'object',
      properties: {
        done: { type: 'boolean' }, pages: { type: 'number' }, games: { type: 'number' },
        raw_bytes_per_page: { type: 'number' }, gzip_bytes_per_page: { type: 'number' }, seconds_total: { type: 'number' }, notes: { type: 'string' },
      },
      required: ['done', 'pages', 'games', 'raw_bytes_per_page', 'gzip_bytes_per_page', 'seconds_total', 'notes'],
    },
    measurements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          engine: { type: 'string' }, env: { type: 'string' }, cpu_throttle: { type: 'number' }, build_ms: { type: 'number' }, heap_mb: { type: 'number' },
          index_brotli_bytes: { type: 'number' }, restore_ms: { type: 'number' }, p50_ms: { type: 'number' }, p95_ms: { type: 'number' }, max_ms: { type: 'number' }, notes: { type: 'string' },
        },
        required: ['engine', 'env', 'cpu_throttle', 'build_ms', 'heap_mb', 'index_brotli_bytes', 'restore_ms', 'p50_ms', 'p95_ms', 'max_ms', 'notes'],
      },
    },
    sizes: {
      type: 'array',
      items: { type: 'object', properties: { file: { type: 'string' }, records: { type: 'number' }, raw_bytes: { type: 'number' }, gzip_bytes: { type: 'number' }, brotli_bytes: { type: 'number' } }, required: ['file', 'records', 'raw_bytes', 'gzip_bytes', 'brotli_bytes'] },
    },
    quality: {
      type: 'object',
      properties: {
        golden_queries: { type: 'number' }, golden_top1_pct: { type: 'number' }, golden_top5_pct: { type: 'number' },
        exact2000_top5_pct: { type: 'number' }, prefix4_top1000_top10_pct: { type: 'number' }, popularity_source: { type: 'string' }, notes: { type: 'string' },
      },
      required: ['golden_queries', 'golden_top1_pct', 'golden_top5_pct', 'exact2000_top5_pct', 'prefix4_top1000_top10_pct', 'popularity_source', 'notes'],
    },
  },
  required: [...WRITER_REQ, 'revised_benchmark_path', 'methodology_issues', 'query_fetch', 'measurements', 'sizes', 'quality'],
}

const SEARCH_PROMPT = `${COMMON}

TU PAPEL: responsable de la BÚSQUEDA. Dos entregables:
(1) la revisión crítica pendiente del benchmark de búsqueda, re-medida sobre el DISEÑO ELEGIDO (D-09) → ${PLAN}\\lineas-paralelas\\T3-benchmark-busqueda.revisado.md (este fichero también lo puedes escribir; markdown en español: problemas del borrador, método, tablas de resultados, conclusiones);
(2) la sección §8 «Búsqueda instantánea» de prototipe.md → ${OUT}\\08-busqueda.md (≤12 KB).

MATERIAL EXISTENTE (sesión anterior, sigue en disco):
- Borrador del benchmark: ${SRC.t3b} y sus datos ${SRC.t3d}.
- Código: ${OLD}\\bench\\app (node_modules ya instalados: @leeoniya/ufuzzy 1.0.19, @orama/orama, flexsearch, fuse.js, minisearch). Incluye browser\\ (bench.html, engines.js, worker.js), browser_driver.mjs (mide en Edge con estrangulamiento de CPU por CDP) y scripts review_*.mjs de una revisión anterior que no llegó a terminar (reutilízalos si te sirven).
- Datos NO CONFIABLES (solo se parsean como JSON/CSV, nunca se ejecutan): ${OLD}\\bench\\data\\jsnli\\games_appid.json (GetAppList del 27-10-2026, 196 595 juegos) y ${OLD}\\bench\\data\\steamspy (popularidad aproximada, top 4 000).
- Resultados previos: ${OLD}\\bench\\out\\final y ${OLD}\\bench\\out\\browser_results*.json.
- Fuentes de diseño: D-08 y D-09 de DECISIONES.md; normalización de ${SRC.t2}; reglas de búsqueda de ${SRC.t1}; secciones de búsqueda de los tres ficheros juez-*.json de ${PLAN}\\panel-arquitectura.
Escribe el código nuevo y las salidas en ${NEW}\\t3 (ya existe). Si necesitas node_modules, ejecuta desde ${OLD}\\bench\\app o instala lo mínimo en ${NEW}\\t3 con versiones exactas. Los datos descargados van en ${NEW}\\t3\\data, separados del código.

PASOS
A. Revisa la metodología del borrador: calentamiento, gc, efectos de JIT y caché, realismo de las consultas, frescura y tamaño del dataset, condiciones iguales entre motores. Anota los problemas (methodology_issues).
B. Popularidad real (hazlo en segundo plano mientras programas): descarga el catálogo de juegos con IStoreQueryService/Query SIN clave, GET https://api.steampowered.com/IStoreQueryService/Query/v1/?input_json=<JSON url-encoded> con {"query":{"start":S,"count":1000,"sort":2,"filters":{"type_filters":{"include_games":true}}},"context":{"language":"spanish","country_code":"ES"},"data_request":{"include_basic_info":true,"include_release":true,"include_reviews":true}} y S = 0, 950, 1900… (solapamiento de 50) hasta cubrir metadata.total_matching_records. Una petición cada 3 s como mínimo, un solo hilo, Accept-Encoding: gzip. Si recibes dos 429 seguidos, para y usa SteamSpy. Deriva un TSV compacto (appid, name, nameEs si difiere del base que conozcas, type, coming_soon, early_access, adulto = descriptores 3 o 4, free, year, review_count). Mide bytes por página (raw y gzip) y el tiempo total: son datos para el plan del pipeline; anótalos en el revisado.
C. Implementa el diseño de D-09 como prototipo en JS (módulo puro, reutilizable luego en packages/core): normalización con vectores de prueba (™, apóstrofos ’ y ', ligaduras, acentos, CJK), claves (nombre base + nombre en español si lo tienes + clave sin artículo + romanos 1–20 + alias/siglas generadas para los ≈5 000 más populares + bigramas CJK), índice de prefijos en typed arrays con ids en orden de rango estático, bitsets de 1 letra, niveles de ranking con desempate por popularidad dentro del nivel, subcadena solo si faltan resultados y uFuzzy solo si hay <5.
D. Mide en Node 24 y en Edge con CPU ×1, ×4 y ×10 (driver CDP existente): construcción del índice, heap, tamaño del índice serializado (typed arrays; raw/gzip/brotli) y tiempo de restaurarlo, latencia por pulsación p50/p95/max tecleando carácter a carácter (consultas del borrador + «baldurs gate», «cs2», «rdr2», «gta 5», «ff7», «witcher 3», «hades», «elden», «hollow», «stardew», «los sims 4», «pokemon», «zelda», «2077», «1942», erratas «witchr» y «cyberpnk», y alguna CJK). Compáralo con el motor de escaneo del borrador en las mismas condiciones. Mide también el tamaño (raw/gzip/brotli) de: el núcleo TSV completo ordenado por popularidad con las columnas de D-08, el núcleo de arranque con los 20 000 más populares y el fichero de alias.
E. Calidad: conjunto dorado de ≥60 consultas en español con su appid esperado (top-1 y top-5), 2 000 nombres exactos al azar (objetivo ≥99 % en top-5) y prefijos de 4 letras de los 1 000 juegos más populares (objetivo ≥90 % en top-10). Usa la popularidad real si la conseguiste en B.
F. Escribe el revisado y la §8. La §8 es la especificación que se implementará: normalización exacta con tabla de vectores; claves indexadas; estructura del índice; niveles de ranking; alias (fuente y generación); números y appid; protocolo de mensajes con el Worker (número de secuencia, cancelación, carrera de Intro); estados de disponibilidad (sin catálogo, núcleo de arranque, índice persistido); presupuestos y cómo se miden; conjuntos dorados y puertas (CI y publicación); tabla con los resultados reales del benchmark (-1 donde no se pudo medir). Si los números contradicen D-09, aplica D-09 en la §8 y explica en deviations_from_brief qué cambiarías y por qué, con números.
Tiempo: no más de unos 40 minutos de mediciones. Prioriza C, D (Node y Edge ×4) y E. No toques ${OLD}\\bench\\data.`

const WRITERS = [
  {
    key: 'vision-requisitos', label: '§2 visión + §3 requisitos',
    files: '02-vision.md (§2) y 03-requisitos.md (§3)',
    task: `§2 «Visión, principios y objetivos medibles» (≤5 KB): visión en un párrafo y una frase de producto; para quién (jugador con lista de pendientes que usa PC y móvil); 5–7 principios accionables (la captura primero, sin esperas ni red, todo se puede deshacer, un toque, no inventar datos, privacidad por defecto, prototipo pequeño); objetivos medibles con su forma de medirlos (tiempo de captura, acierto de la búsqueda, presupuestos de rendimiento de DECISIONES §5, frescura del catálogo ≤36 h, 0 €/mes); qué NO es objetivo del prototipo.
§3 «Requisitos» (≤10 KB): requisitos funcionales con ids (RF-01…) agrupados (Captura, Mi lista y estados, Catálogo, Ficha, Datos y copia de seguridad, Sincronización, Fase 2), cada uno con prioridad MoSCoW en español (Imprescindible / Importante / Deseable / Fuera del prototipo) y hito (M0–M4, Fase 2) coherente con DECISIONES §4; requisitos no funcionales con ids (RNF-01…) y objetivo medible (rendimiento, sin conexión, durabilidad, accesibilidad WCAG 2.2 AA, privacidad, seguridad, compatibilidad de navegadores y dispositivos, coste); y el MODELO DE ESTADOS, cuyo hogar es esta sección: diagrama stateDiagram-v2 de los 5 estados (todas las transiciones permitidas) y tablas de reglas de marcas y fechas exactamente según D-05.`,
    sources: `${SRC.estado} (§1, §3, §7), ${SRC.inv3b}, ${SRC.t1} (alcance y modelo de estados), ${SRC.t2} (taxonomía de estados), ${SRC.t4} (requisitos no funcionales) y ${SRC.digest} (decisiones y preguntas abiertas de cada línea).`,
  },
  {
    key: 'estudio-steam', label: '§4 estudio Steam',
    files: '04-estudio-steam.md (§4)',
    task: `§4 «Estudio: cómo obtener todos los juegos de Steam» (≤13 KB). Parte de ${SRC.b04}, que ya está bien escrito y verificado, y ADÁPTALO a D-07 y D-08: la estrategia pasa a ser columna vertebral GetAppList con clave + una pasada diaria completa de Query sin clave para enriquecer + GetItems solo para huecos y clasificación; estado entre ejecuciones; puertas de publicación con consultas de humo; publicación de los ficheros de D-08; plan B y construcción de M1 sin clave (Query enumera todo y jsnli solo como contraste en desarrollo). Actualiza el algoritmo de ingesta, el presupuesto de llamadas y la política HTTP. Concilia las cifras con DECISIONES §5 (por ejemplo, hay dos cifras de DLC según la fuente: dilo). Mantén la tabla de fuentes evaluadas, los casos límite, las imágenes y las restricciones que condicionan la arquitectura. Comprueba las afirmaciones clave contra ${SRC.inv1}.
Medición opcional (recomendada): como mucho 4 llamadas sin clave a IStoreQueryService/Query (count 1000, sort 2, contexto spanish/ES, data_request con include_basic_info, include_release, include_assets e include_reviews), con ≥3 s entre llamadas, para medir el tamaño real de una página (raw y gzip) y su tiempo. Con eso, recalcula el volumen diario y la duración del job. Indica que es una medición del 28-10-2026.`,
    sources: `${SRC.b04}, ${SRC.inv1}, ${SRC.juezF} y ${SRC.juezR} (pipeline).`,
  },
  {
    key: 'arquitectura-stack', label: '§5 arquitectura + §6 stack',
    files: '05-arquitectura.md (§5) y 06-stack.md (§6)',
    task: `§5 «Arquitectura» (≤14 KB): 5.1 vista general con un diagrama Mermaid (dispositivo: interfaz en el hilo principal, Worker de búsqueda, Dexie, Service Worker; Cloudflare: ga-web, ga-catalog y, desde M4, la micro-API /api con D1 en la UE; GitHub: Actions con el pipeline y la Release con el estado; Steam: Web API con clave, servicios sin clave y CDN de imágenes); 5.2 componentes y responsabilidades (tabla); 5.3 flujos con sequenceDiagram: apuntar un juego sin red, publicación diaria del catálogo, arranque y actualización del catálogo en el cliente, sincronización (M4); 5.4 principios de diseño que se derivan (Steam fuera del camino crítico, mismo origen para la API, ficheros inmutables con hash, etc.); 5.5 alternativas evaluadas: las tres arquitecturas, sus puntuaciones y fallos fatales y por qué gana A con sus injertos (sin jerga interna: «se evaluaron tres arquitecturas con tres criterios»); 5.6 ADR-001 completo en formato MADR (contexto, opciones, decisión, consecuencias positivas y negativas) y lista de ADR iniciales (ADR-002… con título y hito en que se escriben; se guardarán en docs/adr/).
§6 «Stack con versiones» (≤6 KB): tabla capa / elección / versión exacta / por qué / alternativa descartada, a partir de DECISIONES §6; presupuesto de JS con la medición real de DECISIONES §5 (su hogar es la §6.2); compatibilidades comprobadas; qué no se usa y por qué (SvelteKit, Next, SQLite WASM en el cliente, Fuse.js, FlexSearch/Orama/MiniSearch, Prisma, InstantDB, passport-steam, @cloudflare/vitest-pool-workers…); política de versiones (save-exact, Dependabot, cuándo pasar a Node 26).`,
    sources: `${SRC.propA} (base), ${SRC.propB}, ${SRC.propC}, ${SRC.juezV}, ${SRC.juezF}, ${SRC.juezR} y ${SRC.estado} (§4).`,
  },
  {
    key: 'modelo-datos', label: '§7 modelo de datos',
    files: '07-modelo-datos.md (§7)',
    task: `§7 «Modelo de datos» (≤14 KB). El hogar de las REGLAS de estados es la §3; aquí va cómo se guardan. Incluye: 7.1 modelo lógico con erDiagram (entrada, outbox, ajustes, meta, juego del catálogo de solo lectura y, en M4, agenda, dispositivo, token de emparejamiento y operaciones en el servidor); 7.2 esquema Dexie en TypeScript (db.version(1).stores con los índices que necesitan Mi lista por estado y orden manual, «A continuación», cambios recientes y lápidas) e interfaz Entry con todos los campos de D-05; 7.3 ids naturales y vinculación de juegos manuales (D-04); 7.4 HLC por campo: formato ordenable exacto, operación de outbox y merge() LWW por campo con reparación de invariantes (pseudocódigo) y lápidas; 7.5 exportación/importación (formato JSON versionado con marcas HLC, columnas CSV, importar = merge); 7.6 formatos publicados del catálogo según D-08 (cabecera y columnas exactas del núcleo, bits de flags, recientes, alias, shards, manifest con firma; tamaños medidos o estimados; dónde los guarda el cliente: Cache Storage para ficheros e IndexedDB para el índice persistido); 7.7 esquema de D1 para M4 (DDL SQLite compacto, sincronización con secuencia por agenda, purga de lápidas y qué pasa con un cliente atrasado); 7.8 volumen de datos y minimización.
Corrige las trampas que encontró la revisión del modelo: el id determinista que choca con las fusiones, el orden padre/hijo en la outbox, las fechas parciales mal validadas y node:sqlite que enlaza enteros como REAL ('steam:730.0').`,
    sources: `${SRC.t2} (fuente principal), ${SRC.propA}, ${SRC.propB}, ${SRC.juezR} (identidad, merge y durabilidad) y ${SRC.digest}.`,
  },
  {
    key: 'ux', label: '§9 UX y pantallas',
    files: '09-ux.md (§9)',
    task: `§9 «UX y pantallas» (≤18 KB). Fuente principal: ${SRC.t1}, adaptado a DECISIONES (D-02 rutas, D-05 modelo, D-09 reglas de búsqueda, D-10 superficies de captura, D-11 portadas; etiqueta cada función con su hito M1–M4 o Fase 2, sin P0/P1/P2). Incluye: inventario de pantallas y navegación; flujos con número de pasos, teclas o toques (apuntar desde la paleta, cambiar estado o marca en un toque, revisar y ordenar Mi lista, explorar el catálogo completo, ficha, juego manual, pegar enlace, compartir desde Android, Atajo de iOS en M4, próximos lanzamientos); wireframes ASCII de escritorio y móvil de Mi lista (vista Pendientes), paleta con resultados, Catálogo, ficha y Ajustes; mapa de atajos de teclado y gestos móviles (sin Ctrl+Alt ni AltGr); reglas de respuesta inmediata (optimista, Deshacer, nada se mueve bajo el cursor, esqueletos, carga diferida de imágenes); estados vacío, sin resultados, sin conexión, catálogo aún no listo y errores; accesibilidad WCAG 2.2 AA concreta; resumen de tokens visuales y colores de estado con icono y texto (nunca solo color); tabla de microcopy en español de España. La lógica exacta de búsqueda y ranking tiene su hogar en la §8 y el modelo de estados en la §3: remite.`,
    sources: `${SRC.t1} (principal), ${SRC.juezV} (flujos de captura) y ${SRC.inv3b}.`,
  },
  {
    key: 'steam-seguridad-multiplataforma', label: '§10 Steam + §11 seguridad + §17 multiplataforma',
    files: '10-cuenta-steam.md (§10), 11-seguridad-privacidad.md (§11) y 17-multiplataforma.md (§17)',
    task: `Adapta tres borradores ya verificados a DECISIONES.
§10 «Integración con la cuenta de Steam» (≤6 KB) desde ${SRC.b10}: es Fase 2; ninguna llamada a Steam por usuario antes de un login OpenID verificado y no se importan perfiles pegados (elimina la opción «sin login, pegar el perfil» o preséntala como descartada con el motivo); la micro-API vive en /api de ga-web (cambia «Edge API (Worker)» por «micro-API» en el texto y en el diagrama); canje del ticket tipo PKCE por el almacén de cookies separado de las apps de la pantalla de inicio de iOS; pruebas con un túnel cloudflared porque steam-signin descarta el puerto del realm; las respuestas de Steam no se guardan en D1; la importación solo propone.
§11 «Seguridad, privacidad y cumplimiento» (≤8 KB) desde ${SRC.b11}: aplica D-12, D-13, D-15 y D-16 (CSP con connect-src 'self' + origen de ga-catalog, cabeceras por _headers, aviso de primera capa en M2, política completa antes de M4, pantalla «Datos de Steam que guardamos», interruptor de portadas con referrerpolicy=no-referrer, D1 en la UE y Time Travel en la retención, seguridad del emparejamiento con tokens ≥128 bits y cookies __Host-, rate limiting, búsqueda de la clave en el build, actions fijadas por SHA, firma ed25519 del manifest, edad ≥14 al activar la sincronización).
§17 «Multiplataforma» (≤4 KB) desde ${SRC.b17}: Fase 2; los juegos de Steam conservan steam:<appid> y solo los que no están en Steam reciben igdb:<id>; los manuales se vinculan como en D-04.
Comprueba los datos legales y de otras fuentes contra ${SRC.inv2}.`,
    sources: `${SRC.b10}, ${SRC.b11}, ${SRC.b17}, ${SRC.inv2} y ${SRC.juezR} (cumplimiento, emparejamiento y cuenta de Steam).`,
  },
  {
    key: 'ingenieria-entorno-repo', label: '§12 calidad + §13 entorno + §14 repo',
    files: '12-calidad-ingenieria.md (§12), 13-entorno-desarrollo.md (§13) y 14-estructura-repo.md (§14)',
    task: `Fuente principal: ${SRC.t4}, ya revisado pero escrito antes de decidir la arquitectura: adáptalo a DECISIONES (D-16, D-17, D-18; prototipo de una persona, sin aparato de producción).
§12 «Calidad e ingeniería» (≤8 KB): estrategia de pruebas (unitarias de packages/core, propiedades con fast-check sobre merge() y normalización, contrato contra fixtures grabados de Steam con Zod, E2E de Playwright para «apuntar un juego en <3 s» con su definición exacta de inicio y fin y la mediana de 5 ejecuciones, rendimiento con CPU ×4 y observador de tareas largas, puertas de tamaño), qué se mide en CI y qué en local o en el móvil real, CI/CD (ci.yml ≤10 min, deploy-web.yml, catalog.yml; secretos en un repo privado Free; búsqueda de la clave en el build), convenciones (Biome, tsc con TS 7.0.2, trunk-based, Conventional Commits, SemVer 0.x por hito, CHANGELOG en español, ADR en MADR, Definition of Done) y observabilidad mínima sin terceros (resumen del job del catálogo, dead-man switch, panel de rendimiento en la app, errores en consola y en un registro local exportable).
§13 «Entorno de desarrollo en este PC» (≤5 KB): qué hay instalado, qué instalar y con qué comando exacto (winget para gh y, en M4/Fase 2, cloudflared; npx playwright install chromium webkit; nada de Docker ni Python), ajustes de git en Windows (.gitattributes eol=lf, core.longpaths, .npmrc save-exact), scripts npm (setup, dev en 127.0.0.1 para evitar el aviso del firewall, test, e2e, perf, catalog:build sin y con clave usando --env-file-if-exists), cómo probar en el Android real (chrome://inspect con port forwarding a localhost) y en iPhone (túnel HTTPS con cloudflared y panel de rendimiento), fixtures y mini-catálogo para trabajar sin red.
§14 «Estructura del repositorio» (≤4 KB): árbol comentado según D-18 (apps/web con apps/web/worker en M4, packages/core, pipeline, fixtures, docs/adr, .github/workflows), qué vive en cada paquete y reglas de dependencia entre paquetes.`,
    sources: `${SRC.t4} (principal), ${SRC.juezF} (CI, entorno y trampas), ${SRC.propA} (dev_setup_on_this_machine) y ${SRC.estado} (§3, entorno).`,
  },
  {
    key: 'roadmap-riesgos-preguntas', label: '§15 roadmap + §16 riesgos + §18 preguntas',
    files: '15-roadmap.md (§15), 16-riesgos.md (§16) y 18-preguntas-abiertas.md (§18)',
    task: `§15 «Roadmap e hitos» (≤12 KB): M0–M4 según DECISIONES §4 (y Fase 2 resumida). Para cada hito: objetivo, alcance (qué entra y qué no), entregables, criterios de aceptación MEDIBLES y verificables (cifras, pruebas que deben pasar, comprobaciones en dispositivo real; nada imposible, como exigir nombre al 100 % de los juegos cuando hay 18 sin nombre), esfuerzo en días ideales y dependencias. Añade un diagrama (Mermaid gantt o flowchart) con el orden de los hitos, cómo pasar de días ideales a calendario según las horas semanales y qué ADR se escriben en cada hito. M1 debe demostrar el catálogo completo de Steam buscable y listable y apuntar en «Quiero jugar» en <3 s, con los estados y marcas de un toque.
§16 «Riesgos y mitigaciones» (≤6 KB): registro con id, riesgo, probabilidad, impacto, mitigación y señal de alarma. Como mínimo: endpoints sin clave que cambian o desaparecen, clave de Steam no disponible o revocada, 429 en los runners compartidos de GitHub, cron de GitHub retrasado o desactivado, Safari borra el almacenamiento, rendimiento en móviles de gama baja, ranking que no acierta, cambios de Cloudflare en el plan gratuito, ToU de Steam y uso comercial, cambio de la edad de consentimiento, la beta de Achievement Sets, alcance que crece y un solo desarrollador.
§18 «Preguntas abiertas» (≤4 KB): solo lo que DECISIONES no resuelve. Para cada pregunta: a quién se le pregunta (usuario, Valve…), qué se supone mientras tanto y qué cambia según la respuesta. Parte de ${SRC.estado} §7 (móvil o PC; iPhone o Android; cuenta de Steam con ≥5 US$ y Steam Guard móvil para la clave; qué significa «Platinado» con DLC; DLC en el catálogo; monetización) y añade las preguntas abiertas de ${SRC.digest} que sigan sin respuesta (descarta las ya resueltas por DECISIONES).`,
    sources: `${SRC.t4} (roadmap y riesgos), ${SRC.propA}, ${SRC.propB} y ${SRC.propC} (milestones y risks), los tres juez-*.json de ${PLAN}\\panel-arquitectura, ${SRC.estado} y ${SRC.digest}.`,
  },
]

const writerPrompt = w => `${COMMON}

TU TAREA: escribir ${w.files} en ${OUT}.
${w.task}

FUENTES PRINCIPALES: ${w.sources}
Consulta otras de ${PLAN} solo si necesitas un dato concreto.`

phase('Redacción')
const all = await parallel([
  () => agent(SEARCH_PROMPT, { label: 'búsqueda: benchmark revisado + §8', phase: 'Búsqueda', schema: SEARCH_SCHEMA }).then(r => (r ? { key: 'busqueda', ...r } : null)),
  ...WRITERS.map(w => () => agent(writerPrompt(w), { label: w.label, phase: 'Redacción', schema: WRITER_SCHEMA }).then(r => (r ? { key: w.key, ...r } : null))),
])
const done = all.filter(Boolean)
const failed = ['busqueda', ...WRITERS.map(w => w.key)].filter(k => !done.some(d => d.key === k))
log(`${done.length}/${WRITERS.length + 1} redactores terminaron${failed.length ? '; fallaron: ' + failed.join(', ') : ''}`)
return { done, failed }
