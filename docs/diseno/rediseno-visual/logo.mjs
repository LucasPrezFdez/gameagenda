// Logo de la app, segunda ronda (rediseño visual): opciones en la paleta de la dirección B.
//
//   node docs/diseno/rediseno-visual/logo.mjs <carpeta de salida>
//
// Escribe un SVG por opción (con esquinas, para Windows, la PWA y el favicon) y su versión a sangre
// (sin esquinas: iOS y la «maskable» de Android ponen las suyas), y una página que las prueba a
// varios tamaños, en la barra de tareas y en una pestaña claras y oscuras, en el recorte redondo de
// Android y en la cabecera de la app.
//
// Sigue las guías de Microsoft (learn.microsoft.com/windows/apps/design/style/iconography/app-icon-design)
// y Apple (HIG, App icons): una metáfora literal (como mucho dos), sin texto, silueta simple, degradados
// de uno o dos pasos con la luz arriba a la izquierda (120°) y al menos la mitad del icono a ≥3:1
// sobre fondo claro y oscuro. El marcapáginas y el play son las formas de Phosphor Icons 2.1.1 (MIT).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? '.cache/rediseno/logo');
mkdirSync(out, { recursive: true });

const BOOKMARK =
  'M184,32H72A16,16,0,0,0,56,48V224a8,8,0,0,0,12.24,6.78L128,193.43l59.77,37.35A8,8,0,0,0,200,224V48A16,16,0,0,0,184,32Z';
const PLAY =
  'M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3L232.4,114.49A15.74,15.74,0,0,1,240,128Z';

// Marcapáginas a 0,72, centrado (x 76–180, y 52–196: dentro de la zona segura de la «maskable»).
const BM = 'translate(35.7 29) scale(.72)';
// El play, centrado por su centroide (≈122,7 · 128 en su rejilla), no por su caja.
const playAt = (scale, cx, cy) =>
  `translate(${(cx - 122.7 * scale).toFixed(1)} ${(cy - 128 * scale).toFixed(1)}) scale(${scale})`;
const PLAY_IN_BOOKMARK = playAt(0.2, 128, 108);

/** Fondo: con esquinas (rx 56) o a sangre. `fill` puede ser un degradado. */
const tile = (fill, bleed) =>
  bleed
    ? `<rect width="256" height="256" fill="${fill}"/>`
    : `<rect width="256" height="256" rx="56" fill="${fill}"/>`;
/** Filo claro y sutil para los fondos oscuros, que si no desaparecen en una barra de tareas oscura. */
const rim = (bleed) =>
  bleed
    ? ''
    : '<rect x="3" y="3" width="250" height="250" rx="53" fill="none" stroke="#ffffff" stroke-opacity=".16" stroke-width="6"/>';
/** Degradado a 120°: de arriba a la izquierda hacia abajo a la derecha. */
const gradient = (id, from, to) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`;
/** Marcapáginas con el play hueco (deja ver el fondo, también si es un degradado). */
const bookmarkWithHole = (id, color) => `
  <mask id="${id}"><rect width="256" height="256" fill="#fff"/><path d="${PLAY}" fill="#000" transform="${PLAY_IN_BOOKMARK}"/></mask>
  <path d="${BOOKMARK}" fill="${color}" transform="${BM}" mask="url(#${id})"/>`;

export const OPTIONS = {
  grafito: {
    name: 'Grafito',
    note: 'Degradado de zinc oscuro y marcapáginas blanco con el play hueco. La B tal cual, con luz arriba a la izquierda.',
    svg: (bleed) =>
      `<defs>${gradient('g', '#46464f', '#18181b')}</defs>${tile('url(#g)', bleed)}${rim(bleed)}${bookmarkWithHole('m', '#ffffff')}`,
  },
  jugando: {
    name: 'Jugando',
    note: 'Tinta, marcapáginas blanco y el play en el verde de «Jugando». Un solo color, el de un estado.',
    svg: (bleed) => `${tile('#18181b', bleed)}${rim(bleed)}
  <path d="${BOOKMARK}" fill="#ffffff" transform="${BM}"/>
  <path d="${PLAY}" fill="#2fb87a" transform="${PLAY_IN_BOOKMARK}"/>`,
  },
  estados: {
    name: 'Estados',
    note: 'Tinta y un marcapáginas en cuatro franjas: Quiero jugar, Jugando, En pausa y Completado. El color de la app es el de los estados.',
    svg: (
      bleed,
    ) => `<defs><clipPath id="c"><path d="${BOOKMARK}" transform="${BM}"/></clipPath></defs>${tile('#18181b', bleed)}${rim(bleed)}
  <g clip-path="url(#c)">
    <rect x="70" y="46" width="116" height="40" fill="#5ab0ff"/>
    <rect x="70" y="86" width="116" height="36" fill="#3fcf8e"/>
    <rect x="70" y="122" width="116" height="36" fill="#ff9f43"/>
    <rect x="70" y="158" width="116" height="44" fill="#b395ff"/>
  </g>`,
  },
  platino: {
    name: 'Platino',
    note: 'Fondo platino metálico, como el trofeo de Platinado, y marcapáginas de tinta con el play hueco. Claro sobre la barra oscura y tinta sobre la clara.',
    svg: (bleed) => `<defs>${gradient('p', '#f5f8fc', '#a9b8cb')}</defs>${tile('url(#p)', bleed)}
  ${bleed ? '' : '<rect x="2" y="2" width="252" height="252" rx="54" fill="none" stroke="#ffffff" stroke-opacity=".7" stroke-width="4"/>'}
  ${bookmarkWithHole('m', '#18181b')}`,
  },
};

const svgDoc = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><title>GameAgenda</title>${inner}</svg>`;

for (const [id, option] of Object.entries(OPTIONS)) {
  writeFileSync(join(out, `${id}.svg`), svgDoc(option.svg(false)));
  writeFileSync(join(out, `${id}-sangre.svg`), svgDoc(option.svg(true)));
}

const dummies = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444']
  .map((c) => `<span class="dummy" style="background:${c}"></span>`)
  .join('');

const section = (id, option) => `
<section class="opt">
  <h2>${option.name}</h2>
  <p>${option.note}</p>
  <div class="sizes"><img src="${id}.svg" width="160" height="160" alt=""><img src="${id}.svg" width="64" height="64" alt=""><img src="${id}.svg" width="32" height="32" alt=""><img src="${id}.svg" width="16" height="16" alt=""></div>
  <div class="ctx">
    <div class="taskbar light">${dummies}<img src="${id}.svg" width="24" height="24" alt=""></div>
    <div class="taskbar dark">${dummies}<img src="${id}.svg" width="24" height="24" alt=""></div>
    <div class="tab light"><img src="${id}.svg" width="16" height="16" alt="">GameAgenda — Mi lista</div>
    <div class="tab dark"><img src="${id}.svg" width="16" height="16" alt="">GameAgenda — Mi lista</div>
    <div class="masks"><img class="round" src="${id}-sangre.svg" width="56" height="56" alt=""><img class="squircle" src="${id}-sangre.svg" width="56" height="56" alt=""></div>
    <div class="header light"><img src="${id}.svg" width="24" height="24" alt=""><strong>GameAgenda</strong></div>
    <div class="header dark"><img src="${id}.svg" width="24" height="24" alt=""><strong>GameAgenda</strong></div>
  </div>
</section>`;

writeFileSync(
  join(out, 'index.html'),
  `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rediseño · logo</title>
<style>
  body { margin: 0; padding: 24px 16px 48px; background: #f6f6f7; color: #18181b; font: 15px/1.5 "Segoe UI Variable Text", system-ui, sans-serif; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 4px; }
  .lead { margin: 0 0 20px; color: #5e5e68; max-width: 80ch; }
  .opt { background: #fff; border: 1px solid #e4e4e8; border-radius: 14px; padding: 16px 20px; margin-bottom: 16px; }
  h2 { font-size: 17px; font-weight: 600; margin: 0; }
  .opt > p { margin: 2px 0 12px; color: #5e5e68; font-size: 13px; }
  .sizes { display: flex; align-items: end; gap: 20px; margin-bottom: 14px; }
  .ctx { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; }
  .taskbar { display: flex; gap: 12px; align-items: center; padding: 8px 14px; border-radius: 10px; }
  .taskbar.light { background: #eef0f4; } .taskbar.dark { background: #1f1f1f; }
  .dummy { width: 24px; height: 24px; border-radius: 6px; opacity: .85; }
  .tab { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 8px 8px 0 0; font-size: 12px; }
  .tab.light { background: #eef0f3; } .tab.dark { background: #2b2b30; color: #f4f4f5; }
  .masks { display: flex; gap: 12px; padding: 8px 12px; border-radius: 12px; background: linear-gradient(135deg, #5b6cff, #b05bd6); }
  .round { border-radius: 50%; } .squircle { border-radius: 22%; }
  .header { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 10px; font-size: 15px; }
  .header.light { background: #f6f6f7; border: 1px solid #e4e4e8; } .header.dark { background: #0e0e10; color: #f4f4f5; }
</style>
<h1>Logo · cuatro opciones en la paleta de la B</h1>
<p class="lead">Cada una a 160, 64, 32 y 16 px; en la barra de tareas y en una pestaña, claras y oscuras; recortada en redondo (Android) y en «squircle» (iOS); y en la cabecera de la app.</p>
${Object.entries(OPTIONS)
  .map(([id, option]) => section(id, option))
  .join('')}
</html>`,
);
console.log(`Logo: ${join(out, 'index.html')}`);
