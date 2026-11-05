// Página que compara solo cómo se muestra el estado en la fila: el actual y las tres opciones.
//   node docs/diseno/rediseno-visual/estado.mjs [carpeta de las capturas]
// Usa las capturas de `scripts/rediseno-capturas.ts` (variantes `despues` y `estado-*`).

import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.cache/rediseno');
const variants = [
  ['despues', 'Ahora', 'Píldora con borde, icono, texto y flecha; en el móvil, un círculo.'],
  [
    'estado-etiqueta',
    '1 · Etiqueta',
    'Como Notion o Jira: pequeña, tintada, sin borde; la flecha, solo con el puntero.',
  ],
  [
    'estado-punto',
    '2 · Punto',
    'Como GitHub Projects: punto de color y texto en gris, sin caja hasta pasar el puntero.',
  ],
  [
    'estado-izquierda',
    '3 · A la izquierda',
    'Como Linear o Things: el icono delante de la portada, como una casilla; la derecha, limpia.',
  ],
];
const shots = [
  ['light-1100-todos', 'Escritorio, claro'],
  ['dark-1100-todos', 'Escritorio, oscuro'],
  ['light-390-lista', 'Móvil, claro'],
  ['dark-390-lista', 'Móvil, oscuro'],
];

const rows = shots
  .map(
    ([file, title]) =>
      `<h2>${title}</h2><div class="grid">${variants
        .filter(([v]) => existsSync(join(root, v, `${file}.png`)))
        .map(
          ([v, name]) =>
            `<figure><figcaption>${name}</figcaption><a href="${v}/${file}.png"><img src="${v}/${file}.png" alt="${name}, ${title}" loading="lazy"></a></figure>`,
        )
        .join('')}</div>`,
  )
  .join('\n');

writeFileSync(
  join(root, 'estado.html'),
  `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rediseño · el estado en la fila</title>
<style>
  body { margin: 0; padding: 24px 16px 48px; background: #f6f6f7; color: #18181b; font: 15px/1.5 "Segoe UI Variable Text", system-ui, sans-serif; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 8px; }
  ul { margin: 0 0 20px; padding-left: 20px; color: #5e5e68; font-size: 13px; }
  h2 { font-size: 13px; font-weight: 600; color: #5e5e68; margin: 24px 0 10px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 14px; align-items: start; }
  figure { margin: 0; }
  figcaption { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  img { width: 100%; height: auto; display: block; border: 1px solid #e4e4e8; border-radius: 10px; }
</style>
<h1>El estado en la fila · tres opciones</h1>
<ul>${variants.map(([, name, note]) => `<li><strong>${name}:</strong> ${note}</li>`).join('')}</ul>
${rows}
</html>`,
);
console.log(`Estado: ${join(root, 'estado.html')}`);
