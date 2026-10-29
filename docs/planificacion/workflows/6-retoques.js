export const meta = {
  name: 'gameagenda-retoques-prototipe',
  description: 'Aplica en paralelo los retoques finales de prototipe.md (pendientes del lector final + decisiones 12-15 de DECISIONES §10), un corrector por grupo de ficheros',
  phases: [
    { title: 'Retoques', detail: 'un corrector por grupo de ficheros, en paralelo' },
    { title: 'Comprobación', detail: 'lectura final rápida de coherencia' },
  ],
}

const ROOT = 'C:\\Users\\lucas\\Documents\\Programacion\\GameAgenda'
const PLAN = ROOT + '\\docs\\planificacion'
const OUT = PLAN + '\\secciones'
const DEC = PLAN + '\\DECISIONES.md'
const PEND = PLAN + '\\revision-pendientes.json'

const COMMON = `CONTEXTO
Proyecto «GameAgenda» (${ROOT}). prototipe.md (plan del prototipo, en español de España) se monta a partir de los ficheros de ${OUT} (01-resumen.md … 19-referencias.md). Ya pasó una revisión con cuatro críticos y correctores; ahora quedan RETOQUES concretos. ${DEC} manda (léelo, sobre todo su §4 y su §10, puntos 1–15). ${PEND} lista los problemas que dejó el lector final (campo file = fichero).
REGLAS
- Modifica SOLO tus ficheros (Edit; Write solo para reescribir una subsección entera). No toques ningún otro fichero.
- Aplica cada retoque con el cambio mínimo, manteniendo el estilo (DECISIONES §8: «», coma decimal, espacio de millares, identificadores entre comillas invertidas, «## N.» / «### N.M», Mermaid y tablas válidos, wireframes ≤78 columnas, sin jerga interna del proceso: nada de «D-09», «DECISIONES.md», «brief», «juez», «T1–T4»…; las rutas del repo como docs/adr/, fixtures/ o docs/planificacion/prototipo-busqueda/ sí están permitidas).
- Si un retoque te parece incorrecto, no lo apliques y explica por qué.
- Al terminar, relee tus ficheros completos y comprueba que siguen bien formados.`

const SCHEMA = {
  type: 'object',
  properties: {
    applied: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, why: { type: 'string' } }, required: ['what', 'why'] } },
  },
  required: ['applied', 'skipped'],
}

const GROUPS = [
  { files: ['01-resumen.md', '19-referencias.md'], todo: `
- §1: el esfuerzo pasa a M0 2–3 días y M1 9–12 días; total **22–30 días ideales**; a 15 h/semana, 8,8–12 semanas sin colchón (día ideal ≈6 h; ver §15). Actualiza también la tabla de hitos de §1 si da días por hito.
- §1: el orden por defecto es M3 → M4; M4 puede ir antes si se usan dos dispositivos desde el principio o un iPhone sin instalar la app (que coincida con PA-01 de §18).
- §19: sustituye la línea final sobre la documentación de trabajo por: «Las decisiones de arquitectura se registran como ADR en \`docs/adr/\` (ver §5.6); el prototipo de búsqueda medido el 28-10-2026 está en \`docs/planificacion/prototipo-busqueda/\`.».
- §19: busca con grep todas las URL (http/https) de los ficheros 02–18 de ${OUT} y añade a su grupo las que falten (en particular las de compresión de Cloudflare, la Cache API de Workers, los límites de D1 y las demás que cite el cuerpo). Sin duplicados.
- Pendientes de ${PEND} para tus ficheros.` },
  { files: ['02-vision.md', '03-requisitos.md'], todo: `
- §2.4 (O-1, prueba guiada): aclara que las personas que hacen la prueba guiada en los dispositivos del desarrollador, sin introducir datos propios, no cuentan como «probadores externos» (los que obligan a tener antes los textos legales; ver §11).
- §3: RF-08 (Atajo de iOS + buzón) y RF-16 (gestos móviles) pasan a «Importante», porque entran en el alcance de M4 y M3 con criterios obligatorios.
- §3 (RNF-09, accesibilidad): axe sin violaciones graves ni críticas en cada hito; pasada con NVDA al cerrar M1; con NVDA, Narrador, TalkBack y VoiceOver al cerrar M3.
- §3.3: los filtros o vistas de compra se llaman «Comprados» y «Por comprar» (y así deben aparecer en la §9). Si hoy usas «Pendientes que tengo», cámbialo.
- Si alguna parte cita el esfuerzo total, es 22–30 días ideales.
- Pendientes de ${PEND} para tus ficheros.` },
  { files: ['04-estudio-steam.md'], todo: `
- Firma del manifest (DECISIONES §10.12): si hay que ejecutar el pipeline desde el PC, el PC solo descarga y construye y sube el resultado a una Release de preparación \`catalog-staging\`; después se lanza \`catalog.yml\` con \`workflow_dispatch\` (\`source=staging\`), que pasa las puertas, firma y publica. El PC nunca firma ni despliega. Corrige §4.5, §4.8 y cualquier «se lanza desde el PC con el mismo comando» que implique publicar.
- Minutos de Actions de \`catalog.yml\`: ≈330–400 min/mes (30–31 ejecuciones × 11–13 min), igual que en la §12.
- \`recent\`: ≈4 000 filas en 14 días (≈264 altas + ≈17 renombrados al día), igual que en la §7.6.
- «Próximamente»: «(62 642 en ES, 32 %)».
- Pendientes de ${PEND} para tu fichero.` },
  { files: ['05-arquitectura.md', '06-stack.md'], todo: `
- §5.2: el motivo de que el Worker no use Dexie se escribe una sola vez aquí: «Dexie ocupa ≈27 KB brotli, dos tercios del presupuesto de 40 KB del Worker» (no «casi todo»).
- Firma del manifest (DECISIONES §10.12): donde §5 describa la ejecución del pipeline desde el PC, el PC solo construye y sube a \`catalog-staging\`; \`catalog.yml\` (\`workflow_dispatch\`, \`source=staging\`) pasa las puertas, firma y publica.
- §6: si no está, añade a \`vite-plugin-pwa\` «\`injectRegister: false\`: el Service Worker se registra desde la app con \`workbox-window\`».
- Si §5 o §6 citan el esfuerzo total, es 22–30 días ideales.
- Pendientes de ${PEND} para tus ficheros.` },
  { files: ['07-modelo-datos.md'], todo: `
- §7.7: añade al DDL de D1 la caché de \`resolve\`: \`CREATE TABLE resolve_cache (appid INTEGER PRIMARY KEY, name TEXT NOT NULL, fetched_at TEXT NOT NULL) STRICT;\` y una columna \`last_sync_at\` en \`agenda\` (la usa la regla de retención de agendas sin sincronizar de la §11.2). En la §7.8, menciona la caché como dato público, no personal.
- §7.2: añade \`meta.errorLog\`: anillo con los 100 últimos errores (sin datos personales), que se exporta desde Ajustes › Datos en M1 y desde el panel de rendimiento en M3.
- Comentario de \`merge()\` sobre \`structuredClone\`: cámbialo por «copia superficial: basta y evita structuredClone» (la §14.3 sí declara structuredClone en core).
- \`recent\`: ≈4 000 filas en 14 días (≈264 altas + ≈17 renombrados al día), igual que en la §4.
- §7.6: el motivo de no usar Dexie en el Worker remite a la §5.2 (no lo repitas).
- Pendientes de ${PEND} para tu fichero.` },
  { files: ['08-busqueda.md'], todo: `
- §8.10 y §8.11: la copia congelada del núcleo está en \`fixtures/catalog-frozen/\`: \`core.20261028.1.tsv.gz\` (≈3,05 MB) y \`aliases.20261028.1.tsv\`, ya copiados el 28-10-2026; los renueva \`npm run fixtures:freeze\` (ver §12.1 y §14). Elimina \`fixtures/search/core.tsv.gz\`.
- §8.11 «Punto de partida de M1»: el prototipo medido (código, dorado, vectores, siglas y resultados) está en \`docs/planificacion/prototipo-busqueda/\`; en M1 se porta a TypeScript en \`packages/core/src/search/\` y el dorado pasa a \`packages/core/test/golden.es.tsv\`.
- §8.8: «índice leído de Dexie» → «índice leído de IndexedDB (\`meta.searchIndex\`, sin Dexie)».
- §8.11: deja solo la fila del índice serializado en la tabla de tamaños y remite a la §7.6 para el núcleo, el núcleo de arranque y los alias.
- Pendientes de ${PEND} para tu fichero.` },
  { files: ['09-ux.md'], todo: `
- §9.9, aviso de primera capa (portadas, M2): añade «Más información», que abre la pantalla «Datos de Steam que guardamos» (M2). Es el único texto del aviso; la §11 remite aquí.
- Filtros de compra: «Comprados» y «Por comprar» (como en la §3.3), también en los wireframes.
- §9.2: la paleta muestra hasta 8 resultados en una sola lista y, si no bastan, debajo el bloque «¿Quizás buscabas…?» con hasta 3 sugerencias (ver §8.4); añade su pista a la tabla de microcopy si falta.
- Chip «Pegar enlace»: llega en M3 (en M1 se pega dentro de la paleta en todas las plataformas). Ajusta la fila del flujo que hoy lo pone en M1.
- Ajustes › Datos (M1): «Exportar registro de errores» (\`meta.errorLog\`, ver §7.2).
- Pendientes de ${PEND} para tu fichero.` },
  { files: ['10-cuenta-steam.md', '11-seguridad-privacidad.md', '17-multiplataforma.md'], todo: `
- §17.3: «ADR-013» → «ADR-012».
- §11.3: la clave privada ed25519 solo vive en un secreto de GitHub; si el pipeline se ejecuta desde el PC, el PC solo construye y sube a \`catalog-staging\`, y \`catalog.yml\` firma y publica (DECISIONES §10.12).
- §11.2: las personas que hacen la prueba guiada en los dispositivos del desarrollador, sin datos propios, no cuentan como «probadores externos».
- §11: el aviso de primera capa remite al texto de la §9.9, que incluye «Más información» → pantalla «Datos de Steam que guardamos» (M2).
- Pendientes de ${PEND} para tus ficheros.` },
  { files: ['12-calidad-ingenieria.md', '13-entorno-desarrollo.md', '14-estructura-repo.md'], todo: `
- §12.4: el Android de referencia bloquea el cierre de M1 y M3 «(en M1, con la excepción de la §15.4)».
- §12.5: \`catalog.yml\` ≈330–400 min/mes (30–31 ejecuciones × 11–13 min); recalcula el total.
- Firma del manifest (DECISIONES §10.12) en §12.5 y §13: el PC solo construye y sube a la Release \`catalog-staging\` (por ejemplo \`npm run catalog:stage\`); se publica con \`gh workflow run catalog.yml -f source=staging\`. El PC nunca firma ni despliega \`ga-catalog\`.
- §12.7: el anillo de errores se guarda en \`meta.errorLog\` (ver §7.2) y se exporta desde Ajustes › Datos en M1.
- §14 y §13: \`fixtures/catalog-frozen/\` contiene ya \`core.20261028.1.tsv.gz\` y \`aliases.20261028.1.tsv\` (copiados el 28-10-2026); menciona también \`docs/planificacion/prototipo-busqueda/\` (prototipo de búsqueda medido) en el árbol de \`docs/\`.
- Pendientes de ${PEND} para tus ficheros.` },
  { files: ['15-roadmap.md', '16-riesgos.md', '18-preguntas-abiertas.md'], todo: `
- Esfuerzo (DECISIONES §4 y §10.13): M0 2–3 días, M1 9–12 días, M2 4–5, M3 3–4, M4 4–6; total **22–30 días ideales**. Rehaz la tabla de calendario con días acumulados (M0 2–3; M1 11–15; M2 15–20; M3 18–24; M4 22–30) y semanas = días × 6 h / horas por semana (10 h: ×0,6; 15 h: ×0,4; 30 h: ×0,2). Ajusta los desgloses de esfuerzo de M0 (comprobaciones «a verificar en M0») y M1 (puente de escaneo, ficha básica, arnés de rendimiento y E2E).
- CA1.5: el LCP se mide con \`PerformanceObserver\` en el proyecto \`perf\` (ver §12.4), no con Lighthouse.
- CA0.3 y R-16, alineados con la §7.6: los TSV se sirven como \`text/plain; charset=utf-8\` por \`_headers\` desde M0; CA0.3 comprueba el \`Content-Encoding\` (br, gzip o zstd); si aun así no se comprime, ficheros ya comprimidos con gzip + \`DecompressionStream\` (ADR-003). Revisa la probabilidad de R-16.
- R-06: «Índice D-09» → «Índice de la §8».
- CA1.10: añade la pasada con NVDA; CA3.5: NVDA, Narrador, TalkBack y VoiceOver.
- Sustituye «borrar IndexedDB (con una acción de diagnóstico)» por «borrar los datos del sitio desde el navegador (DevTools en escritorio; Ajustes › Safari › Avanzado › Datos de sitios web en iPhone)».
- PA-01: supuesto = «Los dos, pero hasta M4 se apunta sobre todo en uno; orden por defecto M3 → M4».
- R-03/R-04 y cualquier mención al pipeline desde el PC: el PC solo construye y sube a \`catalog-staging\`; \`catalog.yml\` (\`source=staging\`) firma y publica.
- Pendientes de ${PEND} para tus ficheros.` },
]

phase('Retoques')
const results = await parallel(GROUPS.map(g => () =>
  agent(`${COMMON}\n\nTUS FICHEROS: ${g.files.map(f => OUT + '\\' + f).join(', ')}\nRETOQUES:${g.todo}`, { label: `retoques: ${g.files.join(' + ')}`, phase: 'Retoques', schema: SCHEMA })
    .then(r => (r ? { files: g.files, ...r } : null))))

phase('Comprobación')
const check = await agent(`${COMMON}\n\nTU PAPEL: lector final rápido. Lee ${DEC} (§4 y §10) y TODOS los ficheros de ${OUT} en orden. No modifiques nada. Busca SOLO problemas graves que sigan presentes: contradicciones entre secciones (esfuerzo, hitos, rutas, nombres, cifras), referencias «(ver §N)» rotas, encabezados mal numerados, Mermaid o tablas rotos y jerga interna del proceso. Como mucho 15, de más a menos grave.`,
  { label: 'lector final rápido', phase: 'Comprobación', schema: { type: 'object', properties: { verdict: { type: 'string' }, issues: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, quote: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['file', 'quote', 'problem', 'fix'] } } }, required: ['verdict', 'issues'] } })

return { results: results.filter(Boolean), check }
