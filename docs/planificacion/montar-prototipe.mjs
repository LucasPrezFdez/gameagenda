// Monta prototipe.md a partir de docs/planificacion/secciones/NN-*.md y hace un lint básico.
// Uso (desde la raíz del repo): node docs/planificacion/montar-prototipe.mjs . [--write]
// Sin --write solo informa; con --write sobrescribe prototipe.md. Avisos de «workflow» en identificadores
// técnicos (workflow_run, .github/workflows/, URL) son esperables.
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2]
const write = process.argv.includes('--write')
const dir = path.join(root, 'docs', 'planificacion', 'secciones')
const files = fs.readdirSync(dir).filter(f => /^\d\d-.*\.md$/.test(f)).sort()

const FORBIDDEN = [
  /\bT[1-4]\b/, /\btracks?\b/i, /\bjuez(es)?\b/i, /\bbrief\b/i, /\bborradores?\b/i, /\bworkflows?\b/i,
  /\bagentes?\b/i, /DECISIONES\.md/, /scratchpad/i, /AppData/i, /\bP[0-2]\b/, /lineas-paralelas|panel-arquitectura/,
]

// github-slugger simplificado: minúsculas, quita lo que no sea letra/número/espacio/guion, espacios → guiones.
const slug = h => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-')

const report = []
const toc = []
const parts = []
const expected = Array.from({ length: 19 }, (_, i) => String(i + 1).padStart(2, '0'))
const present = files.map(f => f.slice(0, 2))
for (const n of expected) if (!present.includes(n)) report.push(`FALTA la sección ${n}`)

for (const f of files) {
  const n = Number(f.slice(0, 2))
  let text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim()
  const lines = text.split('\n')
  const h2 = lines.filter(l => /^## /.test(l))
  if (!lines[0].startsWith(`## ${n}. `)) report.push(`${f}: la primera línea no es «## ${n}. …» → ${JSON.stringify(lines[0].slice(0, 60))}`)
  if (h2.length !== 1) report.push(`${f}: ${h2.length} encabezados de nivel 2 (debe haber 1)`)
  for (const l of lines.filter(l => /^### /.test(l))) {
    if (!new RegExp(`^### ${n}\\.\\d+ `).test(l)) report.push(`${f}: subsección mal numerada → ${l.slice(0, 70)}`)
  }
  { let c = false; for (const l of lines) { if (/^```/.test(l)) c = !c; else if (!c && /^# /.test(l)) report.push(`${f}: contiene un título de nivel 1`) } }
  // lint de bloques de código
  let inCode = false, lang = '', start = 0
  lines.forEach((l, i) => {
    const m = l.match(/^```(\S*)/)
    if (m) {
      if (!inCode) { inCode = true; lang = m[1]; start = i + 1 } else { inCode = false }
      return
    }
    if (inCode && (lang === '' || lang === 'text') && [...l].length > 78) report.push(`${f}:${i + 1}: línea de ${[...l].length} columnas en bloque ${lang || 'sin lenguaje'}`)
  })
  if (inCode) report.push(`${f}: bloque de código sin cerrar (abierto en la línea ${start})`)
  lines.forEach((l, i) => {
    if (/^```|^\s{4}/.test(l)) return
    for (const re of FORBIDDEN) if (re.test(l)) report.push(`${f}:${i + 1}: término prohibido ${re} → ${l.trim().slice(0, 90)}`)
  })
  toc.push(`${n}. [${lines[0].replace(/^## \d+\.\s*/, '')}](#${slug(lines[0].replace(/^## /, ''))})`)
  parts.push(text)
  report.push(`ok ${f}: ${Buffer.byteLength(text)} B, ${lines.length} líneas`)
}

const header = `# GameAgenda — Plan del prototipo

**Versión:** 0.2 · **Fecha:** 29-10-2026 · **Estado:** listo para empezar el hito M0

> Plan profesional para construir el prototipo de GameAgenda: una agenda para apuntar en segundos los juegos que quieres jugar y llevar su estado (completado, platinado, comprado…), empezando por el catálogo completo de Steam. Las decisiones se tomaron tras investigar y verificar las APIs de Steam, medir la búsqueda en este PC y comparar tres arquitecturas.

## Índice

${toc.join('\n')}
`
const doc = header + '\n' + parts.join('\n\n') + '\n'
if (write) fs.writeFileSync(path.join(root, 'prototipe.md'), doc)
console.log(report.join('\n'))
console.log(`TOTAL ${Buffer.byteLength(doc)} B${write ? ' → prototipe.md escrito' : ' (sin escribir)'}`)
