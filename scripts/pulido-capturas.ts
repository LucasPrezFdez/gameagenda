// Capturas para el pulido visual y las animaciones (docs/diseno/pulido/).
//
// Abre `ga-web` de producción con el perfil de pruebas del rediseño (`.cache/rediseno/perfil-local`,
// con la agenda de 19 juegos y sin Service Worker, así que siempre es la versión publicada) y, para
// cada tema de `docs/diseno/pulido/opciones.json`, fotografía cada opción inyectando su hoja de
// estilos encima de la app real. También guarda instantáneas del DOM y la hoja de estilos de
// producción, con las que `docs/diseno/pulido/pagina.mjs` monta las demostraciones de movimiento.
//
//   node scripts/pulido-capturas.ts                    todo
//   node scripts/pulido-capturas.ts --solo=lateral,filas
//   node scripts/pulido-capturas.ts --solo=instantaneas
//
// Todo va a `.cache/pulido/`, que no se versiona.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Page } from '@playwright/test';

const { values } = parseArgs({
  options: {
    solo: { type: 'string' },
    url: { type: 'string', default: 'https://ga-web.gameagenda.workers.dev' },
  },
});

interface Shot {
  readonly id: string;
  readonly path: string;
  readonly width: number;
  readonly height?: number;
  readonly theme: 'light' | 'dark';
  /** Lo que se hace antes de la foto: `paleta`, `menu`, `aviso`, `encima` o `encogida`. */
  readonly prepare?: string;
  /** Recorte: un selector (su caja, con `pad` px alrededor) o `x,y,ancho,alto`. */
  readonly clip?: string;
  readonly pad?: number;
}
interface Topic {
  readonly id: string;
  readonly shots?: readonly Shot[];
  readonly options: readonly { readonly id: string; readonly css?: readonly string[] }[];
}

const HERE = resolve('docs/diseno/pulido');
const OUT = resolve('.cache/pulido');
const PROFILE = resolve('.cache/rediseno/perfil-local');
const BASE = (values.url ?? '').replace(/\/$/, '');
const topics = JSON.parse(readFileSync(join(HERE, 'opciones.json'), 'utf8')) as Topic[];
// Las hojas de las opciones: bloques de `opciones.css` que empiezan con «/*@@ nombre */».
const blocks = new Map<string, string>();
for (const part of readFileSync(join(HERE, 'opciones.css'), 'utf8').split('/*@@ ').slice(1)) {
  const end = part.indexOf('*/');
  blocks.set(part.slice(0, end).trim(), part.slice(end + 2));
}
function block(name: string): string {
  const css = blocks.get(name);
  if (css === undefined) throw new Error(`No hay bloque «${name}» en opciones.css`);
  return css;
}
const only = values.solo?.split(',');
const wanted = (id: string): boolean => !only || only.includes(id);

// Código de la página, como texto: `scripts/` compila sin los tipos del navegador.
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
const setCss = (text: string): string => `{
  let style = document.getElementById('pulido-css');
  if (!style) {
    style = document.createElement('style');
    style.id = 'pulido-css';
    document.head.append(style);
  }
  style.textContent = ${JSON.stringify(text)};
}`;
const ALL_CSS = `[...document.styleSheets]
  .filter((sheet) => sheet.ownerNode && sheet.ownerNode.id !== 'pulido-css')
  .map((sheet) => { try { return [...sheet.cssRules].map((rule) => rule.cssText).join('\\n'); } catch { return ''; } })
  .join('\\n')`;
const IMAGES_DONE = `[...document.images].filter((img) => {
  const r = img.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight && r.width > 0;
}).every((img) => img.complete)`;

async function waitInPage(page: Page, expression: string, timeoutMs: number): Promise<boolean> {
  const limit = Date.now() + timeoutMs;
  while (Date.now() < limit) {
    if ((await page.evaluate(expression).catch(() => false)) === true) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

mkdirSync(OUT, { recursive: true });
const context = await chromium.launchPersistentContext(PROFILE, {
  bypassCSP: true,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  locale: 'es-ES',
  timezoneId: 'Europe/Madrid',
  serviceWorkers: 'block',
});
await context.addInitScript(WATCH_STATUS);
const page = context.pages()[0] ?? (await context.newPage());

/** Deja la pantalla lista: tema, tamaño, ruta, catálogo cargado y lo que pida `prepare`. */
async function open(shot: Shot): Promise<void> {
  await page.emulateMedia({ colorScheme: shot.theme, reducedMotion: 'reduce' });
  await page.setViewportSize({
    width: shot.width,
    height: shot.height ?? (shot.width < 768 ? 844 : 900),
  });
  await page.goto(`${BASE}${shot.path}`);
  await waitInPage(page, "globalThis.__rdStatus === 'full'", 60_000);
  await page.waitForTimeout(500);
  const understood = page.getByRole('button', { name: 'Entendido' });
  if (await understood.isVisible().catch(() => false)) await understood.click();
  const toggle = page.getByRole('button', { name: 'Barra lateral' });
  if (shot.width >= 768 && (await toggle.count()) > 0) {
    const collapsed = (await toggle.getAttribute('aria-expanded')) === 'false';
    if (collapsed !== (shot.prepare === 'encogida')) await toggle.click();
  }
  const row = page.locator('.entry-row').nth(2);
  switch (shot.prepare) {
    case 'paleta':
      if (shot.width < 768) await page.locator('.palette__input').click({ force: true });
      else await page.keyboard.press('Control+k');
      await page.keyboard.type('hollow', { delay: 40 });
      await page.waitForTimeout(700);
      break;
    case 'menu':
      await row.hover();
      await row.locator('.status-button').click();
      break;
    case 'aviso':
      // Marca «Comprado» y deja el aviso con Deshacer a la vista (dura unos segundos).
      if (shot.width < 768) {
        await row.locator('.status-button').click();
        await page.locator('.menu__item', { hasText: 'En pausa' }).click();
      } else {
        await row.hover();
        await row.locator('.flag-toggle--owned').click();
      }
      await page.mouse.move(shot.width - 4, 4);
      break;
    case 'encima':
      await row.hover();
      break;
    default:
      await page.mouse.move(shot.width - 4, 4);
  }
  await waitInPage(page, IMAGES_DONE, 4000);
  await page.waitForTimeout(300);
}

async function clipOf(
  shot: Shot,
): Promise<{ x: number; y: number; width: number; height: number } | undefined> {
  if (!shot.clip) return undefined;
  const numbers = shot.clip.split(',').map(Number);
  if (numbers.length === 4 && numbers.every((n) => !Number.isNaN(n))) {
    const [x = 0, y = 0, width = 0, height = 0] = numbers;
    return { x, y, width, height };
  }
  const box = await page.locator(shot.clip).first().boundingBox();
  if (!box) return undefined;
  const pad = shot.pad ?? 0;
  const viewport = page.viewportSize() ?? { width: shot.width, height: 900 };
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  return {
    x,
    y,
    width: Math.min(viewport.width - x, box.width + 2 * pad),
    height: Math.min(viewport.height - y, box.height + 2 * pad),
  };
}

let shots = 0;
for (const topic of topics) {
  if (!wanted(topic.id) || !topic.shots) continue;
  for (const shot of topic.shots) {
    let opened = false;
    for (const option of topic.options) {
      const css = (option.css ?? []).map(block).join('\n');
      // El aviso caduca y el menú se cierra al tocar: esas pantallas se preparan en cada opción.
      if (!opened || shot.prepare === 'aviso') {
        await open(shot);
        opened = true;
      }
      await page.evaluate(setCss(css));
      await page.waitForTimeout(250);
      const clip = await clipOf(shot);
      await page.screenshot({
        path: join(OUT, `${topic.id}--${option.id}--${shot.id}.png`),
        ...(clip ? { clip } : {}),
      });
      shots++;
      if (shot.prepare === 'aviso') {
        const undo = page.getByRole('button', { name: 'Deshacer' });
        if (await undo.isVisible().catch(() => false)) await undo.click();
        await page.waitForTimeout(300);
      }
    }
  }
  console.log(`${topic.id}: hecho`);
}

// Instantáneas del DOM para las demostraciones de movimiento: la app tal cual, sin su JavaScript.
if (wanted('instantaneas')) {
  const snaps: readonly Shot[] = [
    { id: 'pc-lista', path: '/', width: 1440, theme: 'light' },
    { id: 'pc-catalogo', path: '/catalogo', width: 1440, theme: 'light' },
    { id: 'pc-paleta', path: '/', width: 1440, theme: 'light', prepare: 'paleta' },
    { id: 'pc-menu', path: '/', width: 1440, theme: 'light', prepare: 'menu' },
    { id: 'pc-aviso', path: '/', width: 1440, theme: 'light', prepare: 'aviso' },
    { id: 'pc-ficha', path: '/juego/steam:367520', width: 1100, theme: 'light' },
    { id: 'movil-lista', path: '/', width: 390, theme: 'light' },
    { id: 'movil-catalogo', path: '/catalogo', width: 390, theme: 'light' },
    { id: 'movil-ficha', path: '/juego/steam:367520', width: 390, theme: 'light' },
    { id: 'movil-paleta', path: '/', width: 390, theme: 'light', prepare: 'paleta' },
  ];
  for (const snap of snaps) {
    await open(snap);
    await page.evaluate(setCss(''));
    const html = await page.evaluate(
      `(() => { const root = document.documentElement; return { attrs: [...root.attributes].map((a) => [a.name, a.value]), body: document.body.innerHTML }; })()`,
    );
    writeFileSync(join(OUT, `snap-${snap.id}.json`), JSON.stringify(html));
    if (snap.prepare === 'aviso') {
      const undo = page.getByRole('button', { name: 'Deshacer' });
      if (await undo.isVisible().catch(() => false)) await undo.click();
    }
  }
  writeFileSync(join(OUT, 'app.css'), (await page.evaluate(ALL_CSS)) as string);
  console.log('instantaneas: hecho');
}

await context.close();
console.log(`${shots} capturas en ${OUT}`);
