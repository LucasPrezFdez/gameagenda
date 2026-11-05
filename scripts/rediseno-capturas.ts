// Capturas para el rediseño visual (docs/planificacion/prompts/rediseno-visual.md).
//
// Abre `ga-web` de producción en un perfil propio (`.cache/rediseno/perfil`, nunca el del usuario),
// importa una agenda de prueba con juegos conocidos y fotografía cada pantalla en claro y oscuro, a
// 390, 1 100 y 1 440 px. Con `--css`, inyecta encima una hoja de estilos (una dirección de la
// propuesta): así se ve la app real, con su catálogo y sus portadas, sin tocar su código.
//
//   node scripts/rediseno-capturas.ts --variant=antes
//   node scripts/rediseno-capturas.ts --variant=a \
//     --css=docs/diseno/rediseno-visual/base-limpia.css,docs/diseno/rediseno-visual/direccion-a.css
//
// Las capturas van a `<raíz del repositorio principal>/.cache/rediseno/<variante>/`, que no se
// versiona. Al acabar, rehace `.cache/rediseno/comparar.html` con todas las variantes que haya.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { addEntry, type Entry, type Status } from '@gameagenda/core/entries';
import { createExport, stringifyExport } from '@gameagenda/core/schemas';
import { formatHlc } from '@gameagenda/core/sync';
import { chromium, type Page } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';

const { values } = parseArgs({
  options: {
    variant: { type: 'string', default: 'antes' },
    css: { type: 'string' },
    url: { type: 'string', default: 'https://ga-web.gameagenda.workers.dev' },
    out: { type: 'string' },
    widths: { type: 'string', default: '390,1100,1440' },
    themes: { type: 'string', default: 'light,dark' },
    screens: { type: 'string' },
  },
});

/** La raíz del repositorio principal: el perfil y las capturas van en una ruta corta (en Windows,
 * un perfil de Chromium en una ruta larga falla con `net::ERR_FAILED`). */
function mainRoot(): string {
  const here = resolve('.');
  const marker = `${'.claude'}${here.includes('\\') ? '\\' : '/'}worktrees`;
  const i = here.indexOf(marker);
  return i === -1 ? here : here.slice(0, i - 1);
}

const ROOT = values.out ? resolve(values.out) : join(mainRoot(), '.cache', 'rediseno');
const PROFILE = join(ROOT, 'perfil');
const OUT = join(ROOT, values.variant ?? 'antes');
const BASE = (values.url ?? '').replace(/\/$/, '');
// Varias hojas separadas por comas, en ese orden (la base común y luego la dirección).
const css = values.css
  ? values.css
      .split(',')
      .map((path) => readFileSync(resolve(path.trim()), 'utf8'))
      .join('\n')
  : null;

/** Agenda de prueba: [appid, título, estado, marcas]. */
const AGENDA: readonly [number, string, Status, Record<string, boolean>][] = [
  [1145350, 'Hades II', 'playing', { owned: true }],
  [1086940, "Baldur's Gate 3", 'playing', { owned: true }],
  [1030300, 'Hollow Knight: Silksong', 'want_to_play', { next: true }],
  [753640, 'Outer Wilds', 'want_to_play', { next: true, owned: true }],
  [1245620, 'ELDEN RING', 'want_to_play', { owned: true }],
  [1091500, 'Cyberpunk 2077', 'want_to_play', {}],
  [292030, 'The Witcher 3: Wild Hunt', 'want_to_play', { owned: true }],
  [2379780, 'Balatro', 'want_to_play', {}],
  [1868140, 'DAVE THE DIVER', 'want_to_play', {}],
  [1593500, 'God of War', 'want_to_play', {}],
  [814380, 'Sekiro: Shadows Die Twice', 'want_to_play', {}],
  [1426210, 'It Takes Two', 'want_to_play', {}],
  [413150, 'Stardew Valley', 'on_hold', { owned: true }],
  [105600, 'Terraria', 'on_hold', {}],
  [367520, 'Hollow Knight', 'completed', { platinum: true, owned: true }],
  [504230, 'Celeste', 'completed', { owned: true }],
  [646570, 'Slay the Spire', 'completed', {}],
  [620, 'Portal 2', 'completed', { owned: true }],
  [1794680, 'Vampire Survivors', 'dropped', {}],
];

type ScreenId = 'lista' | 'paleta' | 'catalogo' | 'ficha' | 'proximos' | 'ajustes';
const SCREENS: readonly { id: ScreenId; path: string; title: string }[] = [
  { id: 'lista', path: '/', title: 'Mi lista' },
  { id: 'paleta', path: '/', title: 'Paleta' },
  { id: 'catalogo', path: '/catalogo', title: 'Catálogo' },
  { id: 'ficha', path: '/juego/steam:367520', title: 'Ficha' },
  { id: 'proximos', path: '/?vista=proximos', title: 'Próximos' },
  { id: 'ajustes', path: '/ajustes', title: 'Ajustes' },
];

function agendaExport(): string {
  const today = new Date().toISOString().slice(0, 10);
  const start = Date.now() - 3_600_000;
  const entries: Entry[] = [];
  let lastRank: string | null = null;
  for (const [i, [appid, title, status, flags]] of AGENDA.entries()) {
    const result = addEntry(
      undefined,
      { id: `steam:${appid}`, title, status, flags },
      {
        hlc: formatHlc({ ms: start + i, counter: 0, node: 'disenyo1' }),
        today,
        newOpId: uuidv7,
        lastRank,
      },
    );
    if (!result) throw new Error(`No se pudo apuntar ${appid}`);
    lastRank = result.entry.rank;
    entries.push(result.entry);
  }
  return stringifyExport(
    createExport({ entries, exportedAt: new Date().toISOString(), appVersion: '0.2.0' }),
  );
}

// Código de la página, como texto: `scripts/` compila sin los tipos del navegador.
const COUNT_ENTRIES = `new Promise((resolve) => {
  const request = indexedDB.open('gameagenda');
  request.onupgradeneeded = () => request.transaction.abort();
  request.onerror = () => resolve(0);
  request.onsuccess = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('entries')) { db.close(); resolve(0); return; }
    const count = db.transaction('entries').objectStore('entries').count();
    count.onsuccess = () => { db.close(); resolve(count.result); };
    count.onerror = () => { db.close(); resolve(0); };
  };
})`;

const WATCH_STATUS = `{
  const Native = globalThis.Worker;
  globalThis.Worker = class extends Native {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (event) => {
        const data = event.data;
        if (data && data.type === 'status') globalThis.__rdStatus = data.state;
      });
    }
  };
}`;

function injectCss(text: string): string {
  return `{
    const css = ${JSON.stringify(text)};
    const add = () => {
      if (document.getElementById('rediseno-css')) return;
      const style = document.createElement('style');
      style.id = 'rediseno-css';
      style.textContent = css;
      document.head.append(style);
    };
    if (document.head) add(); else document.addEventListener('DOMContentLoaded', add, { once: true });
  }`;
}

async function waitInPage(page: Page, expression: string, timeoutMs: number): Promise<boolean> {
  const limit = Date.now() + timeoutMs;
  while (Date.now() < limit) {
    if ((await page.evaluate(expression).catch(() => false)) === true) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

/** Espera a que las imágenes visibles hayan cargado (o fallado), como mucho `timeoutMs`. */
async function settleImages(page: Page, timeoutMs = 4000): Promise<void> {
  await waitInPage(
    page,
    `[...document.images].filter((img) => {
      const r = img.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight && r.width > 0;
    }).every((img) => img.complete)`,
    timeoutMs,
  );
  await page.waitForTimeout(250);
}

mkdirSync(OUT, { recursive: true });
const context = await chromium.launchPersistentContext(PROFILE, {
  bypassCSP: true,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  locale: 'es-ES',
  timezoneId: 'Europe/Madrid',
});
await context.addInitScript(WATCH_STATUS);
if (css) await context.addInitScript(injectCss(css));
const page = context.pages()[0] ?? (await context.newPage());

await page.goto(`${BASE}/`);
if (!(await waitInPage(page, "globalThis.__rdStatus === 'full'", 90_000))) {
  console.warn('Aviso: el catálogo no ha llegado a full en 90 s; sigo igual.');
}
if ((await page.evaluate(COUNT_ENTRIES)) === 0) {
  await page.goto(`${BASE}/ajustes/datos`);
  await page.getByLabel('Importar').setInputFiles({
    name: 'rediseno.json',
    mimeType: 'application/json',
    buffer: Buffer.from(agendaExport()),
  });
  await page
    .getByRole('status')
    .filter({ hasText: 'Hemos importado' })
    .waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  console.log(`Agenda de prueba importada: ${AGENDA.length} juegos.`);
}
// El aviso de primera capa de las portadas: una vez, con «Entendido».
await page.goto(`${BASE}/`);
const understood = page.getByRole('button', { name: 'Entendido' });
if (await understood.isVisible({ timeout: 4000 }).catch(() => false)) {
  await understood.click();
  await page.waitForTimeout(500);
}

const widths = (values.widths ?? '').split(',').map(Number);
const themes = (values.themes ?? '').split(',') as ('light' | 'dark')[];
const only = values.screens?.split(',');
const screens = SCREENS.filter((s) => !only || only.includes(s.id));
let shots = 0;
for (const theme of themes) {
  await page.emulateMedia({ colorScheme: theme });
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : width < 1280 ? 760 : 900 });
    for (const screen of screens) {
      await page.goto(`${BASE}${screen.path}`);
      await waitInPage(page, "globalThis.__rdStatus === 'full'", 30_000);
      await page.waitForTimeout(600);
      if (screen.id === 'paleta') {
        await page.keyboard.press('Control+k');
        await page.keyboard.type('hollow', { delay: 40 });
        await page.waitForTimeout(700);
      }
      // El aviso de primera capa sale con la primera portada; una vez cerrado, no vuelve.
      if (await understood.isVisible().catch(() => false)) {
        await understood.click();
        await page.waitForTimeout(400);
      }
      await settleImages(page);
      await page.screenshot({ path: join(OUT, `${theme}-${width}-${screen.id}.png`) });
      shots++;
    }
  }
}
await context.close();
console.log(`${shots} capturas en ${OUT}`);

// La página de comparación: una fila por pantalla, tema y ancho; una columna por variante.
const ORDER = ['antes', 'a', 'b', 'despues'];
const variants = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'perfil')
  .map((d) => d.name)
  .sort(
    (x, y) => ((ORDER.indexOf(x) + 99) % 99) - ((ORDER.indexOf(y) + 99) % 99) || x.localeCompare(y),
  );
const label: Record<string, string> = { antes: 'Ahora', a: 'Dirección A', b: 'Dirección B' };
const rows: string[] = [];
for (const screen of SCREENS) {
  for (const width of [390, 1100, 1440]) {
    for (const theme of ['light', 'dark']) {
      const file = `${theme}-${width}-${screen.id}.png`;
      const cells = variants.filter((v) => existsSync(join(ROOT, v, file)));
      if (cells.length === 0) continue;
      rows.push(`<section data-screen="${screen.id}" data-theme="${theme}" data-width="${width}">
  <h2>${screen.title} · ${width} px · ${theme === 'light' ? 'claro' : 'oscuro'}</h2>
  <div class="grid">${cells
    .map(
      (v) =>
        `<figure><figcaption>${label[v] ?? v}</figcaption><a href="${v}/${file}"><img loading="lazy" src="${v}/${file}" alt="${screen.title}, ${label[v] ?? v}"></a></figure>`,
    )
    .join('')}</div>
</section>`);
    }
  }
}
writeFileSync(
  join(ROOT, 'comparar.html'),
  `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rediseño · comparar</title>
<style>
  :root { color-scheme: light dark; --bg: #f4f4f2; --fg: #1b1b1f; --muted: #6b6b73; --line: #dcdcd8; }
  @media (prefers-color-scheme: dark) { :root { --bg: #121214; --fg: #ececf0; --muted: #9a9aa3; --line: #2a2a2e; } }
  body { margin: 0; padding: 24px 16px 64px; background: var(--bg); color: var(--fg); font: 15px/1.5 "Segoe UI Variable Text", system-ui, sans-serif; }
  header { max-width: 1600px; margin: 0 auto 24px; display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: baseline; }
  h1 { font-size: 22px; font-weight: 600; margin: 0; }
  label { color: var(--muted); font-size: 13px; }
  select { font: inherit; margin-left: 6px; }
  section { max-width: 1600px; margin: 0 auto 40px; }
  h2 { font-size: 14px; font-weight: 600; color: var(--muted); margin: 0 0 10px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 16px; align-items: start; }
  figure { margin: 0; }
  figcaption { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  img { width: 100%; height: auto; display: block; border: 1px solid var(--line); border-radius: 8px; }
</style>
<header><h1>Rediseño visual · comparar</h1>
<label>Pantalla<select id="screen"><option value="">Todas</option>${SCREENS.map((s) => `<option value="${s.id}">${s.title}</option>`).join('')}</select></label>
<label>Ancho<select id="width"><option value="">Todos</option><option>390</option><option>1100</option><option>1440</option></select></label>
<label>Tema<select id="theme"><option value="">Los dos</option><option value="light">Claro</option><option value="dark">Oscuro</option></select></label>
</header>
${rows.join('\n')}
<script>
  const value = (id) => document.getElementById(id).value;
  const pick = () => {
    const s = value('screen'), w = value('width'), t = value('theme');
    for (const el of document.querySelectorAll('section')) {
      el.hidden = (s && el.dataset.screen !== s) || (w && el.dataset.width !== w) || (t && el.dataset.theme !== t);
    }
  };
  for (const id of ['screen', 'width', 'theme']) document.getElementById(id).addEventListener('change', pick);
</script>
</html>`,
);
console.log(`Comparación: ${join(ROOT, 'comparar.html')}`);
