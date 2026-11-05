// Prueba del trofeo de Platinado y de la chincheta roja de Próximo (rediseño visual).
//
//   node docs/diseno/rediseno-visual/iconos-marcas.mjs <salida.html>
//
// El trofeo es un dibujo propio con la forma clásica de los trofeos de PlayStation (copa ancha,
// asas en bucle, tallo corto y peana de dos alturas), no el de Sony. La chincheta es la
// «push-pin» de Phosphor 2.1.1 (MIT) partida en cabeza y aguja.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const TROPHY = {
  bowl: 'M5.5 3h13v3.25c0 3.7-2.6 6.75-6.1 7.2h-.8C8.1 13 5.5 9.95 5.5 6.25z',
  handles:
    'M5.6 4.6H4.25A1.75 1.75 0 0 0 2.5 6.35c0 2.6 2.1 4.6 4.6 4.9M18.4 4.6h1.35a1.75 1.75 0 0 1 1.75 1.75c0 2.6-2.1 4.6-4.6 4.9',
  stem: 'M11 13.3h2l.35 3.2h-2.7z',
  collar: 'M9.75 16.4h4.5a.6.6 0 0 1 .6.6v.5h-5.7v-.5a.6.6 0 0 1 .6-.6z',
  base: 'M6.75 17.9h10.5a.75.75 0 0 1 .75.75v1.85a.75.75 0 0 1-.75.75H6.75a.75.75 0 0 1-.75-.75v-1.85a.75.75 0 0 1 .75-.75z',
  shine: 'M7.6 4.4h1.5v1.9c0 2.3.9 4.3 2.4 5.6-2.4-.5-3.9-2.9-3.9-5.6z',
  baseShine: 'M7.4 18.75h3.2v.7H7.4z',
  // Sombra a la derecha de la copa y de la peana: con el brillo a la izquierda, el volumen del metal.
  shade: 'M15.1 3.9h2.5v2.35c0 3.05-1.95 5.6-4.8 6.45 1.45-1.65 2.3-3.95 2.3-6.45z',
  baseShade: 'M14.6 18.75h2.6v1.75h-2.6z',
};

export const PIN = {
  head: 'M235.33,104l-53.47,53.65c4.56,12.67,6.45,33.89-13.19,60A15.93,15.93,0,0,1,157,224c-.38,0-.75,0-1.13,0a16,16,0,0,1-11.32-4.69L96.29,171,85,159.71l-48.3-48.3A16,16,0,0,1,38,87.63c25.42-20.51,49.75-16.48,60.4-13.14L152,20.7a16,16,0,0,1,22.63,0l60.69,60.68A16,16,0,0,1,235.33,104Z',
  needle: 'M90.6 165.4 46 210',
  shine: 'M165 40a14 14 0 1 1 0 .1z',
};

const trophy = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
  <path class="t-body" d="${TROPHY.bowl}"/><path class="t-handle" d="${TROPHY.handles}"/>
  <path class="t-body" d="${TROPHY.stem}"/><path class="t-body" d="${TROPHY.collar}"/><path class="t-body" d="${TROPHY.base}"/>
  <path class="t-shade" d="${TROPHY.shade}"/><path class="t-shade" d="${TROPHY.baseShade}"/><path class="t-shine" d="${TROPHY.shine}"/><path class="t-shine" d="${TROPHY.baseShine}"/></svg>`;

const pin = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><g transform="scale(.09375)">
  <path class="p-needle" d="${PIN.needle}" stroke-width="18" stroke-linecap="round" fill="none"/>
  <path class="p-head" d="${PIN.head}"/><path class="p-shine" d="${PIN.shine}"/></g></svg>`;

const block = (theme) => `<section class="theme theme--${theme}">
  <h2>${theme === 'light' ? 'Claro' : 'Oscuro'}</h2>
  <div class="row">
    <div class="on">${trophy}${trophy}${trophy}${trophy}</div>
    <div class="on next">${pin}${pin}${pin}${pin}</div>
  </div>
  <div class="row ctx">
    <span class="badge on">${trophy}Platinado</span>
    <span class="badge on next">${pin}Próximo</span>
    <span class="chip-on on">${trophy}Platinado</span>
    <span class="chip-on on next">${pin}Próximo</span>
    <span class="off">${trophy} sin marcar</span>
    <span class="off">${pin} sin marcar</span>
  </div>
</section>`;

writeFileSync(
  resolve(process.argv[2] ?? '.cache/rediseno/iconos-marcas.html'),
  `<!doctype html><html lang="es"><meta charset="utf-8"><title>Rediseño · Platinado y Próximo</title>
<style>
  body { margin: 0; padding: 20px; background: #f6f6f7; font: 14px/1.5 "Segoe UI Variable Text", system-ui, sans-serif; }
  .theme { padding: 16px 20px; border-radius: 14px; margin-bottom: 16px; }
  .theme--light { background: #fff; color: #18181b; border: 1px solid #e4e4e8;
    --platinum: #56657a; --platinum-chip: #eceff4; --platinum-metal: #7a8ba2; --platinum-shade: #56657a; --platinum-shine: #eef3f9;
    --next: #c4272f; --next-chip: #fbe9ea; --muted: #5e5e68; --line: #e4e4e8; }
  .theme--dark { background: #161618; color: #f4f4f5; border: 1px solid #27272b;
    --platinum: #c9d4e2; --platinum-chip: #2a2f37; --platinum-metal: #b4c1d2; --platinum-shade: #8494aa; --platinum-shine: #f7f9fc;
    --next: #ff6b6b; --next-chip: #3a2224; --muted: #a1a1aa; --line: #27272b; }
  h2 { font-size: 12px; margin: 0 0 8px; opacity: .7; }
  .row { display: flex; align-items: end; gap: 28px; margin-bottom: 12px; }
  .row > div { display: flex; align-items: end; gap: 18px; }
  .row > div .icon:nth-child(1) { width: 120px; height: 120px; }
  .row > div .icon:nth-child(2) { width: 40px; height: 40px; }
  .row > div .icon:nth-child(3) { width: 18px; height: 18px; }
  .row > div .icon:nth-child(4) { width: 14px; height: 14px; }
  .ctx { align-items: center; gap: 16px; flex-wrap: wrap; }
  .ctx .icon { width: 14px; height: 14px; }
  .badge, .chip-on, .off { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
  .chip-on { padding: 4px 12px; border-radius: 999px; font-size: 14px; font-weight: 600; color: var(--platinum); background: var(--platinum-chip); border: 1px solid var(--platinum); }
  .chip-on.next { color: var(--next); background: var(--next-chip); border-color: var(--next); }
  .chip-on .icon { width: 18px; height: 18px; }
  /* Sin marcar: todo en el color del texto, sin brillos. */
  .t-body { fill: var(--t-body, currentColor); }
  .t-handle { fill: none; stroke: var(--t-body, currentColor); stroke-width: 1.6; stroke-linecap: round; }
  .t-shine { fill: var(--t-shine, transparent); }
  .t-shade { fill: var(--t-shade, transparent); }
  .p-head { fill: var(--p-head, currentColor); }
  .p-needle { stroke: var(--p-needle, currentColor); }
  .p-shine { fill: var(--p-shine, transparent); }
  /* Con la marca puesta: platino y rojo. */
  .on { --t-body: var(--platinum-metal); --t-shade: var(--platinum-shade); --t-shine: var(--platinum-shine); }
  .on.next { --p-head: var(--next); --p-needle: var(--muted); --p-shine: rgb(255 255 255 / .5); }
  .off { color: var(--muted); }
</style>
${block('light')}${block('dark')}
</html>`,
);
