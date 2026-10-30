// `npm run perf`, parte 2 (§12.4; RNF-01 a RNF-04, CA1.5): la app real (*build* del modo `e2e`)
// con el catálogo completo y 500 entradas en Mi lista. Con CPU ×4: primera visita (LCP),
// reinicio con caché (`app:list-visible`, `search:ready`, LCP y la primera maquetación de CJK y
// emoji tras calentar las fuentes de reserva) y una sesión que teclea 20
// nombres y apunta 10 (INP, `ui:feedback`, `capture:palette-to-confirm` y tareas largas). Sin
// estrangular, los mismos 20 nombres: `search:keystroke-to-results` para el presupuesto de
// escritorio. El Worker de búsqueda no se estrangula (ver `worker-throttling.perf.ts`).
import { writeFileSync } from 'node:fs';
import { latencyStats, mulberry32, realisticFinals } from '@gameagenda/core/bench';
import { type CoreCatalog, parseCore } from '@gameagenda/core/catalog-format';
import { addEntry, type Entry, type Status } from '@gameagenda/core/entries';
import { normalize } from '@gameagenda/core/normalize';
import { createExport, stringifyExport } from '@gameagenda/core/schemas';
import { formatHlc } from '@gameagenda/core/sync';
import { expect, type Page, test } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';
import { PerfRows } from './rows.ts';

const RATE = 4;
const ENTRIES = 500;
/** Ritmo de tecleo del E2E de la §12.3 (≈9 caracteres por segundo). */
const TYPE_DELAY = 100;
/** Tecleo muy rápido (≈30 caracteres por segundo), solo para informar. */
const FAST_DELAY = 25;
const SLOW = { timeout: 180_000 };

interface PerfBuffers {
  lcp: number[];
  longtasks: { start: number; duration: number }[];
  events: { id: number; name: string; start: number; duration: number }[];
  /** Fotogramas largos (Long Animation Frames), para saber qué hubo en cada tarea larga. */
  frames: { start: number; end: number; scripts: string[]; render: string }[];
}

interface LoafScript {
  readonly invoker: string;
  readonly sourceFunctionName: string;
  readonly duration: number;
}

interface LoafEntry extends PerformanceEntry {
  readonly scripts?: LoafScript[];
  readonly renderStart?: number;
  readonly styleAndLayoutStart?: number;
}

declare global {
  var __gaPerf: PerfBuffers;
}

/** LCP, tareas largas y Event Timing (agrupado por `interactionId`), desde el primer momento. */
function installObservers(): void {
  const perf: PerfBuffers = { lcp: [], longtasks: [], events: [], frames: [] };
  globalThis.__gaPerf = perf;
  // Ganchos de la búsqueda del *build* `e2e`, sin ajustes: solo el tiempo dentro del Worker.
  globalThis.__GA_SEARCH_TEST__ = {};
  const observe = (type: string, options: object, onEntry: (entry: PerformanceEntry) => void) => {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) onEntry(entry);
      }).observe({ type, buffered: true, ...options });
    } catch {
      // Tipo no disponible: la medida queda vacía y la prueba lo dice.
    }
  };
  observe('largest-contentful-paint', {}, (e) => perf.lcp.push(e.startTime));
  observe('longtask', {}, (e) => perf.longtasks.push({ start: e.startTime, duration: e.duration }));
  observe('long-animation-frame', {}, (entry) => {
    const e = entry as LoafEntry;
    const end = e.startTime + e.duration;
    const scripts = (e.scripts ?? [])
      .filter((s) => s.duration >= 5)
      .map(
        (s) =>
          `${s.invoker}${s.sourceFunctionName ? ` (${s.sourceFunctionName})` : ''} ${Math.round(s.duration)} ms`,
      );
    // Reparto del fotograma: tareas antes de pintar, estilo y maquetación, y el resto del pintado.
    const renderStart = e.renderStart || end;
    const layoutStart = e.styleAndLayoutStart || end;
    const render = `tareas ${Math.round(renderStart - e.startTime)} ms, rAF ${Math.round(layoutStart - renderStart)} ms, estilo y maquetación ${Math.round(end - layoutStart)} ms`;
    perf.frames.push({ start: e.startTime, end, scripts, render });
  });
  observe('event', { durationThreshold: 16 }, (e) => {
    const id = (e as PerformanceEventTiming).interactionId;
    if (id) perf.events.push({ id, name: e.name, start: e.startTime, duration: e.duration });
  });
}

function measures(page: Page, name: string): Promise<number[]> {
  return page.evaluate(
    (measure) => performance.getEntriesByName(measure, 'measure').map((e) => e.duration),
    name,
  );
}

async function waitMeasure(page: Page, name: string): Promise<number> {
  await expect.poll(() => measures(page, name), SLOW).not.toHaveLength(0);
  return (await measures(page, name))[0] as number;
}

/** El LCP de la carga actual: la última candidata antes de la primera interacción. */
async function lcp(page: Page): Promise<number | null> {
  return page.evaluate(() => globalThis.__gaPerf.lcp.at(-1) ?? null);
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** Copia de GameAgenda con `games` en Mi lista y estados variados (formato de la §7.5). */
function agendaExport(games: readonly { appid: number; title: string }[]): string {
  const rnd = mulberry32(2026_10_29);
  const statuses: readonly [Status, number][] = [
    ['want_to_play', 0.6],
    ['playing', 0.76],
    ['on_hold', 0.84],
    ['completed', 0.96],
    ['dropped', 1],
  ];
  const start = Date.now() - 3_600_000;
  const entries: Entry[] = [];
  let lastRank: string | null = null;
  for (const [i, game] of games.entries()) {
    const r = rnd();
    const status = statuses.find(([, upTo]) => r < upTo)?.[0] ?? 'want_to_play';
    const result = addEntry(
      undefined,
      { id: `steam:${game.appid}`, title: game.title, status, flags: { owned: rnd() < 0.3 } },
      {
        hlc: formatHlc({ ms: start + i, counter: 0, node: 'perf0001' }),
        today: today(),
        newOpId: uuidv7,
        lastRank,
      },
    );
    if (!result) throw new Error(`No se pudo apuntar ${game.appid}`);
    lastRank = result.entry.rank;
    entries.push(result.entry);
  }
  return stringifyExport(
    createExport({ entries, exportedAt: new Date().toISOString(), appVersion: '0.0.0' }),
  );
}

async function readCatalog(page: Page): Promise<CoreCatalog> {
  const manifest = (await (await page.request.get('/catalog-dev/manifest.json')).json()) as {
    files: { core: { path: string } };
  };
  const core = await (await page.request.get(`/catalog-dev/${manifest.files.core.path}`)).text();
  return parseCore(core);
}

/**
 * Los 20 nombres que se teclean (7 populares, 7 intermedios y 6 de la cola del conjunto
 * realista de la §8.11) y las 500 entradas: juegos de las 20 000 filas más populares cuyo nombre
 * no empieza por ninguno de los 20, para que Intro nunca caiga en uno que ya está en la lista.
 */
function pickGames(catalog: CoreCatalog) {
  const finals = realisticFinals(catalog.name);
  const typed = [...finals.slice(0, 7), ...finals.slice(50, 57), ...finals.slice(100, 106)];
  const keys = typed.map((name) => normalize(name));
  const rnd = mulberry32(42);
  const chosen = new Set<number>();
  while (chosen.size < ENTRIES) {
    const g = Math.floor(rnd() * 20_000);
    const key = normalize(catalog.name[g] as string);
    if (keys.some((k) => key.startsWith(k) || k.startsWith(key))) continue;
    chosen.add(g);
  }
  const games = [...chosen].map((g) => ({
    appid: catalog.appid[g] as number,
    title: catalog.nameEs.get(g) ?? (catalog.name[g] as string),
  }));
  return { typed, games };
}

async function importAgenda(page: Page, json: string): Promise<void> {
  await page.goto('/ajustes/datos');
  await page.getByLabel('Importar').setInputFiles({
    name: 'perf-500.json',
    mimeType: 'application/json',
    buffer: Buffer.from(json),
  });
  await expect(page.getByRole('status').filter({ hasText: 'Hemos importado' })).toContainText(
    `${ENTRIES} altas`,
    SLOW,
  );
  // Guardado en Dexie antes de recargar.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve, reject) => {
              const open = indexedDB.open('gameagenda');
              open.onerror = () => reject(open.error);
              open.onsuccess = () => {
                const db = open.result;
                const count = db.transaction('entries').objectStore('entries').count();
                count.onsuccess = () => {
                  db.close();
                  resolve(count.result);
                };
              };
            }),
        ),
      SLOW,
    )
    .toBe(ENTRIES);
}

// Selectores CSS y no por rol: con 500 filas, calcular nombres accesibles de todo el documento
// le cuesta a Playwright 80–100 ms con ×4 dentro de la ventana medida.
const palette = (page: Page) => page.locator('input.palette__input[role="combobox"]');

/**
 * Teclea cada nombre en la paleta (`Ctrl+K`) carácter a carácter; los de `capture`, con Intro
 * (apunta la primera fila en Quiero jugar); los demás, con Esc. Devuelve la ventana de tiempo.
 */
async function session(
  page: Page,
  names: readonly string[],
  delay: number,
  capture: ReadonlySet<number>,
): Promise<{ start: number; end: number; interactions: number }> {
  const before = await page.evaluate(() => ({
    start: performance.now(),
    interactions: (performance as { interactionCount?: number }).interactionCount ?? 0,
  }));
  let captured = (await measures(page, 'capture:palette-to-confirm')).length;
  for (const [i, name] of names.entries()) {
    // Para situar las tareas largas: qué nombre se tecleaba y si se apuntaba.
    await page.evaluate((label) => performance.mark(label), `perf:${i + 1}:${name}`);
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeFocused();
    await palette(page).pressSequentially(name, { delay });
    if (capture.has(i)) {
      const first = page.locator('.palette__listbox [role="option"]').first();
      await expect(first).toBeVisible();
      expect(
        await first.textContent(),
        `«${name}»: la primera fila ya está en la lista`,
      ).not.toContain('En tu lista');
      await page.keyboard.press('Enter');
      captured += 1;
      await expect
        .poll(async () => (await measures(page, 'capture:palette-to-confirm')).length)
        .toBe(captured);
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(palette(page)).not.toBeFocused();
    await page.waitForTimeout(300);
  }
  const after = await page.evaluate(() => ({
    end: performance.now(),
    interactions: (performance as { interactionCount?: number }).interactionCount ?? 0,
  }));
  return {
    start: before.start,
    end: after.end,
    interactions: after.interactions - before.interactions,
  };
}

/** INP de la ventana (§12.4): la peor interacción, descontando una de cada 50. */
async function inp(page: Page, window: { start: number; end: number; interactions: number }) {
  const events = await page.evaluate(() => globalThis.__gaPerf.events);
  const byInteraction = new Map<number, number>();
  for (const e of events) {
    if (e.start < window.start || e.start > window.end) continue;
    byInteraction.set(e.id, Math.max(byInteraction.get(e.id) ?? 0, e.duration));
  }
  const slow = [...byInteraction.values()].sort((a, b) => b - a);
  const total = Math.max(window.interactions, slow.length);
  const value =
    slow.length === 0 ? 0 : (slow[Math.min(slow.length - 1, Math.floor(total / 50))] as number);
  return { value, slow: slow.length, total, max: slow[0] ?? 0 };
}

/** Tareas largas de la ventana, con lo que el fotograma largo que las contiene atribuye. */
async function longTasks(page: Page, window: { start: number; end: number }) {
  const { longtasks, frames, marks } = await page.evaluate(() => ({
    ...globalThis.__gaPerf,
    marks: performance
      .getEntriesByType('mark')
      .filter((m) => m.name.startsWith('perf:'))
      .map((m) => ({ name: m.name.slice(5), start: m.startTime })),
  }));
  const tasks = longtasks.filter((t) => t.start >= window.start && t.start <= window.end);
  const describe = (t: { start: number; duration: number }) => {
    const frame = frames.find((f) => f.start <= t.start + 1 && f.end >= t.start + t.duration - 1);
    const what = frame
      ? `${frame.render}${frame.scripts.length ? `; ${frame.scripts.join(', ')}` : ''}`
      : 'sin fotograma largo';
    const typing = marks.filter((m) => m.start <= t.start).at(-1);
    const at = typing ? `${typing.name}, +${Math.round(t.start - typing.start)} ms` : '—';
    return `${Math.round(t.duration)} ms con el nombre ${at} (${what})`;
  };
  return { count: tasks.length, detail: tasks.map(describe).join('; ') };
}

/**
 * Primera maquetación de cada escritura sin glifos en la fuente de la app, ya calentadas las
 * fuentes de reserva (`app:fonts-warm`, ver `src/perf/fallback-fonts.ts`): sin calentar, con ×4
 * en Windows, cuesta 30–130 ms. Textos distintos de las muestras del calentamiento.
 */
async function firstScriptLayout(page: Page): Promise<{ worst: number; detail: string }> {
  await expect
    .poll(() => page.evaluate(() => performance.getEntriesByName('app:fonts-warm').length), SLOW)
    .toBe(1);
  const times = await page.evaluate(() => {
    const out: [string, number][] = [];
    for (const [label, text, weight] of [
      ['han 600', '黑神话', 600],
      ['kana 600', 'モンスター', 600],
      ['hangul 600', '로스트아크', 600],
      ['emoji 600', '🔥', 600],
      ['han 700', '三国志', 700],
      ['emoji 700', '😀', 700],
    ] as const) {
      const probe = document.createElement('span');
      probe.textContent = text;
      probe.style.cssText = `position:fixed;top:0;left:0;opacity:0;font-weight:${weight}`;
      document.body.append(probe);
      const start = performance.now();
      probe.getBoundingClientRect();
      out.push([label, performance.now() - start]);
      probe.remove();
    }
    return out;
  });
  return {
    worst: Math.round(Math.max(...times.map(([, ms]) => ms)) * 10) / 10,
    detail: times.map(([label, ms]) => `${label} ${ms.toFixed(1)} ms`).join(', '),
  };
}

/** Frecuencia de fotogramas de la página (60 rAF). */
function refreshRate(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const times: number[] = [];
        const tick = (t: number) => {
          times.push(t);
          if (times.length < 61) requestAnimationFrame(tick);
          else resolve(60_000 / ((times[60] as number) - (times[0] as number)));
        };
        requestAnimationFrame(tick);
      }),
  );
}

/**
 * Presupuesto de escritorio de la pulsación (RNF-02, §8.9): ≤16 ms con pantallas de ≥120 Hz y,
 * por debajo, dos fotogramas (≈33 ms a 60 Hz). 115 deja margen a la medida de una de 120 Hz.
 */
function desktopKeystrokeBudget(hz: number): number {
  return hz >= 115 ? 16 : 2 * (1000 / hz);
}

test('parte 2: app real con el catálogo completo y 500 entradas en Mi lista', async ({
  page,
  browser,
}, testInfo) => {
  const throttled = new PerfRows(`Parte 2 · app real con CPU ×${RATE} y ${ENTRIES} entradas`);
  const desktop = new PerfRows(`Parte 2 · app real sin estrangular (escritorio)`);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(installObservers);
  const cdp = await page.context().newCDPSession(page);
  const throttle = (rate: number) => cdp.send('Emulation.setCPUThrottlingRate', { rate });

  try {
    // 1. Primera visita con ×4: LCP antes de cualquier interacción (el catálogo baja después).
    await throttle(RATE);
    await page.goto('/');
    await waitMeasure(page, 'search:full');
    const firstLcp = await lcp(page);

    // 2. Las 500 entradas, importadas desde Ajustes › Datos (sin estrangular: no se mide).
    await throttle(1);
    const catalog = await readCatalog(page);
    expect(catalog.count, 'el catálogo completo').toBeGreaterThan(190_000);
    const { typed, games } = pickGames(catalog);
    await importAgenda(page, agendaExport(games));
    await page.goto('/');
    await waitMeasure(page, 'search:full');

    // 3. Reinicio con caché con ×4: Mi lista, búsqueda lista y LCP.
    await throttle(RATE);
    await page.reload();
    const listVisible = await waitMeasure(page, 'app:list-visible');
    const ready = await waitMeasure(page, 'search:ready');
    await expect(page.getByRole('heading', { name: /^Quiero jugar \(\d+\)$/ })).toBeVisible();
    const restartLcp = await lcp(page);
    await waitMeasure(page, 'search:full');
    const fonts = await firstScriptLayout(page);

    // 4. Teclear 20 nombres y apuntar 10 con ×4.
    const captureSet = new Set(typed.map((_, i) => i).filter((i) => i % 2 === 0));
    // `PERF_TRACE=1`: traza de Chrome de esta sesión (ábrela en DevTools › Rendimiento).
    const tracing = Boolean(process.env.PERF_TRACE);
    if (tracing) {
      await browser.startTracing(page, {
        categories: [
          'devtools.timeline',
          'disabled-by-default-devtools.timeline',
          'disabled-by-default-devtools.timeline.invalidationTracking',
          'v8.execute',
        ],
      });
    }
    const slowWindow = await session(page, typed, TYPE_DELAY, captureSet);
    if (tracing) {
      const trace = testInfo.outputPath('traza-cpu-x4.json');
      writeFileSync(trace, await browser.stopTracing());
      console.log(`Traza de la sesión con ×${RATE}: ${trace}`);
    }
    const slowInp = await inp(page, slowWindow);
    const slowLong = await longTasks(page, slowWindow);
    const feedback = await measures(page, 'ui:feedback');
    const captureTimes = await measures(page, 'capture:palette-to-confirm');
    const keysX4 = await measures(page, 'search:keystroke-to-results');

    // 5. Sin estrangular: los mismos 20 nombres (ya no se apunta), al ritmo de la §12.3 y rápido.
    await throttle(1);
    const hz = await refreshRate(page);
    await page.evaluate(() => {
      performance.clearMeasures('search:keystroke-to-results');
      globalThis.__gaSearchTest?.workerMs.splice(0);
    });
    const deskWindow = await session(page, typed, TYPE_DELAY, new Set());
    const keys = latencyStats(await measures(page, 'search:keystroke-to-results'));
    const inWorker = latencyStats(
      await page.evaluate(() => [...(globalThis.__gaSearchTest?.workerMs ?? [])]),
    );
    const deskLong = await longTasks(page, deskWindow);
    await page.evaluate(() => performance.clearMeasures('search:keystroke-to-results'));
    await session(page, typed, FAST_DELAY, new Set());
    const fastKeys = latencyStats(await measures(page, 'search:keystroke-to-results'));

    const frame = 1000 / hz;
    throttled.add({ metric: 'Primera visita: LCP', value: firstLcp, limit: 2500 });
    throttled.add({
      metric: 'Reinicio con caché: Mi lista visible (app:list-visible)',
      value: Math.round(listVisible),
      limit: 1000,
    });
    throttled.add({
      metric: 'Reinicio con caché: búsqueda lista (search:ready)',
      value: Math.round(ready),
      limit: 2000,
    });
    throttled.add({ metric: 'Reinicio con caché: LCP', value: restartLcp, limit: 2500 });
    throttled.add({
      metric: 'Primera maquetación de han, kana, hangul y emoji, ya calentadas (peor)',
      value: fonts.worst,
      limit: 50,
      note: fonts.detail,
    });
    throttled.add({
      metric: `INP (20 nombres, 10 altas)`,
      stat: 'INP',
      value: slowInp.value,
      max: slowInp.max,
      n: slowInp.total,
      limit: 200,
      note: `${slowInp.slow} de ${slowInp.total} interacciones ≥16 ms; Event Timing redondea a 8 ms`,
    });
    throttled.addStats({
      metric: 'Toque → respuesta (ui:feedback, Intro)',
      stat: 'máx.',
      stats: { ...latencyStats(feedback), p95: latencyStats(feedback).max },
      limit: 100,
    });
    throttled.addStats({
      metric: 'Apuntar: abrir paleta → confirmación (capture:palette-to-confirm)',
      stat: 'p50',
      stats: { ...latencyStats(captureTimes), p95: latencyStats(captureTimes).p50 },
      limit: 3000,
      note: `tecleando a ${TYPE_DELAY} ms por carácter (§12.3)`,
    });
    throttled.add({
      metric: 'Tareas largas (>50 ms) al teclear o apuntar',
      stat: 'número',
      value: slowLong.count,
      unit: '',
      limit: 0,
      ...(slowLong.count > 0 && { note: slowLong.detail }),
    });
    throttled.addStats({
      metric: 'Pulsación → resultados (search:keystroke-to-results)',
      stats: latencyStats(keysX4),
    });

    desktop.addStats({
      metric: `Pulsación → resultados (search:keystroke-to-results), ${TYPE_DELAY} ms por carácter`,
      stats: keys,
      limit: Math.round(desktopKeystrokeBudget(hz) * 10) / 10,
      note: `fotogramas a ${hz.toFixed(0)} Hz (${frame.toFixed(1)} ms; presupuesto: ≤16 ms a ≥120 Hz y, por debajo, 2 fotogramas); dentro del Worker: p50 ${inWorker.p50.toFixed(1)} ms, p95 ${inWorker.p95.toFixed(1)} ms`,
    });
    desktop.addStats({
      metric: `Pulsación → resultados, tecleo rápido (${FAST_DELAY} ms por carácter)`,
      stats: fastKeys,
    });
    desktop.add({
      metric: 'Tareas largas (>50 ms) al teclear',
      stat: 'número',
      value: deskLong.count,
      unit: '',
      limit: 0,
      ...(deskLong.count > 0 && { note: deskLong.detail }),
    });
    expect(errors, 'errores de la página').toEqual([]);
  } finally {
    await throttle(1).catch(() => undefined);
    await throttled.attach(testInfo);
    await desktop.attach(testInfo);
  }
});
