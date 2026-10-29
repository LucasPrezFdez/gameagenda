export const meta = {
  name: 'gameagenda-revision-prototipe',
  description: 'Revisa las secciones de prototipe.md con 4 críticos (exactitud, coherencia, implementabilidad, español), escribe §1 y §19 y aplica las correcciones verificadas',
  phases: [
    { title: 'Revisión', detail: '4 críticos con criterios distintos + redactor de §1 y §19' },
    { title: 'Corrección', detail: 'un corrector por grupo de ficheros: verifica cada hallazgo y lo aplica' },
    { title: 'Comprobación', detail: 'lectura final de coherencia del documento ensamblado' },
  ],
}

const ROOT = 'C:\\Users\\lucas\\Documents\\Programacion\\GameAgenda'
const PLAN = ROOT + '\\docs\\planificacion'
const OUT = PLAN + '\\secciones'
const DEC = PLAN + '\\DECISIONES.md'
const NOTES = (args && args.notes) || ''
const DATA = PLAN + '\\redaccion-datos.json'

const GROUPS = [
  { key: 'g01', files: ['02-vision.md', '03-requisitos.md'] },
  { key: 'g02', files: ['04-estudio-steam.md'] },
  { key: 'g03', files: ['05-arquitectura.md', '06-stack.md'] },
  { key: 'g04', files: ['07-modelo-datos.md'] },
  { key: 'g05', files: ['08-busqueda.md'] },
  { key: 'g06', files: ['09-ux.md'] },
  { key: 'g07', files: ['10-cuenta-steam.md', '11-seguridad-privacidad.md', '17-multiplataforma.md'] },
  { key: 'g08', files: ['12-calidad-ingenieria.md', '13-entorno-desarrollo.md', '14-estructura-repo.md'] },
  { key: 'g09', files: ['15-roadmap.md', '16-riesgos.md', '18-preguntas-abiertas.md'] },
  { key: 'g10', files: ['01-resumen.md', '19-referencias.md'] },
]
const ALL_FILES = GROUPS.flatMap(g => g.files).sort()
const BODY_FILES = ALL_FILES.filter(f => f !== '01-resumen.md' && f !== '19-referencias.md')

const COMMON = `CONTEXTO
Proyecto «GameAgenda» (${ROOT}). Se está terminando prototipe.md, el plan profesional del prototipo, en español de España. Hoy es 28-10-2026. Las secciones están en ficheros separados en ${OUT} (NN-*.md; se montarán en este orden). ${DEC} contiene las decisiones cerradas (ADR-001, D-01…D-19, hitos M0–M4 y Fase 2, cifras canónicas, stack con versiones exactas, glosario, guía de estilo §8 y, MUY IMPORTANTE, su §10 «Ajustes tras la redacción», que manda sobre lo anterior): manda sobre todo lo demás. ${DATA} recoge los datos de detalle que fijó cada redactor, sus afirmaciones sin verificar, sus preguntas abiertas y las referencias citadas (si un dato de detalle choca con DECISIONES.md, manda DECISIONES.md). La investigación verificada está en ${PLAN}\\investigacion y las fuentes de trabajo en ${PLAN}\\lineas-paralelas (el benchmark de búsqueda revisado y medido hoy es T3-benchmark-busqueda.revisado.md), ${PLAN}\\panel-arquitectura y ${PLAN}\\borradores.
Identificadores técnicos como \`.github/workflows/\`, \`workflow_dispatch\` o \`workflow_run\` y las URL están permitidos aunque contengan palabras de la lista prohibida; la prohibición es para la jerga del proceso de planificación.
Lo que pidió el usuario: «una app que funcione a modo de agenda… tiene que poderse listar todos los juegos que haya en steam para empezar… la principal funcion de la app va a ser apuntar juego que quieras jugar. Tambien tendras las opciones de poner juegos que has completado, platinado, comprado, etc. Tiene que ser rapida y agil».
${NOTES ? 'NOTAS DEL ARQUITECTO (mandan como DECISIONES.md):\n' + NOTES + '\n' : ''}`

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Nombre del fichero, p. ej. 07-modelo-datos.md' },
          quote: { type: 'string', description: 'Texto exacto afectado (≤200 caracteres) para localizarlo' },
          severity: { type: 'string', enum: ['alta', 'media', 'baja'] },
          problem: { type: 'string' },
          fix: { type: 'string', description: 'Corrección concreta: texto nuevo o instrucción precisa' },
          evidence: { type: 'string', description: 'Fuente o comprobación que lo respalda (fichero, URL, cálculo)' },
        },
        required: ['file', 'quote', 'severity', 'problem', 'fix', 'evidence'],
      },
    },
  },
  required: ['summary', 'findings'],
}

const CRITICS = [
  {
    key: 'exactitud', label: 'crítico: exactitud',
    lens: `EXACTITUD TÉCNICA Y FACTUAL. Comprueba cada afirmación factual (Steam, APIs, cifras, tamaños, límites, normativa, navegadores, Cloudflare, GitHub, versiones de librerías) contra ${PLAN}\\investigacion, las cifras y versiones canónicas de DECISIONES.md §5–§6 y, para lo que no esté ahí, con WebSearch/WebFetch (cárgalos con ToolSearch "select:WebSearch,WebFetch"). Comprueba en particular, con fuentes oficiales actuales: compresión automática (brotli/gzip) de ficheros .tsv/.json en Workers Static Assets; soporte del fichero _headers y de run_worker_first con patrones de ruta; límites de ficheros por versión y tamaño por fichero; facturación de los assets estáticos; jurisdicción UE de D1 en el plan gratuito y Time Travel; soporte de Ed25519 en WebCrypto en Chrome, Safari y Firefox actuales; clave timezone en el schedule de GitHub Actions y desactivación por inactividad; Web Share Target y apps de pantalla de inicio en iOS; persistencia del almacenamiento en Safari; secretos y protección de ramas en repos privados Free. Señala también cálculos erróneos (sumas, porcentajes, tiempos a 0,4 peticiones/s) y afirmaciones presentadas como hechos sin fuente. Revisa además la lista «afirmaciones_sin_verificar» de ${DATA}: verifica las que condicionan M0–M2 y propón el texto correcto (o «a verificar en M0» si no se puede comprobar hoy).`,
  },
  {
    key: 'coherencia', label: 'crítico: coherencia y completitud',
    lens: `COHERENCIA Y COMPLETITUD DEL DOCUMENTO COMO UN TODO. Lee todas las secciones en orden. Busca: contradicciones entre secciones (alcance de cada hito M0–M4, nombres de campos y tablas, rutas, nombres de ficheros del catálogo, cifras, presupuestos, versiones, estados y marcas, niveles de ranking, superficies de captura, quién hace qué en la micro-API); desviaciones respecto a DECISIONES.md; términos que no siguen el glosario (DECISIONES §7) o que usan P0/P1/P2; referencias cruzadas «(ver §N)» que apuntan a la sección equivocada o a algo que no está; contenido duplicado que debería remitir a su sección hogar; huecos (requisitos del usuario sin cubrir, puntos del índice sin desarrollar, decisiones sin justificar, funciones mencionadas sin hito). Cuando dos secciones discrepan, di cuál debe cambiar según DECISIONES.md y cómo.`,
  },
  {
    key: 'implementabilidad', label: 'crítico: implementabilidad',
    lens: `IMPLEMENTABILIDAD PARA UN SOLO DESARROLLADOR EN ESTE PC (Windows 11, Node 24.21, npm 11.19, git, Rust; sin Docker, Python ni PostgreSQL). Ponte en su lugar: ¿podría empezar M0 y M1 mañana solo con este documento, sin adivinar? Señala especificaciones que faltan o son ambiguas (formatos, algoritmos, mensajes del Worker, esquema Dexie, comandos, criterios de aceptación no medibles), pasos imposibles o caros en este PC, dependencias entre hitos mal ordenadas, estimaciones irreales, sobreingeniería para un prototipo (y qué recortar) y riesgos técnicos no tratados en el camino crítico (apuntar un juego en <3 s, búsqueda ≤50 ms, catálogo completo). Cada hallazgo debe proponer la especificación o el recorte concreto.`,
  },
  {
    key: 'espanol', label: 'crítico: español y estilo',
    lens: `ESPAÑOL DE ESPAÑA Y ESTILO. Revisa la calidad del español (gramática, calcos del inglés, anglicismos innecesarios, frases largas o confusas, registro profesional e impersonal en el plan y tuteo en la microcopy), la terminología coherente según el glosario de DECISIONES §7 y la guía de estilo de DECISIONES §8: comillas «», coma decimal, espacio como separador de millares, unidades con espacio, nombres de teclas del teclado español (Intro, Mayús, Supr), identificadores técnicos entre comillas invertidas, encabezados «## N.» / «### N.M», tablas bien formadas, Mermaid válido, wireframes de ≤78 columnas y la lista de referencias internas PROHIBIDAS en el texto (T1–T4, línea/track, juez, brief, borrador, workflow, agente, DECISIONES.md, rutas temporales o de scratchpad). Da el texto corregido en cada hallazgo.`,
  },
]

const criticPrompt = c => `${COMMON}
TU PAPEL: crítico exigente con este criterio:
${c.lens}

Lee primero ${DEC} y después TODAS las secciones de ${OUT} en este orden: ${BODY_FILES.join(', ')}. No modifiques ningún fichero.
Devuelve hallazgos concretos y accionables, cada uno con el fichero, una cita exacta para localizarlo, la gravedad, el problema, la corrección y la evidencia. Prioriza lo que importa (lo que llevaría a construir algo mal o a una decisión errónea); no inventes problemas y no pidas más extensión salvo que falte algo necesario. Como mucho 40 hallazgos, ordenados de más a menos grave.`

const SUMMARY_PROMPT = `${COMMON}
TU TAREA: escribir dos ficheros en ${OUT}:
1. 01-resumen.md — «## 1. Resumen ejecutivo» (≤4 KB, legible por sí solo en dos minutos): qué es GameAgenda y para quién; la apuesta (PWA local-first: apuntar en <3 s sin red y búsqueda instantánea en los ≈196 600 juegos de Steam); cómo se obtiene el catálogo; arquitectura y stack en una tabla breve; hitos M0–M4 con su resultado y esfuerzo; coste; principales riesgos y lo que se necesita del usuario. Remite a las secciones con «(ver §N)».
2. 19-referencias.md — «## 19. Referencias» (≤6 KB): fuentes externas agrupadas (Steam y Valve; normativa y privacidad; plataformas y hosting; librerías y herramientas; otras fuentes de datos de juegos), cada una con título y URL, sin duplicados y solo URLs reales que aparezcan en las secciones o en la investigación. Al final, una línea sobre la documentación de trabajo que acompaña al plan, si se conserva («docs/planificacion/: investigación y decisiones del 28-10-2026»).
Lee primero ${DEC} y todas las secciones de ${OUT} (${BODY_FILES.join(', ')}).
Las referencias que han declarado los redactores están en el campo «referencias» de ${DATA}; complétalas con las URL que aparezcan en las secciones.
Sigue la guía de estilo de DECISIONES §8 (sin referencias internas del proceso). Escribe SOLO esos dos ficheros.`

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: { files_written: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } },
  required: ['files_written', 'notes'],
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    applied: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, what: { type: 'string' } }, required: ['file', 'what'] } },
    rejected: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, finding: { type: 'string' }, reason: { type: 'string' } }, required: ['file', 'finding', 'reason'] } },
    cross_section_issues: { type: 'array', items: { type: 'string' }, description: 'Problemas que exigen cambiar ficheros que no son tuyos' },
  },
  required: ['applied', 'rejected', 'cross_section_issues'],
}

const fixPrompt = (g, findings) => `${COMMON}
TU PAPEL: corrector de ${g.files.join(', ')} (en ${OUT}). Solo puedes modificar esos ficheros (herramienta Edit; Write solo si hay que reescribir una subsección entera).
Abajo tienes los hallazgos de varios críticos sobre tus ficheros. Para CADA uno:
1. Verifícalo: ¿es correcto según DECISIONES.md, la investigación de ${PLAN}\\investigacion y la lógica? Si hace falta, comprueba con WebSearch/WebFetch (ToolSearch "select:WebSearch,WebFetch"). Si dos hallazgos chocan, manda DECISIONES.md y después la evidencia más sólida.
2. Si es correcto, aplícalo con el cambio mínimo que lo resuelva (manteniendo estilo, cifras canónicas y referencias cruzadas). Si no lo es, recházalo y di por qué.
3. Si exige cambiar un fichero que no es tuyo, no lo toques: anótalo en cross_section_issues.
Al terminar, relee tus ficheros completos y comprueba que siguen bien formados (encabezados, tablas, Mermaid, wireframes ≤78 columnas) y que no aparecen referencias internas prohibidas.
Los datos de detalle que han fijado las demás secciones están en el campo «datos_de_detalle» de ${DATA}: respétalos salvo que choquen con DECISIONES.md (incluida su §10), que manda.
HALLAZGOS (JSON):
${JSON.stringify(findings)}`

const FINAL_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', description: 'listo | listo con retoques | no listo' },
    remaining_issues: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, quote: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['file', 'quote', 'problem', 'fix'] } },
  },
  required: ['verdict', 'remaining_issues'],
}

phase('Revisión')
const [summaryRes, ...criticRes] = await parallel([
  () => agent(SUMMARY_PROMPT, { label: 'redactor: §1 resumen + §19 referencias', phase: 'Revisión', schema: SUMMARY_SCHEMA }),
  ...CRITICS.map(c => () => agent(criticPrompt(c), { label: c.label, phase: 'Revisión', schema: FINDINGS_SCHEMA }).then(r => (r ? { critic: c.key, ...r } : null))),
])
const critics = criticRes.filter(Boolean)
log(`${critics.length}/4 críticos; ${critics.reduce((n, c) => n + c.findings.length, 0)} hallazgos; §1/§19: ${summaryRes ? 'escritos' : 'FALLÓ'}`)

const norm = f => (f || '').replace(/^.*[\\/]/, '').trim()
const byGroup = GROUPS.map(g => ({
  g,
  findings: critics.flatMap(c => c.findings.filter(f => g.files.includes(norm(f.file))).map(f => ({ critic: c.critic, ...f, file: norm(f.file) }))),
}))
const orphan = critics.flatMap(c => c.findings.filter(f => !ALL_FILES.includes(norm(f.file))).map(f => ({ critic: c.critic, ...f })))
if (orphan.length) log(`${orphan.length} hallazgos sin fichero reconocible (se devuelven aparte)`)

phase('Corrección')
const fixes = await parallel(byGroup.filter(x => x.findings.length).map(x => () =>
  agent(fixPrompt(x.g, x.findings), { label: `corrector: ${x.g.files.join(' + ')}`, phase: 'Corrección', schema: FIX_SCHEMA })
    .then(r => (r ? { group: x.g.key, files: x.g.files, findings: x.findings.length, ...r } : null))))

phase('Comprobación')
const finalCheck = await agent(`${COMMON}
TU PAPEL: lector final. Lee ${DEC} y después TODAS las secciones de ${OUT} en orden (${ALL_FILES.join(', ')}) como si fueran un único documento. Busca solo problemas que sigan presentes: contradicciones entre secciones, cifras o nombres incoherentes, referencias «(ver §N)» rotas, encabezados mal numerados, Mermaid o tablas rotas, referencias internas prohibidas y huecos graves frente a lo que pidió el usuario. No modifiques ficheros. Como mucho 25 problemas, de más a menos grave.`, { label: 'lector final', phase: 'Comprobación', schema: FINAL_SCHEMA })

return { summary: summaryRes, critics: critics.map(c => ({ critic: c.critic, summary: c.summary, n: c.findings.length })), fixes: fixes.filter(Boolean), orphan, finalCheck }
