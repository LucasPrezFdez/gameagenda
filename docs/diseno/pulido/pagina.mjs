// Monta la página del pulido visual: `.cache/pulido/index.html`.
//
//   node scripts/pulido-capturas.ts          (antes: capturas e instantáneas)
//   node docs/diseno/pulido/pagina.mjs
//
// Primera parte, «Aspecto»: las capturas de cada opción de `opciones.json` sobre la app real.
// Segunda parte, «Movimiento»: demostraciones en vivo dentro de iframes, hechas con instantáneas
// del DOM de la app y su hoja de estilos de producción (`demos.js` es lo que corre dentro).
// Lo elegido se guarda en el navegador y se copia como texto para pegarlo en el chat.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? '.cache/pulido');
const topics = JSON.parse(readFileSync(join(HERE, 'opciones.json'), 'utf8'));

const blocks = new Map();
for (const part of readFileSync(join(HERE, 'opciones.css'), 'utf8').split('/*@@ ').slice(1)) {
  const end = part.indexOf('*/');
  blocks.set(part.slice(0, end).trim(), part.slice(end + 2));
}

const ICON_MORE =
  '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>';

/** Demostraciones de movimiento. `css` de cada opción usa `--motion`, que fija el selector de ritmo. */
const MOTION = [
  {
    id: 'paleta',
    title: 'Abrir la paleta (PC)',
    why: 'Ahora la lista aparece de golpe. Es lo que más veces se abre, así que cualquier animación tiene que ser muy corta y no retrasar lo que se teclea (no lo hace: el campo ya tiene el foco). Cerrar sigue siendo instantáneo en todas.',
    snap: 'pc-paleta',
    w: 1100,
    h: 620,
    extras: [
      {
        id: 'centrada',
        label: 'Verla con la paleta centrada (opción A de «Paleta»)',
        css: `${blocks.get('paleta-centrada')}
.app-header .palette.is-open .palette__panel { animation: pal-in calc(var(--motion) * 0.8) var(--ease); transform-origin: top center; }
.app-header .palette .palette__popup { animation: none; }`,
      },
    ],
    options: [
      { id: 'ninguna', name: 'Sin animación', note: 'Como ahora: aparece de golpe.' },
      {
        id: 'aparecer',
        name: 'Aparecer',
        note: 'Fundido con 6 px de caída, y el fondo se oscurece poco a poco. Unos 130 ms.',
        rec: true,
        css: `@keyframes pal-in { from { opacity: 0; transform: translateY(-6px); } }
@keyframes back-in { from { opacity: 0; } }
.palette__popup { animation: pal-in calc(var(--motion) * 0.8) var(--ease); }
.palette__backdrop { animation: back-in var(--motion) linear; }`,
      },
      {
        id: 'escala',
        name: 'Crecer',
        note: 'Crece desde el 97 % mientras aparece, como los menús de macOS.',
        css: `@keyframes pal-in { from { opacity: 0; transform: scale(0.97); } }
@keyframes back-in { from { opacity: 0; } }
.palette__popup { transform-origin: top left; animation: pal-in calc(var(--motion) * 0.8) var(--ease); }
.palette__backdrop { animation: back-in var(--motion) linear; }`,
      },
    ],
  },
  {
    id: 'paleta-movil',
    title: 'Abrir la paleta (móvil)',
    why: 'En el móvil la paleta ocupa toda la pantalla y ahora la sustituye de golpe, a la vez que sube el teclado.',
    snap: 'movil-paleta',
    w: 390,
    h: 640,
    options: [
      { id: 'ninguna', name: 'Sin animación', note: 'Como ahora.' },
      {
        id: 'fundir',
        name: 'Fundir y subir',
        note: 'Fundido con 16 px de subida. Corto: no compite con el teclado.',
        rec: true,
        css: `@keyframes sheet-in { from { opacity: 0; transform: translateY(16px); } }
.app-header > .palette.is-open { animation: sheet-in calc(var(--motion) * 0.9) var(--ease); }`,
      },
      {
        id: 'subir',
        name: 'Hoja desde abajo',
        note: 'Sube entera desde el borde inferior, como una hoja de iOS. Más vistosa y más larga.',
        css: `@keyframes sheet-in { from { transform: translateY(100%); } }
.app-header > .palette.is-open { animation: sheet-in calc(var(--motion) * 1.6) var(--ease); }`,
      },
    ],
  },
  {
    id: 'menu',
    title: 'Menús',
    why: 'El menú de estado, «…», «Orden» y la ayuda de atajos aparecen de golpe. Una entrada muy corta desde el botón que los abre ayuda a ver de dónde salen.',
    snap: 'pc-menu',
    w: 1100,
    h: 520,
    options: [
      { id: 'ninguna', name: 'Sin animación', note: 'Como ahora.' },
      {
        id: 'escala',
        name: 'Crecer desde el botón',
        note: 'Crece desde la esquina del botón (del 95 %) mientras aparece. Unos 110 ms.',
        rec: true,
        css: `@keyframes menu-in { from { opacity: 0; transform: scale(0.95); } }
.menu__popup { transform-origin: top right; animation: menu-in calc(var(--motion) * 0.7) var(--ease); }
.menu__popup--start { transform-origin: top left; }`,
      },
      {
        id: 'bajar',
        name: 'Caer',
        note: 'Fundido con 4 px de caída, sin cambiar de tamaño.',
        css: `@keyframes menu-in { from { opacity: 0; transform: translateY(-4px); } }
.menu__popup { animation: menu-in calc(var(--motion) * 0.7) var(--ease); }`,
      },
    ],
  },
  {
    id: 'estado',
    title: 'Cambiar de estado: la fila cambia de sección',
    why: 'Al pasar «Hollow Knight: Silksong» a Jugando, la fila salta a otra sección y las demás se recolocan de golpe: cuesta ver adónde ha ido. Es la animación que más aporta, porque explica lo que ha pasado.',
    snap: 'pc-lista',
    w: 1100,
    h: 620,
    options: [
      { id: 'ninguna', name: 'Sin animación', note: 'Como ahora: salta.' },
      {
        id: 'deslizar',
        name: 'Deslizar',
        note: 'La fila viaja hasta su sitio nuevo y las demás cierran el hueco. Unos 250 ms; no bloquea nada mientras dura.',
        rec: true,
      },
      {
        id: 'fundir',
        name: 'Fundir',
        note: 'La fila se apaga donde estaba y se enciende en su sitio nuevo; las demás saltan.',
      },
    ],
  },
  {
    id: 'alta',
    title: 'Juego recién apuntado',
    why: 'Al apuntar un juego desde la paleta, la fila nueva aparece al final de «Quiero jugar» sin más. Una señal breve confirma dónde ha quedado.',
    snap: 'pc-lista',
    w: 1100,
    h: 520,
    options: [
      { id: 'ninguna', name: 'Sin animación', note: 'Como ahora.' },
      {
        id: 'destello',
        name: 'Destello',
        note: 'La fila nueva nace teñida del azul de «Quiero jugar» y se apaga en algo más de un segundo. No mueve nada.',
        rec: true,
        css: `@keyframes row-flash { from { background-color: color-mix(in srgb, var(--want_to_play) 20%, transparent); } }
.entry-row.is-new .entry-row__body { background-image: none; animation: row-flash 1400ms ease-out; }`,
      },
      {
        id: 'entrar',
        name: 'Entrar',
        note: 'La fila entra con un fundido y 8 px de caída.',
        css: `@keyframes row-in { from { opacity: 0; transform: translateY(-8px); } }
.entry-row.is-new { animation: row-in calc(var(--motion) * 1.5) var(--ease); }`,
      },
      {
        id: 'ambas',
        name: 'Entrar y destello',
        note: 'Las dos a la vez.',
        css: `@keyframes row-flash { from { background-color: color-mix(in srgb, var(--want_to_play) 20%, transparent); } }
@keyframes row-in { from { opacity: 0; transform: translateY(-8px); } }
.entry-row.is-new { animation: row-in calc(var(--motion) * 1.5) var(--ease); }
.entry-row.is-new .entry-row__body { background-image: none; animation: row-flash 1400ms ease-out; }`,
      },
    ],
  },
  {
    id: 'marca',
    title: 'Poner una marca (Platinado, Comprado, Próximo)',
    why: 'Al marcar Platinado el botón cambia de color de golpe. Es un momento de premio: admite un gesto pequeño.',
    snap: 'pc-lista',
    w: 1100,
    h: 580,
    options: [
      { id: 'ninguna', name: 'Sin animación', note: 'Como ahora.' },
      {
        id: 'pop',
        name: 'Salto del icono',
        note: 'El icono da un salto corto (crece un 20 % y vuelve) y la etiqueta entra con un fundido.',
        rec: true,
        css: `@keyframes flag-pop { 0% { scale: 0.6; } 60% { scale: 1.2; } }
@keyframes chip-in { from { opacity: 0; transform: translateX(-4px); } }
.flag-toggle.is-just .icon { animation: flag-pop calc(var(--motion) * 1.8) var(--ease); }
.chip.is-new { animation: chip-in var(--motion) var(--ease); }`,
      },
      {
        id: 'suave',
        name: 'Solo fundido',
        note: 'El color del botón y la etiqueta entran con un fundido, sin salto.',
        css: `@keyframes chip-in { from { opacity: 0; } }
.flag-toggle { transition: background-color var(--motion) var(--ease), color var(--motion) var(--ease); }
.chip.is-new { animation: chip-in var(--motion) var(--ease); }`,
      },
    ],
  },
  {
    id: 'aviso',
    title: 'Aviso con Deshacer',
    why: 'El aviso ya entra subiendo 8 px, pero desaparece de golpe y no se sabe cuánto queda para pulsar Deshacer (en la app son 8 segundos; aquí, 3).',
    snap: 'pc-aviso',
    w: 1100,
    h: 420,
    options: [
      { id: 'ahora', name: 'Como ahora', note: 'Entra subiendo; se va de golpe.' },
      {
        id: 'salida',
        name: 'Con salida',
        note: 'También se va con un fundido corto hacia abajo.',
        css: `@keyframes toast-out { to { opacity: 0; transform: translateY(6px); } }
.toast.is-leaving { animation: toast-out calc(var(--motion) * 0.75) ease-in forwards; }`,
      },
      {
        id: 'tiempo',
        name: 'Con salida y tiempo',
        note: 'Además, una línea fina se va acortando: lo que queda para deshacer. Se para con el puntero encima, como el aviso.',
        rec: true,
        css: `@keyframes toast-out { to { opacity: 0; transform: translateY(6px); } }
@keyframes toast-time { to { transform: scaleX(0); } }
.toast { position: relative; overflow: hidden; }
.toast::after { content: ""; position: absolute; right: 0; bottom: 0; left: 0; height: 2px; background: currentcolor; opacity: 0.35; transform-origin: left; animation: toast-time 2800ms linear forwards; }
.toast:hover::after { animation-play-state: paused; }
.toast.is-leaving { animation: toast-out calc(var(--motion) * 0.75) ease-in forwards; }`,
      },
    ],
  },
  {
    id: 'indicador',
    title: 'Sección activa de la cápsula (móvil)',
    why: 'Al cambiar entre Mi lista, Catálogo y Ajustes, la píldora se apaga en una y se enciende en otra.',
    snap: 'movil-lista',
    snap2: 'movil-catalogo',
    w: 390,
    h: 420,
    options: [
      { id: 'ahora', name: 'Como ahora', note: 'Fundido de 160 ms en cada pestaña.' },
      {
        id: 'deslizar',
        name: 'La píldora se desliza',
        note: 'Una sola píldora que viaja de una sección a otra, como en iOS. Solo CSS.',
        rec: true,
        css: `@media (max-width: 767px) {
  .app-nav ul { position: relative; }
  .app-nav li { position: relative; }
  .app-nav__link[aria-current="page"] { background: transparent; }
  .app-nav ul::before { content: ""; position: absolute; inset: 0 auto 0 0; width: calc((100% - 4px) / 3); border-radius: 999px; background: var(--surface-3); transition: translate calc(var(--motion) * 1.6) var(--ease); }
  .app[data-route="catalog"] .app-nav ul::before { translate: calc(100% + 2px) 0; }
  .app[data-route="settings"] .app-nav ul::before { translate: calc(200% + 4px) 0; }
}`,
      },
      {
        id: 'ninguna',
        name: 'Sin animación',
        note: 'Cambia de golpe.',
        css: '.app-nav__link { transition: none; }',
      },
    ],
  },
  {
    id: 'pantalla',
    title: 'Cambiar de pantalla',
    why: 'Mi lista, Catálogo y Ajustes se sustituyen de golpe. Aquí animar es discutible: la app presume de ir rápida y un fundido en cada cambio la hace parecer más lenta. Mi recomendación es no tocarlo.',
    snap: 'pc-lista',
    snap2: 'pc-catalogo',
    w: 1100,
    h: 620,
    options: [
      { id: 'ninguna', name: 'Sin animación', note: 'Como ahora: instantáneo.', rec: true },
      {
        id: 'fundido',
        name: 'Fundido',
        note: 'La pantalla nueva aparece con un fundido de unos 130 ms.',
        css: `@keyframes screen-in { from { opacity: 0; } }
.app-main.is-entering > * { animation: screen-in calc(var(--motion) * 0.8) ease-out; }`,
      },
      {
        id: 'subir',
        name: 'Fundido y subida',
        note: 'Además sube 6 px.',
        css: `@keyframes screen-in { from { opacity: 0; transform: translateY(6px); } }
.app-main.is-entering > * { animation: screen-in var(--motion) var(--ease); }`,
      },
    ],
  },
  {
    id: 'ficha-movil',
    title: 'Abrir la ficha (móvil)',
    why: 'En el móvil la ficha sustituye a la lista de golpe. Aquí sí hay un «entrar» y un «volver», y un empuje corto lo deja claro.',
    snap: 'movil-lista',
    snap2: 'movil-ficha',
    w: 390,
    h: 640,
    options: [
      { id: 'ninguna', name: 'Sin animación', note: 'Como ahora.' },
      {
        id: 'empuje',
        name: 'Empuje corto',
        note: 'La ficha entra desde la derecha (20 px) con un fundido; al volver, la lista hace lo mismo.',
        rec: true,
        css: `@keyframes screen-in { from { opacity: 0; transform: translateX(20px); } }
.app[data-route="game"] .app-main.is-entering > * { animation: screen-in calc(var(--motion) * 1.2) var(--ease); }
@keyframes screen-back { from { opacity: 0; transform: translateX(-20px); } }
.app[data-route="list"] .app-main.is-entering > * { animation: screen-back calc(var(--motion) * 1.2) var(--ease); }`,
      },
      {
        id: 'subir',
        name: 'Fundido y subida',
        note: 'Fundido con 10 px de subida, igual al entrar y al volver.',
        css: `@keyframes screen-in { from { opacity: 0; transform: translateY(10px); } }
.app-main.is-entering > * { animation: screen-in calc(var(--motion) * 1.2) var(--ease); }`,
      },
    ],
  },
  {
    id: 'ficha-panel',
    title: 'Abrir la ficha como panel (ventana mediana)',
    why: 'Entre 768 y 1 279 px la ficha es un panel que tapa la parte derecha de la lista y aparece de golpe. A partir de 1 280 px va al lado de la lista y no hace falta animarla.',
    snap: 'pc-ficha',
    w: 1100,
    h: 620,
    options: [
      { id: 'ninguna', name: 'Sin animación', note: 'Como ahora.' },
      {
        id: 'deslizar',
        name: 'Deslizar',
        note: 'El panel entra desde el borde derecho. Unos 240 ms.',
        rec: true,
        css: `@keyframes panel-in { from { transform: translateX(100%); } }
.sheet { animation: panel-in calc(var(--motion) * 1.5) var(--ease); }`,
      },
      {
        id: 'fundir',
        name: 'Fundir',
        note: 'Fundido con 16 px de desplazamiento.',
        css: `@keyframes panel-in { from { opacity: 0; transform: translateX(16px); } }
.sheet { animation: panel-in var(--motion) var(--ease); }`,
      },
    ],
  },
  {
    id: 'pulsar',
    title: 'Pulsar un botón',
    why: 'Los botones cambian de fondo con el puntero encima, pero al pulsarlos no responden. Pruébalos tú: se pueden pulsar.',
    snap: 'custom',
    body: `<div class="demo-strip">
  <button type="button" class="btn btn--primary" data-press>Apuntar</button>
  <button type="button" class="btn" data-press>Exportar copia</button>
  <button type="button" class="btn btn--ghost" data-press>Cerrar</button>
  <button type="button" class="chip-button" aria-pressed="true" data-press>Todos</button>
  <button type="button" class="chip-button" aria-pressed="false" data-press>Comprados</button>
  <button type="button" class="icon-btn" aria-label="Más" data-press>${ICON_MORE}</button>
</div>`,
    w: 720,
    h: 150,
    options: [
      { id: 'ninguna', name: 'Sin animación', note: 'Como ahora.' },
      {
        id: 'escala',
        name: 'Hundirse',
        note: 'El botón encoge al 96 % mientras está pulsado. Se nota sobre todo con el dedo.',
        rec: true,
        css: `:is(.btn, .chip-button, .icon-btn) { transition: transform 90ms var(--ease), background-color var(--motion) var(--ease); }
:is(.btn, .chip-button, .icon-btn):is(:active, .is-pressed) { transform: scale(0.96); }`,
      },
      {
        id: 'oscurecer',
        name: 'Oscurecerse',
        note: 'El botón se oscurece un poco mientras está pulsado, sin moverse.',
        css: `:is(.btn, .chip-button, .icon-btn):is(:active, .is-pressed) { filter: brightness(0.88); }`,
      },
    ],
  },
];

const RHYTHM = [
  {
    id: 'vivo',
    name: 'Vivo',
    ms: 120,
    note: '120 ms de base. Casi no se nota que hay animación; solo que todo es más suave.',
  },
  { id: 'medio', name: 'Medio', ms: 160, note: '160 ms de base, el que ya usa la app.', rec: true },
  {
    id: 'calmado',
    name: 'Calmado',
    ms: 220,
    note: '220 ms de base. Se ve cada movimiento; puede cansar al usar la app deprisa.',
  },
];

const STILL = [
  [
    'Resultados de la paleta al teclear',
    'Cambian con cada letra: animarlos sería ruido y parecería lento.',
  ],
  [
    'Filtrar y ordenar la lista',
    'El resultado tiene que estar ahí al instante; moverse 500 filas no ayuda a nadie.',
  ],
  [
    'Pasar el puntero por las filas',
    'El fondo ya cambia con un fundido de 160 ms. No hace falta más.',
  ],
  [
    'Esqueletos de carga',
    'Sin brillo que se desplaza: la carga dura menos de lo que tarda en verse.',
  ],
  ['Portadas', 'Ya entran con un fundido al cargar. Se queda así.'],
  [
    'Encoger la barra lateral, deslizar filas y arrastrar para ordenar',
    'Ya están animados y bien medidos.',
  ],
  [
    'Movimiento reducido',
    'Con «reducir movimiento» activado en el sistema, todo lo de esta página se queda sin animación, como hasta ahora.',
  ],
];

const DEMO_CSS = `
html { scrollbar-width: none; }
a { cursor: default; }
.palette:not(.is-open) .palette__clear { display: none; }
.demo-off { display: none !important; }
.entry-row.demo-hover .entry-row__actions,
.entry-row:has(.menu__popup) .entry-row__actions { opacity: 1; }
.entry-row.demo-hover .entry-row__body,
.entry-row:has(.menu__popup) .entry-row__body { background-color: var(--surface-2); background-image: none; }
.entry-row.is-moving { position: relative; z-index: 2; content-visibility: visible; }
.entry-row.is-moving .entry-row__body { background-color: var(--surface); background-image: none; box-shadow: var(--shadow); }
.demo-strip { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 12px; min-height: 100dvh; padding: 24px; }
`;

// ── Datos para la página ────────────────────────────────────────────────────────────────────────
const snaps = {};
for (const demo of MOTION) {
  for (const name of [demo.snap, demo.snap2]) {
    if (!name || name === 'custom' || snaps[name]) continue;
    const file = join(OUT, `snap-${name}.json`);
    if (!existsSync(file))
      throw new Error(`Falta ${file}: ejecuta antes scripts/pulido-capturas.ts`);
    snaps[name] = JSON.parse(readFileSync(file, 'utf8'))
      .body.replaceAll(' crossorigin="anonymous"', '')
      .replaceAll(' loading="lazy"', '');
  }
}
const data = {
  css: readFileSync(join(OUT, 'app.css'), 'utf8'),
  demoCss: DEMO_CSS,
  runtime: readFileSync(join(HERE, 'demos.js'), 'utf8'),
  snaps,
  motion: MOTION.map(({ id, snap, snap2, body, w, h, options, extras }) => ({
    id,
    snap,
    snap2: snap2 ?? null,
    body: body ?? null,
    w,
    h,
    css: Object.fromEntries(options.map((option) => [option.id, option.css ?? ''])),
    extras: Object.fromEntries((extras ?? []).map((extra) => [extra.id, extra.css])),
  })),
};
writeFileSync(
  join(OUT, 'datos.js'),
  `window.PULIDO = ${JSON.stringify(data).replaceAll('<', '\\u003c')};\n`,
);

// ── Página ──────────────────────────────────────────────────────────────────────────────────────
const esc = (text) =>
  String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

function optionCards(group, options, kind) {
  return `<div class="options" role="radiogroup" aria-label="Opciones">${options
    .map(
      (option) => `<label class="opt${option.rec ? ' opt--rec' : ''}">
  <input type="radio" name="${group}" value="${option.id}" data-name="${esc(option.name)}" data-kind="${kind}"${option.ms ? ` data-ms="${option.ms}"` : ''}>
  <span class="opt__name">${esc(option.name)}${option.rec ? ' <span class="rec">Recomendada</span>' : ''}</span>
  <span class="opt__note">${esc(option.note)}</span>
</label>`,
    )
    .join('')}</div>`;
}

const look = topics
  .filter((topic) => topic.title)
  .map((topic) => {
    const shots = topic.shots
      .map((shot) => {
        const figures = topic.options
          .filter((option) => existsSync(join(OUT, `${topic.id}--${option.id}--${shot.id}.png`)))
          .map(
            (option) => `<figure data-option="${option.id}">
  <button type="button" class="zoom" data-group="${topic.id}--${shot.id}" data-caption="${esc(`${topic.title} · ${shot.label} · ${option.name}`)}">
    <img loading="lazy" src="${topic.id}--${option.id}--${shot.id}.png" alt="${esc(`${topic.title}, ${option.name}, ${shot.label}`)}">
  </button>
  <figcaption>${esc(option.name)}</figcaption>
</figure>`,
          )
          .join('');
        return `<div class="shot"><h4>${esc(shot.label)}</h4><div class="shot__grid${topic.wide ? ' shot__grid--wide' : ''}">${figures}</div></div>`;
      })
      .join('');
    return `<section class="topic" id="${topic.id}" data-title="${esc(topic.title)}">
  <h3>${esc(topic.title)}</h3>
  <p class="why">${esc(topic.why)}</p>
  ${optionCards(topic.id, topic.options, 'look')}
  ${shots}
</section>`;
  })
  .join('\n');

const move = MOTION.map(
  (
    demo,
  ) => `<section class="topic demo" id="m-${demo.id}" data-title="${esc(demo.title)}" data-demo="${demo.id}">
  <h3>${esc(demo.title)}</h3>
  <p class="why">${esc(demo.why)}</p>
  ${optionCards(`m-${demo.id}`, demo.options, 'motion')}
  <div class="demo__bar">
    <button type="button" class="play">▶ Reproducir</button>
    ${(demo.extras ?? []).map((extra) => `<label class="extra"><input type="checkbox" data-extra="${extra.id}"> ${esc(extra.label)}</label>`).join('')}
    <span class="demo__hint">Elegir una opción la reproduce.</span>
  </div>
  <div class="stage" data-w="${demo.w}" data-h="${demo.h}"><div class="stage__wait">La demostración se carga al llegar aquí…</div></div>
</section>`,
).join('\n');

const nav = (items) =>
  items.map(([id, title]) => `<li><a href="#${id}">${esc(title)}</a></li>`).join('');

const html = `<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GameAgenda · pulido visual y animaciones</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f6f7; --surface: #fff; --surface-2: #f0f0f2; --line: #e1e1e6; --text: #18181b; --muted: #5e5e68; --ok: #0d6e43; --ok-bg: #e2eee8; --shadow: 0 1px 2px rgb(24 24 27 / .05), 0 12px 32px -4px rgb(24 24 27 / .16); }
  @media (prefers-color-scheme: dark) { :root { --bg: #0e0e10; --surface: #161618; --surface-2: #1f1f22; --line: #2a2a2f; --text: #f4f4f5; --muted: #a1a1aa; --ok: #3fcf8e; --ok-bg: #1d3833; --shadow: 0 1px 2px rgb(0 0 0 / .35), 0 16px 40px -6px rgb(0 0 0 / .6); } }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; scroll-padding-top: 16px; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.55 "Segoe UI Variable Text", system-ui, sans-serif; }
  .page { display: grid; grid-template-columns: 232px minmax(0, 1fr); gap: 40px; max-width: 1640px; margin: 0 auto; padding: 32px 24px 160px; }
  .toc { position: sticky; top: 24px; align-self: start; max-height: calc(100vh - 48px); overflow: auto; font-size: 13px; }
  .toc h2 { margin: 18px 0 6px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
  .toc ul { margin: 0; padding: 0; list-style: none; }
  .toc a { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 6px; color: var(--muted); text-decoration: none; }
  .toc a:hover { background: var(--surface-2); color: var(--text); }
  .toc a::before { content: ""; width: 7px; height: 7px; flex: none; border: 1.5px solid currentcolor; border-radius: 50%; }
  .toc a.is-done { color: var(--text); }
  .toc a.is-done::before { border-color: var(--ok); background: var(--ok); }
  h1 { margin: 0 0 8px; font-size: 30px; font-weight: 600; letter-spacing: -.02em; line-height: 1.15; }
  .lede { max-width: 72ch; margin: 0 0 8px; color: var(--muted); font-size: 16px; }
  .how { max-width: 72ch; margin: 16px 0 0; padding-left: 20px; color: var(--muted); }
  .how li + li { margin-top: 4px; }
  .part { margin: 56px 0 8px; padding-top: 24px; border-top: 1px solid var(--line); font-size: 22px; font-weight: 600; letter-spacing: -.01em; }
  .part + p { max-width: 72ch; margin: 0; color: var(--muted); }
  .topic { margin-top: 44px; }
  h3 { margin: 0 0 4px; font-size: 18px; font-weight: 600; }
  .why { max-width: 76ch; margin: 0 0 14px; color: var(--muted); }
  .options { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; }
  .opt { position: relative; display: flex; flex-direction: column; gap: 3px; padding: 12px 14px 12px 40px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); cursor: pointer; }
  .opt:hover { border-color: var(--muted); }
  .opt input { position: absolute; top: 14px; left: 14px; width: 16px; height: 16px; margin: 0; accent-color: var(--text); }
  .opt:has(input:checked) { border-color: var(--text); box-shadow: 0 0 0 1px var(--text); }
  .opt:has(input:focus-visible) { outline: 2px solid var(--text); outline-offset: 2px; }
  .opt__name { font-weight: 600; }
  .opt__note { color: var(--muted); font-size: 13px; line-height: 1.45; }
  .rec { margin-left: 6px; padding: 1px 8px; border-radius: 999px; background: var(--ok-bg); color: var(--ok); font-size: 11px; font-weight: 600; vertical-align: 1px; white-space: nowrap; }
  .shot { margin-top: 18px; }
  h4 { margin: 0 0 8px; color: var(--muted); font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
  .shot__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; align-items: start; }
  .shot__grid--wide { grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); }
  figure { margin: 0; }
  figure.is-picked .zoom { border-color: var(--text); box-shadow: 0 0 0 1px var(--text); }
  figcaption { margin-top: 6px; font-size: 13px; font-weight: 600; }
  .zoom { display: block; width: 100%; padding: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); cursor: zoom-in; }
  .zoom img { display: block; width: 100%; height: auto; }
  .demo__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; margin: 14px 0 10px; }
  button.play, .tray button, .lightbox button { min-height: 34px; padding: 5px 14px; border: 1px solid transparent; border-radius: 8px; background: var(--text); color: var(--bg); font: inherit; font-weight: 600; cursor: pointer; }
  .tray button.ghost, .lightbox button { border-color: var(--line); background: var(--surface); color: var(--text); }
  .extra, .demo__hint { color: var(--muted); font-size: 13px; }
  .extra { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .stage { position: relative; max-width: 100%; overflow: hidden; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
  .stage iframe { display: block; border: 0; transform-origin: 0 0; }
  .stage__wait { display: grid; place-items: center; height: 100%; min-height: 120px; color: var(--muted); font-size: 13px; }
  .still { max-width: 80ch; margin: 16px 0 0; padding: 0; list-style: none; }
  .still li { padding: 10px 0; border-top: 1px solid var(--line); }
  .still strong { display: block; }
  .still span { color: var(--muted); }
  .tray { position: fixed; right: 0; bottom: 0; left: 0; z-index: 20; border-top: 1px solid var(--line); background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(12px); }
  .tray__in { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; max-width: 1640px; margin: 0 auto; padding: 10px 24px; }
  .tray__count { margin-right: auto; font-weight: 600; }
  .tray__count span { color: var(--muted); font-weight: 400; }
  .tray label { color: var(--muted); font-size: 13px; }
  .tray select { margin-left: 6px; font: inherit; }
  #summary { width: 100%; max-height: 40vh; margin: 0; padding: 12px 14px; overflow: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); font: 13px/1.5 ui-monospace, "Cascadia Mono", Consolas, monospace; white-space: pre-wrap; }
  #summary[hidden] { display: none; }
  .lightbox { position: fixed; inset: 0; z-index: 30; display: grid; grid-template-rows: auto minmax(0, 1fr); background: rgb(0 0 0 / .88); color: #fff; }
  .lightbox[hidden] { display: none; }
  .lightbox__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px 16px; }
  .lightbox__caption { margin-right: auto; font-weight: 600; }
  .lightbox__hint { color: #b4b4bd; font-size: 13px; }
  .lightbox__img { display: grid; place-items: center; min-height: 0; padding: 0 16px 16px; overflow: auto; cursor: zoom-out; }
  .lightbox__img img { max-width: 100%; max-height: 100%; border-radius: 8px; }
  @media (max-width: 900px) { .page { grid-template-columns: minmax(0, 1fr); } .toc { display: none; } }
</style>
<div class="page">
  <nav class="toc" aria-label="Índice">
    <h2>Aspecto</h2>
    <ul>${nav(topics.filter((t) => t.title).map((t) => [t.id, t.title]))}</ul>
    <h2>Movimiento</h2>
    <ul>${nav([['ritmo', 'Ritmo general'], ...MOTION.map((d) => [`m-${d.id}`, d.title])])}</ul>
    <h2>Sin tocar</h2>
    <ul><li><a href="#quieto" class="is-done">Lo que se queda quieto</a></li></ul>
  </nav>
  <main>
    <h1>GameAgenda · pulido visual y animaciones</h1>
    <p class="lede">Propuestas sobre la app publicada, con la dirección «Tinta» que ya elegiste. Nada de esto está en el código todavía: elige una opción en cada apartado y lo construyo.</p>
    <ol class="how">
      <li><strong>Aspecto:</strong> son capturas de la app real con cada opción aplicada encima. Pulsa una captura para verla grande y usa ← → para alternar entre las opciones en el mismo sitio: así saltan a la vista las diferencias.</li>
      <li><strong>Movimiento:</strong> son demostraciones en vivo hechas con la pantalla real de la app. Al elegir una opción se reproduce; «Sin animación» siempre es una opción.</li>
      <li>Cuando termines, pulsa <strong>Copiar mi elección</strong> (abajo) y pégala en el chat. Lo que dejes sin elegir se queda como está ahora.</li>
    </ol>

    <h2 class="part" id="aspecto">1 · Aspecto</h2>
    <p>Once apartados. La etiqueta verde marca la que yo elegiría, con el motivo en su texto.</p>
    ${look}

    <h2 class="part" id="movimiento">2 · Movimiento</h2>
    <p>Pocas animaciones y cortas: solo donde explican lo que acaba de pasar (algo aparece, se mueve o se confirma). Ninguna bloquea el teclado ni retrasa una acción, y todas se apagan con «reducir movimiento» del sistema.</p>
    <section class="topic" id="ritmo" data-title="Ritmo general">
      <h3>Ritmo general</h3>
      <p class="why">La duración de base de todas las animaciones. Cambia el ritmo de todas las demostraciones de abajo, para que las pruebes con cada uno.</p>
      ${optionCards('ritmo', RHYTHM, 'rhythm')}
    </section>
    ${move}

    <h2 class="part" id="quieto">3 · Lo que dejaría sin animación</h2>
    <p>Me pediste no animar lo que va mejor quieto. Esto es lo que no tocaría:</p>
    <ul class="still">${STILL.map(([what, reason]) => `<li><strong>${esc(what)}</strong><span>${esc(reason)}</span></li>`).join('')}</ul>
  </main>
</div>

<div class="tray">
  <div class="tray__in">
    <span class="tray__count" id="count"></span>
    <label>Tema de las demostraciones<select id="theme"><option value="light">Claro</option><option value="dark">Oscuro</option></select></label>
    <button type="button" class="ghost" id="recommended">Marcar las recomendadas</button>
    <button type="button" class="ghost" id="clear">Borrar</button>
    <button type="button" id="copy">Copiar mi elección</button>
    <pre id="summary" hidden></pre>
  </div>
</div>

<div class="lightbox" id="lightbox" hidden>
  <div class="lightbox__bar">
    <span class="lightbox__caption" id="lightbox-caption"></span>
    <span class="lightbox__hint">← → cambia de opción · Esc cierra</span>
    <button type="button" id="lightbox-prev">←</button>
    <button type="button" id="lightbox-next">→</button>
    <button type="button" id="lightbox-pick">Elegir esta</button>
    <button type="button" id="lightbox-close">Cerrar</button>
  </div>
  <div class="lightbox__img" id="lightbox-stage"><img id="lightbox-img" alt=""></div>
</div>

<script src="datos.js"></script>
<script>
  const P = window.PULIDO;
  const $ = (s, from = document) => from.querySelector(s);
  const $$ = (s, from = document) => [...from.querySelectorAll(s)];
  const KEY = 'gameagenda-pulido-eleccion';
  const radios = $$('.opt input');
  const groups = [...new Set(radios.map((r) => r.name))];

  // ── Elección ──
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  }
  function save() {
    const picked = {};
    for (const r of radios) if (r.checked) picked[r.name] = r.value;
    try { localStorage.setItem(KEY, JSON.stringify(picked)); } catch {}
  }
  function refresh() {
    let done = 0;
    for (const group of groups) {
      const checked = radios.find((r) => r.name === group && r.checked);
      if (checked) done++;
      const section = document.getElementById(group);
      for (const figure of $$('figure', section)) figure.classList.toggle('is-picked', !!checked && figure.dataset.option === checked.value);
      $('.toc a[href="#' + group + '"]')?.classList.toggle('is-done', !!checked);
    }
    $('#count').innerHTML = done + ' de ' + groups.length + ' elegidas <span>· lo que no elijas se queda como ahora</span>';
    if (!$('#summary').hidden) $('#summary').textContent = summary();
  }
  function summary() {
    const lines = ['Mi elección del pulido visual de GameAgenda:', ''];
    for (const part of [['look', 'Aspecto'], ['rhythm', 'Movimiento'], ['motion', null]]) {
      if (part[1]) lines.push(part[1] + ':');
      for (const group of groups) {
        const all = radios.filter((r) => r.name === group && r.dataset.kind === part[0]);
        if (all.length === 0) continue;
        const checked = all.find((r) => r.checked);
        const title = document.getElementById(group).dataset.title;
        lines.push('- ' + title + ': ' + (checked ? checked.dataset.name : '(sin elegir: se queda como ahora)'));
      }
      if (part[0] === 'look') lines.push('');
    }
    return lines.join('\\n');
  }
  const saved = load();
  for (const r of radios) if (saved[r.name] === r.value) r.checked = true;
  $('#recommended').addEventListener('click', () => {
    for (const r of radios) if (r.closest('.opt--rec')) r.checked = true;
    save(); refresh();
  });
  $('#clear').addEventListener('click', () => {
    for (const r of radios) r.checked = false;
    save(); refresh();
  });
  $('#copy').addEventListener('click', async () => {
    const text = summary();
    $('#summary').hidden = false;
    $('#summary').textContent = text;
    try { await navigator.clipboard.writeText(text); $('#copy').textContent = 'Copiada ✓'; }
    catch { $('#copy').textContent = 'Cópiala del recuadro'; }
    setTimeout(() => { $('#copy').textContent = 'Copiar mi elección'; }, 2500);
  });

  // ── Capturas en grande ──
  const box = $('#lightbox');
  let current = [];
  let index = 0;
  function show() {
    const button = current[index];
    $('#lightbox-img').src = $('img', button).src;
    $('#lightbox-caption').textContent = button.dataset.caption + '  (' + (index + 1) + '/' + current.length + ')';
  }
  function step(by) { index = (index + by + current.length) % current.length; show(); }
  function closeBox() { box.hidden = true; }
  for (const button of $$('.zoom')) {
    button.addEventListener('click', () => {
      current = $$('.zoom[data-group="' + button.dataset.group + '"]');
      index = current.indexOf(button);
      box.hidden = false;
      show();
    });
  }
  $('#lightbox-prev').addEventListener('click', () => step(-1));
  $('#lightbox-next').addEventListener('click', () => step(1));
  $('#lightbox-close').addEventListener('click', closeBox);
  $('#lightbox-stage').addEventListener('click', closeBox);
  $('#lightbox-pick').addEventListener('click', () => {
    const figure = current[index].closest('figure');
    const radio = $('input[value="' + figure.dataset.option + '"]', figure.closest('.topic'));
    radio.checked = true;
    save(); refresh(); closeBox();
  });
  addEventListener('keydown', (event) => {
    if (box.hidden) return;
    if (event.key === 'Escape') closeBox();
    if (event.key === 'ArrowLeft') step(-1);
    if (event.key === 'ArrowRight') step(1);
  });

  // ── Demostraciones ──
  const frames = new Map();
  const themeSelect = $('#theme');
  themeSelect.value = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const motionMs = () => Number(radios.find((r) => r.name === 'ritmo' && r.checked)?.dataset.ms ?? 160);

  function frameDoc(demo) {
    const body = demo.snap === 'custom' ? demo.body : P.snaps[demo.snap];
    const second = demo.snap2 ? JSON.stringify(P.snaps[demo.snap2]).replaceAll('<', '\\\\u003c') : 'null';
    return '<!doctype html><html lang="es" data-theme="' + themeSelect.value + '"><head><meta charset="utf-8"><style>' + P.css + '</style><style>' + P.demoCss + '</style><style id="v"></style></head><body>' + body +
      '<script>const DEMO_ID = ' + JSON.stringify(demo.id) + '; const SNAP2 = ' + second + ';\\n' + P.runtime + '<\\/script></body></html>';
  }
  function fit(stage) {
    const frame = $('iframe', stage);
    if (!frame) return;
    const w = Number(stage.dataset.w);
    const h = Number(stage.dataset.h);
    stage.style.width = w + 'px';
    const scale = Math.min(1, stage.clientWidth / w);
    frame.style.transform = 'scale(' + scale + ')';
    stage.style.height = Math.round(h * scale) + 'px';
  }
  function mount(section) {
    const demo = P.motion.find((d) => d.id === section.dataset.demo);
    const stage = $('.stage', section);
    const frame = document.createElement('iframe');
    frame.title = section.dataset.title;
    frame.width = stage.dataset.w;
    frame.height = stage.dataset.h;
    frame.srcdoc = frameDoc(demo);
    stage.replaceChildren(frame);
    frames.set(demo.id, { frame, demo, section, ready: false });
    fit(stage);
  }
  function play(id, resetOnly = false) {
    const entry = frames.get(id);
    if (!entry || !entry.ready) return;
    const checked = $('.opt input:checked', entry.section);
    const variant = checked ? checked.value : $('.opt input', entry.section).value;
    const extras = $$('input[data-extra]:checked', entry.section).map((box) => entry.demo.extras[box.dataset.extra]).join('\\n');
    entry.frame.contentWindow.postMessage({ t: 'play', variant, css: (entry.demo.css[variant] || '') + '\\n' + extras, motion: motionMs(), theme: themeSelect.value, resetOnly }, '*');
  }
  addEventListener('message', (event) => {
    if (event.data?.t !== 'ready') return;
    const entry = frames.get(event.data.id);
    if (!entry) return;
    entry.ready = true;
    play(event.data.id, true);
  });
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      watcher.unobserve(entry.target);
      mount(entry.target);
    }
  }, { rootMargin: '600px 0px' });
  for (const section of $$('.demo')) {
    watcher.observe(section);
    $('.play', section).addEventListener('click', () => play(section.dataset.demo));
    for (const box of $$('input[data-extra]', section)) box.addEventListener('change', () => play(section.dataset.demo));
  }
  new ResizeObserver(() => { for (const stage of $$('.stage')) fit(stage); }).observe($('main'));
  themeSelect.addEventListener('change', () => { for (const id of frames.keys()) play(id, true); });

  for (const r of radios) {
    r.addEventListener('change', () => {
      save(); refresh();
      const section = r.closest('.demo');
      if (section) play(section.dataset.demo);
      if (r.name === 'ritmo') for (const id of frames.keys()) play(id, true);
    });
  }
  refresh();
</script>
</html>
`;
writeFileSync(join(OUT, 'index.html'), html);
console.log(`Página: ${join(OUT, 'index.html')}`);
