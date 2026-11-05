// Hoja de comparación de los iconos de estado y marcas (rediseño visual).
//
// Lee los SVG de colecciones profesionales descargadas con `npm pack` (Phosphor, Fluent UI
// System Icons, Tabler y Heroicons, todas MIT) como datos, sin ejecutar nada, y los pone junto a
// los de ahora (Lucide) y los propios, en los colores de estado, en claro y oscuro.
//
//   node scripts/rediseno-iconos.ts <carpeta de las descargas> [salida.html]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.argv[2];
if (!root) throw new Error('Falta la carpeta de las descargas');
const out = resolve(process.argv[3] ?? '.cache/rediseno/iconos.html');

const DIRS = {
  phosphor: join(root, '_phosphor-icons_core_2.1.1/package/assets'),
  fluent: join(root, '_fluentui_svg-icons_1.1.345/package/icons'),
  tabler: join(root, '_tabler_icons_3.50.0/package/icons/filled'),
  heroicons: join(root, 'heroicons_2.2.0/package/24/solid'),
};

type Concept =
  | 'want_to_play'
  | 'playing'
  | 'on_hold'
  | 'completed'
  | 'dropped'
  | 'platinum'
  | 'owned'
  | 'next';

const CONCEPTS: readonly [Concept, string][] = [
  ['want_to_play', 'Quiero jugar'],
  ['playing', 'Jugando'],
  ['on_hold', 'En pausa'],
  ['completed', 'Completado'],
  ['dropped', 'Abandonado'],
  ['platinum', 'Platinado'],
  ['owned', 'Comprado'],
  ['next', 'Próximo'],
];

/** Los de ahora (Lucide, trazo de 2 px). */
const LUCIDE: Record<Concept, string> = {
  want_to_play: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  playing: '<path d="M6 3l14 9-14 9z"/>',
  on_hold:
    '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  completed: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  dropped: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  platinum:
    '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.7V17c0 .6-.5 1-1 1.2C7.9 18.8 7 20.2 7 22"/><path d="M14 14.7V17c0 .6.5 1 1 1.2 1.1.6 2 2 2 3.8"/><path d="M18 2H6v7a6 6 0 0 0 12 0z"/>',
  owned:
    '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  next: '<path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2v.8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9a2 2 0 0 1-1.1-1.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
};

/** Los propios, macizos (los de `icons.tsx` en la rama). */
const OWN: Record<Concept, string> = {
  want_to_play:
    '<path fill="currentColor" d="M7.5 4h9a1 1 0 0 1 1 1v14.6a.5.5 0 0 1-.78.42L12 17.2l-4.72 2.82A.5.5 0 0 1 6.5 19.6V5a1 1 0 0 1 1-1z"/>',
  playing:
    '<path fill="currentColor" d="M8 5.5v13a.75.75 0 0 0 1.14.64l10.4-6.5a.75.75 0 0 0 0-1.28L9.14 4.86A.75.75 0 0 0 8 5.5z"/>',
  on_hold:
    '<rect fill="currentColor" x="7" y="5" width="3" height="14" rx="1"/><rect fill="currentColor" x="14" y="5" width="3" height="14" rx="1"/>',
  completed:
    '<path fill="currentColor" fill-rule="evenodd" stroke="none" d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM8.53 10.97 10.72 13.16 15.44 8.01A1.1 1.1 0 0 1 17.06 9.49L10.79 16.34 6.97 12.53A1.1 1.1 0 0 1 8.53 10.97z"/>',
  dropped:
    '<path fill="currentColor" fill-rule="evenodd" stroke="none" d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM8.98 7.42 16.58 15.02A1.1 1.1 0 0 1 15.02 16.58L7.42 8.98A1.1 1.1 0 0 1 8.98 7.42z"/>',
  platinum:
    '<path fill="currentColor" d="M8 4.5h8v4.25a4 4 0 0 1-8 0z"/><path d="M8 6.5H6.75a1.75 1.75 0 0 0 0 3.5H8.2M16 6.5h1.25a1.75 1.75 0 0 1 0 3.5H15.8M12 13v4"/><path fill="currentColor" d="M9 17.5h6v2H9z"/>',
  owned:
    '<path fill="currentColor" d="M6.5 9h11l-.7 9.6a1.5 1.5 0 0 1-1.5 1.4H8.7a1.5 1.5 0 0 1-1.5-1.4z"/><path d="M9.25 9V7.25a2.75 2.75 0 0 1 5.5 0V9"/>',
  next: '<path d="M8.5 4h7M12 12.5V20"/><path fill="currentColor" d="M10 4.5v4.2l-2.5 3.8h9L14 8.7V4.5z"/>',
};

const FILES: Record<string, Record<Concept, string | null>> = {
  'Phosphor · maciza': {
    want_to_play: 'fill/bookmark-simple-fill.svg',
    playing: 'fill/play-fill.svg',
    on_hold: 'fill/pause-fill.svg',
    completed: 'fill/check-circle-fill.svg',
    dropped: 'fill/prohibit-fill.svg',
    platinum: 'fill/trophy-fill.svg',
    owned: 'fill/handbag-fill.svg',
    next: 'fill/push-pin-fill.svg',
  },
  'Phosphor · bitono': {
    want_to_play: 'duotone/bookmark-simple-duotone.svg',
    playing: 'duotone/play-duotone.svg',
    on_hold: 'duotone/pause-duotone.svg',
    completed: 'duotone/check-circle-duotone.svg',
    dropped: 'duotone/prohibit-duotone.svg',
    platinum: 'duotone/trophy-duotone.svg',
    owned: 'duotone/handbag-duotone.svg',
    next: 'duotone/push-pin-duotone.svg',
  },
  'Fluent · maciza': {
    want_to_play: 'bookmark_24_filled.svg',
    playing: 'play_24_filled.svg',
    on_hold: 'pause_24_filled.svg',
    completed: 'checkmark_circle_24_filled.svg',
    dropped: 'prohibited_24_filled.svg',
    platinum: 'trophy_24_filled.svg',
    owned: 'shopping_bag_24_filled.svg',
    next: 'pin_24_filled.svg',
  },
  'Tabler · maciza': {
    want_to_play: 'bookmark.svg',
    playing: 'player-play.svg',
    on_hold: 'player-pause.svg',
    completed: 'circle-check.svg',
    dropped: 'circle-x.svg',
    platinum: 'trophy.svg',
    owned: null,
    next: 'pin.svg',
  },
  'Heroicons · maciza': {
    want_to_play: 'bookmark.svg',
    playing: 'play.svg',
    on_hold: 'pause.svg',
    completed: 'check-circle.svg',
    dropped: 'no-symbol.svg',
    platinum: 'trophy.svg',
    owned: 'shopping-bag.svg',
    next: null,
  },
};

const DIR_OF: Record<string, string> = {
  'Phosphor · maciza': DIRS.phosphor,
  'Phosphor · bitono': DIRS.phosphor,
  'Fluent · maciza': DIRS.fluent,
  'Tabler · maciza': DIRS.tabler,
  'Heroicons · maciza': DIRS.heroicons,
};

/** El SVG de una colección, sin tamaño fijo y con el color del texto. */
function fromFile(dir: string, file: string | null): string | null {
  if (!file) return null;
  const path = join(dir, file);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  const viewBox = /viewBox="([^"]+)"/.exec(text)?.[1] ?? '0 0 24 24';
  const inner = text
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    // Sin scripts ni manejadores: los SVG son datos.
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/\son\w+="[^"]*"/g, '');
  return `<svg viewBox="${viewBox}" fill="currentColor" aria-hidden="true">${inner}</svg>`;
}

const stroked = (inner: string, width: number) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const COLUMNS: [string, (c: Concept) => string | null][] = [
  ['Ahora · Lucide', (c) => stroked(LUCIDE[c], 2)],
  ['Propios', (c) => stroked(OWN[c], 1.75)],
  ...Object.keys(FILES).map((name): [string, (c: Concept) => string | null] => [
    name,
    (c) => fromFile(DIR_OF[name] as string, (FILES[name] as Record<Concept, string | null>)[c]),
  ]),
];

const LABEL: Record<Concept, string> = Object.fromEntries(CONCEPTS) as Record<Concept, string>;
const cell = (svg: string | null, concept: Concept) =>
  svg
    ? `<div class="cell"><span class="big status--${concept}">${svg}</span><span class="small status--${concept}">${svg}</span><span class="pill"><span class="status--${concept}">${svg}</span>${LABEL[concept]}</span></div>`
    : '<div class="cell none">—</div>';

const table = (
  theme: 'claro' | 'oscuro',
) => `<section class="theme theme--${theme === 'claro' ? 'light' : 'dark'}">
<h2>${theme === 'claro' ? 'Tema claro' : 'Tema oscuro'}</h2>
<div class="grid" style="grid-template-columns: 7.5rem repeat(${COLUMNS.length}, minmax(0, 1fr))">
<div></div>${COLUMNS.map(([name]) => `<div class="head">${name}</div>`).join('')}
${CONCEPTS.map(
  ([concept, label]) =>
    `<div class="label">${label}</div>${COLUMNS.map(([, make]) => cell(make(concept), concept)).join('')}`,
).join('\n')}
</div></section>`;

writeFileSync(
  out,
  `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rediseño · iconos</title>
<style>
  body { margin: 0; padding: 24px 16px 48px; background: #f6f6f7; color: #18181b; font: 15px/1.5 "Segoe UI Variable Text", system-ui, sans-serif; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 4px; }
  p { margin: 0 0 20px; color: #5e5e68; max-width: 70ch; }
  h2 { font-size: 13px; font-weight: 600; margin: 0 0 12px; color: inherit; opacity: .75; }
  .theme { padding: 20px; border-radius: 14px; margin-bottom: 24px; }
  .theme--light { background: #ffffff; color: #18181b; border: 1px solid #e4e4e8;
    --want_to_play:#0b63c5; --playing:#0d6e43; --on_hold:#a44f00; --completed:#6a3fc8; --dropped:#5e6977; --platinum:#7a5a00; --owned:#556170; --next:#006875; --line:#e4e4e8; }
  .theme--dark { background: #161618; color: #f4f4f5; border: 1px solid #27272b;
    --want_to_play:#5ab0ff; --playing:#3fcf8e; --on_hold:#ff9f43; --completed:#b395ff; --dropped:#9aa5b4; --platinum:#e8c35a; --owned:#a3adba; --next:#4dd0e1; --line:#27272b; }
  .grid { display: grid; gap: 10px 12px; align-items: center; overflow-x: auto; }
  .head { font-size: 12px; font-weight: 600; text-align: center; }
  .label { font-size: 13px; font-weight: 500; }
  .cell { display: grid; justify-items: center; gap: 8px; padding: 10px 4px; border-radius: 10px; }
  .cell.none { color: #8a8a93; }
  .big svg { width: 40px; height: 40px; display: block; }
  .small svg, .pill svg { width: 18px; height: 18px; display: block; }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px 4px 8px; border: 1px solid var(--line); border-radius: 999px; font-size: 13px; font-weight: 500; white-space: nowrap; }
  ${CONCEPTS.map(([c]) => `.status--${c} { color: var(--${c}); }`).join('\n  ')}
</style>
<h1>Iconos de estado y marcas</h1>
<p>A 40 px, a 18 px (su tamaño en la app) y dentro del botón de estado de la fila. Phosphor, Fluent UI System Icons, Tabler y Heroicons son colecciones profesionales con licencia MIT; «Propios» son los que dibujé para la rama.</p>
${table('claro')}
${table('oscuro')}
</html>`,
);
console.log(`Hoja de iconos: ${out}`);
