// `npm run perf`, parte 1 (§8.9, §12.4; CA1.5 y CA1.11): la búsqueda de `packages/core` en el
// hilo principal de la página de prueba (`perf/bench/`), con CPU ×4 por CDP, sobre el catálogo
// completo. Mide el reinicio con caché hasta `scan` y hasta `full` y teclea el conjunto realista
// de la §8.11 (150 nombres, 2 084 pulsaciones) en `full` y en `scan`, más el nivel 4.
import { expect, type Page, test } from '@playwright/test';
import type { BenchApi } from './bench-api.ts';
import { BENCH_URL } from './env.ts';
import { PerfRows } from './rows.ts';

const RATE = 4;

type Op = Exclude<keyof BenchApi, 'marker'>;

/** Llama a un paso de la página de prueba (`globalThis.gaPerfBench`). */
function bench<K extends Op>(
  page: Page,
  op: K,
  ...args: Parameters<BenchApi[K]>
): Promise<Awaited<ReturnType<BenchApi[K]>>> {
  return page.evaluate(
    ([name, params]) => {
      const api = globalThis.gaPerfBench;
      if (!api) throw new Error('Falta la página de prueba');
      return (api[name] as (...a: unknown[]) => Promise<unknown>)(...params);
    },
    [op, args] as const,
  ) as Promise<Awaited<ReturnType<BenchApi[K]>>>;
}

test('parte 1: búsqueda de core en el hilo principal con CPU ×4', async ({ page }, testInfo) => {
  const rows = new PerfRows(`Parte 1 · búsqueda de core en el hilo principal (CPU ×${RATE})`);
  await page.goto(BENCH_URL);
  await page.waitForFunction(() => globalThis.gaPerfBench?.marker === 'gameagenda-perf-bench');

  // Primera visita sin estrangular y sin medir: deja el catálogo en Cache Storage.
  const primed = await bench(page, 'prime');
  expect(primed.count, 'el catálogo completo').toBeGreaterThan(190_000);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
  try {
    // Reinicio con caché hasta el índice completo, y tecleo en `full` con el nivel 4.
    const restart = await bench(page, 'restart', null);
    const full = await bench(page, 'type', { fuzzy: true });
    // Otro reinicio, parado en el puente de escaneo, y tecleo en `scan`.
    const held = await bench(page, 'restart', 'scan');
    const scan = await bench(page, 'type', { fuzzy: false });
    expect(full.state).toBe('full');
    expect(scan.state).toBe('scan');
    await bench(page, 'release');
    const phases = await bench(page, 'breakdown');

    rows.add({
      metric: 'Reinicio con caché → escaneo listo (scan)',
      stat: 'peor de 2',
      value: Math.max(restart.scanMs, held.scanMs),
      limit: 2000,
      note: `${restart.scanMs} y ${held.scanMs} ms: leer Cache Storage, comprobar el sha256, leer el TSV y normalizar las claves (CA1.11)`,
    });
    rows.add({
      metric: 'Desglose hasta scan, sin ceder el turno',
      value: Math.round(phases.cacheMs + phases.readMs + phases.keysMs),
      note: `Cache Storage + sha256 ${Math.round(phases.cacheMs)} ms, lectura del TSV ${Math.round(phases.readMs)} ms, claves, exactos y pajar ${Math.round(phases.keysMs)} ms`,
    });
    rows.add({ metric: 'Reinicio con caché → índice completo (full)', value: restart.fullMs });
    rows.addStats({
      metric: `Pulsación → resultados en full`,
      stats: full.keystrokes,
      limit: 50,
      note: `${full.over16} pulsaciones >16 ms y ${full.over50} >50 ms`,
    });
    rows.addStats({
      metric: `Pulsación → resultados en scan`,
      stats: scan.keystrokes,
      limit: 50,
      note: `${scan.over16} pulsaciones >16 ms y ${scan.over50} >50 ms`,
    });
    rows.addStats({
      metric: 'Nivel 4 diferido (consultas que lo activan)',
      stats: full.suggest,
      limit: 70,
      note: 'conjunto dorado + 150 nombres finales; la tarea entera, cediendo el turno entre bloques',
    });
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => undefined);
    await rows.attach(testInfo);
  }
});
