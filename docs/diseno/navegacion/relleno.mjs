// Página que compara cómo llenar la barra lateral del PC (debajo de las secciones): vacía,
// «Todo junto» y «Solo Jugando ahora», y la barra encogida. Usa las capturas de
// `scripts/rediseno-capturas.ts` (variantes `nav-nueva`, `nav-encogida` y `relleno-*`).
//   node docs/diseno/navegacion/relleno.mjs [carpeta de las capturas]

import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.cache/rediseno');
const variants = [
  ['nav-nueva', 'Ahora: vacía', 'Las tres secciones y, debajo, nada.'],
  [
    'relleno-todo',
    '1 · Todo junto',
    'Vistas con su contador (como Things), «Jugando ahora» y «A continuación» con portadas (como Spotify o Steam) y un pie con los atajos y el catálogo. Las pestañas de arriba de Mi lista se van a la barra.',
  ],
  [
    'relleno-jugando',
    '2 · Solo Jugando ahora',
    'Las secciones y, debajo, las portadas de lo que se juega y lo siguiente. Las pestañas de arriba se quedan.',
  ],
  [
    'relleno-encogida',
    'Encogida, con portadas',
    'El riel de 64 px enseña también las portadas, con el nombre al pasar el puntero.',
  ],
];
const shots = [
  ['light-1440-lista', 'Mi lista, claro, 1 440 px'],
  ['dark-1440-lista', 'Mi lista, oscuro, 1 440 px'],
  ['light-1100-catalogo', 'Catálogo, claro, 1 100 px'],
  ['dark-1100-lista', 'Mi lista, oscuro, 1 100 px'],
];
const rows = shots
  .map(([file, title]) => {
    const cells = variants
      .filter(([v]) => existsSync(join(root, v, `${file}.png`)))
      .map(
        ([v, name]) =>
          `<figure><figcaption>${name}</figcaption><a href="${v}/${file}.png"><img src="${v}/${file}.png" alt="${name}, ${title}" loading="lazy"></a></figure>`,
      )
      .join('');
    return cells ? `<h2>${title}</h2><div class="grid">${cells}</div>` : '';
  })
  .join('\n');
writeFileSync(
  join(root, 'relleno.html'),
  `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rediseño · barra lateral</title>
<style>
  body { margin: 0; padding: 24px 16px 48px; background: #f6f6f7; color: #18181b; font: 15px/1.5 "Segoe UI Variable Text", system-ui, sans-serif; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 8px; }
  ul { margin: 0 0 20px; padding-left: 20px; color: #5e5e68; font-size: 13px; max-width: 90ch; }
  h2 { font-size: 13px; font-weight: 600; color: #5e5e68; margin: 24px 0 10px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: 14px; align-items: start; }
  figure { margin: 0; }
  figcaption { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  img { width: 100%; height: auto; display: block; border: 1px solid #e4e4e8; border-radius: 10px; }
</style>
<h1>Qué poner en la barra lateral · dos opciones</h1>
<ul>${variants.map(([, name, note]) => `<li><strong>${name}:</strong> ${note}</li>`).join('')}</ul>
${rows}
</html>`,
);
console.log(`Relleno: ${join(root, 'relleno.html')}`);
