// Página que compara la navegación entre Mi lista, Catálogo y Ajustes: la de ahora y las dos
// opciones. Usa las capturas de `scripts/rediseno-capturas.ts` (variantes `nav-*`).
//   node docs/diseno/navegacion/navegacion.mjs [carpeta de las capturas]

import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.cache/rediseno');
const variants = [
  [
    'nav-ahora',
    'Ahora',
    'Barra lateral de 200 px para tres secciones; en el móvil, pestañas y buscador apilados abajo.',
  ],
  [
    'nav-pestanas',
    '1 · Pestañas arriba y barra flotante',
    'Escritorio como GitHub o Vercel: pestañas en la cabecera y el contenido centrado. Móvil como iOS 26: cápsula flotante y el buscador como botón redondo aparte.',
  ],
  [
    'nav-lateral',
    '2 · Barra lateral y Material 3',
    'Escritorio como Linear o Notion: barra lateral de altura completa con la marca y el buscador arriba. Móvil como Material 3: barra con la píldora detrás del icono activo y un botón flotante «Apunta un juego…».',
  ],
];
const shots = [
  ['light-1440-lista', 'Escritorio, Mi lista, claro'],
  ['dark-1100-catalogo', 'Escritorio, Catálogo, oscuro'],
  ['light-1100-ajustes', 'Escritorio, Ajustes, claro'],
  ['light-390-lista', 'Móvil, Mi lista, claro'],
  ['dark-390-lista', 'Móvil, Mi lista, oscuro'],
  ['light-390-catalogo', 'Móvil, Catálogo, claro'],
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
  join(root, 'navegacion.html'),
  `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rediseño · navegación</title>
<style>
  body { margin: 0; padding: 24px 16px 48px; background: #f6f6f7; color: #18181b; font: 15px/1.5 "Segoe UI Variable Text", system-ui, sans-serif; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 8px; }
  ul { margin: 0 0 20px; padding-left: 20px; color: #5e5e68; font-size: 13px; max-width: 90ch; }
  h2 { font-size: 13px; font-weight: 600; color: #5e5e68; margin: 24px 0 10px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 14px; align-items: start; }
  figure { margin: 0; }
  figcaption { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  img { width: 100%; height: auto; display: block; border: 1px solid #e4e4e8; border-radius: 10px; }
</style>
<h1>Navegación entre Mi lista, Catálogo y Ajustes · dos opciones</h1>
<ul>${variants.map(([, name, note]) => `<li><strong>${name}:</strong> ${note}</li>`).join('')}</ul>
${rows}
</html>`,
);
console.log(`Navegación: ${join(root, 'navegacion.html')}`);
