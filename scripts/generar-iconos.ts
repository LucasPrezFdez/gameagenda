// Genera todos los iconos de la app a partir de los dos originales del logo (Grafito):
// - `apps/web/public/icons/icon.svg`: con esquinas; es también el favicon;
// - `apps/web/icons/icon-sangre.svg`: a sangre, para iOS y la «maskable» de Android, que ponen
//   sus propias esquinas.
//
//   node scripts/generar-iconos.ts
//
// Las PNG de la PWA las rasteriza Chromium (Playwright). Las de la app de escritorio, con el
// `.ico` de 16 a 256 px, las saca `tauri icon` de una PNG de 1024 px, y solo se copian las que usa
// `tauri.conf.json`.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const WEB = join(ROOT, 'apps/web/public/icons');
const DESKTOP = join(ROOT, 'apps/desktop');
const ROUNDED = join(WEB, 'icon.svg');
const BLEED = join(ROOT, 'apps/web/icons/icon-sangre.svg');

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

/** Rasteriza `svg` a `size` px. Sin `opaque`, lo que queda fuera de las esquinas es transparente. */
async function render(svg: string, size: number, out: string, opaque = false): Promise<void> {
  const data = readFileSync(svg).toString('base64');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}img{display:block}</style><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${data}">`,
  );
  // Como texto: `scripts/` compila sin los tipos del navegador.
  await page.evaluate("document.querySelector('img').decode()");
  await page.screenshot({ path: out, omitBackground: !opaque });
  console.log(`✓ ${out.slice(ROOT.length + 1)} (${size} px)`);
}

// PWA y navegador.
await render(ROUNDED, 192, join(WEB, 'icon-192.png'));
await render(ROUNDED, 512, join(WEB, 'icon-512.png'));
await render(BLEED, 512, join(WEB, 'icon-maskable-512.png'), true);
// iOS no admite transparencia y pone sus esquinas.
await render(BLEED, 180, join(WEB, 'apple-touch-icon.png'), true);

// App de escritorio.
const work = mkdtempSync(join(tmpdir(), 'ga-iconos-'));
const master = join(work, 'icon-1024.png');
await render(ROUNDED, 1024, master);
await browser.close();

const out = join(work, 'tauri');
mkdirSync(out);
// El CLI de Tauri, sin `npx` ni *shell*: `execFileSync` no escapa los argumentos con `shell`.
const tauri = createRequire(join(DESKTOP, 'package.json')).resolve('@tauri-apps/cli/tauri.js');
execFileSync(process.execPath, [tauri, 'icon', master, '--output', out], {
  cwd: DESKTOP,
  stdio: ['ignore', 'ignore', 'inherit'],
});
for (const file of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.png', 'icon.ico']) {
  copyFileSync(join(out, file), join(DESKTOP, 'src-tauri/icons', file));
  console.log(`✓ apps/desktop/src-tauri/icons/${file}`);
}
