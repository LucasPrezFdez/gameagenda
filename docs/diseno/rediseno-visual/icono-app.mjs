// Opciones del icono de la app (rediseño visual). Escribe un SVG por opción y una página que las
// enseña a 160, 64, 32 y 16 px sobre fondo claro y oscuro, en una pestaña y en una barra de tareas.
//
//   node docs/diseno/rediseno-visual/icono-app.mjs <carpeta de salida>
//
// El marcapáginas y el play son las formas de Phosphor Icons 2.1.1 («bookmark-simple» y «play»,
// licencia MIT), en su rejilla de 256: así el icono casa con los de la interfaz.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? '.cache/rediseno/icono-app');
mkdirSync(out, { recursive: true });

const BOOKMARK =
  'M184,32H72A16,16,0,0,0,56,48V224a8,8,0,0,0,12.24,6.78L128,193.43l59.77,37.35A8,8,0,0,0,200,224V48A16,16,0,0,0,184,32Z';
const PLAY =
  'M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3L232.4,114.49A15.74,15.74,0,0,1,240,128Z';

// El play se centra por su centroide (≈122,7 · 128 en la rejilla), no por su caja: así parece
// centrado a la vista.
const playAt = (scale, cx, cy) =>
  `translate(${(cx - 122.7 * scale).toFixed(1)} ${(cy - 128 * scale).toFixed(1)}) scale(${scale})`;

const tile = (bg) => `<rect width="256" height="256" rx="56" fill="${bg}"/>`;
/** Filo claro y sutil: sin él, un cuadrado de tinta desaparece en una barra de tareas oscura. */
const rim =
  '<rect x="3" y="3" width="250" height="250" rx="53" fill="none" stroke="#ffffff" stroke-opacity=".18" stroke-width="6"/>';

/** Marcapáginas blanco con el play recortado (del color del fondo). */
const bookmarkGlyph = (bg) => `
  <path d="${BOOKMARK}" fill="#ffffff" transform="translate(35.7 29) scale(.72)"/>
  <path d="${PLAY}" fill="${bg}" transform="${playAt(0.2, 128, 108)}"/>`;

export const OPTIONS = {
  tinta: {
    name: 'Tinta',
    note: 'Cuadrado de tinta y marcapáginas blanco con un play recortado. La dirección B pura.',
    svg: `${tile('#18181b')}${rim}${bookmarkGlyph('#18181b')}`,
  },
  rosa: {
    name: 'Rosa',
    note: 'El mismo motivo sobre el rosa de siempre, algo más hondo. Conserva la identidad fuera de la app.',
    svg: `${tile('#b3255d')}${bookmarkGlyph('#b3255d')}`,
  },
  cinta: {
    name: 'Cinta',
    note: 'Tinta, un play blanco y una cinta rosa que cuelga del borde, como el marcapáginas de un libro.',
    svg: `${tile('#18181b')}${rim}
  <path d="M164 0h34v92l-17-12-17 12z" fill="#e2507f"/>
  <path d="${PLAY}" fill="#ffffff" transform="${playAt(0.44, 124, 136)}"/>`,
  },
};

const svgDoc = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><title>GameAgenda</title>${inner}</svg>`;

for (const [id, option] of Object.entries(OPTIONS)) {
  writeFileSync(join(out, `${id}.svg`), svgDoc(option.svg));
}

const sizes = [160, 64, 32, 16];
const card = (id, option, theme) => `
<figure class="card card--${theme}">
  <figcaption><strong>${option.name}</strong> · ${theme === 'light' ? 'fondo claro' : 'fondo oscuro'}</figcaption>
  <div class="sizes">${sizes.map((s) => `<img src="${id}.svg" width="${s}" height="${s}" alt="">`).join('')}</div>
  <div class="tab"><img src="${id}.svg" width="16" height="16" alt="">GameAgenda — Mi lista</div>
  <div class="taskbar">${['#3b82f6', '#22c55e', '#f59e0b']
    .map((c) => `<span class="dummy" style="background:${c}"></span>`)
    .join('')}<img src="${id}.svg" width="24" height="24" alt=""></div>
  <p>${option.note}</p>
</figure>`;

writeFileSync(
  join(out, 'index.html'),
  `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rediseño · icono de la app</title>
<style>
  body { margin: 0; padding: 24px 16px 48px; background: #f6f6f7; color: #18181b; font: 15px/1.5 "Segoe UI Variable Text", system-ui, sans-serif; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 16px; }
  .card { margin: 0; padding: 16px; border-radius: 14px; display: grid; gap: 12px; }
  .card--light { background: #ffffff; border: 1px solid #e4e4e8; }
  .card--dark { background: #161618; color: #f4f4f5; border: 1px solid #27272b; }
  figcaption { font-size: 13px; }
  .sizes { display: flex; align-items: end; gap: 20px; }
  .tab { display: inline-flex; align-items: center; gap: 8px; width: max-content; padding: 6px 14px; border-radius: 8px 8px 0 0; font-size: 12px; }
  .card--light .tab { background: #eef0f3; } .card--dark .tab { background: #2b2b30; }
  .taskbar { display: flex; gap: 14px; align-items: center; padding: 8px 14px; border-radius: 10px; width: max-content; }
  .card--light .taskbar { background: #e9ecf2; } .card--dark .taskbar { background: #202024; }
  .dummy { width: 24px; height: 24px; border-radius: 6px; opacity: .85; }
  p { margin: 0; font-size: 13px; opacity: .8; }
</style>
<h1>Icono de la app · tres opciones</h1>
<div class="grid">
${Object.entries(OPTIONS)
  .map(([id, option]) => card(id, option, 'light') + card(id, option, 'dark'))
  .join('')}
</div>
</html>`,
);
console.log(`Opciones del icono: ${join(out, 'index.html')}`);
