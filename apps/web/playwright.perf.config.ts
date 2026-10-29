// `npm run perf` (§12.4): proyecto `perf` de Playwright en Chromium, con el catálogo completo.
//   1. `perf/search.perf.ts`: la búsqueda de `packages/core` en el hilo principal de una página
//      de prueba (`perf/bench/`), con CPU ×4.
//   2. `perf/app.perf.ts`: la app real con 500 entradas en Mi lista.
//   + `perf/worker-throttling.perf.ts`: ¿se estrangula el Worker dedicado? (a verificar en M0).
// Imprime una tabla con cada medida, su presupuesto y si pasa (`perf/reporter.ts`).
//
// Sus servidores no se reutilizan nunca (`reuseExistingServer: false`) y van en su propio puerto,
// `PERF_PORT` (por defecto 4174) y el siguiente, para no medir una vista previa con el
// mini-catálogo. La app se construye en `dist-perf-app/` para no pisar el *build* de los E2E.
import { defineConfig, devices } from '@playwright/test';
import {
  APP_URL,
  assertCatalog,
  BENCH_PORT,
  BENCH_URL,
  CATALOG_DIR,
  PERF_PORT,
} from './perf/env.ts';

assertCatalog();

export default defineConfig({
  testDir: './perf',
  testMatch: '*.perf.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 900_000,
  reporter: [['list'], ['./perf/reporter.ts']],
  use: { baseURL: APP_URL, trace: 'off' },
  projects: [{ name: 'perf', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // El *build* del modo `e2e` (el de producción con los ganchos de prueba, ver §12.3).
      command: `npx vite build --mode e2e --outDir dist-perf-app && npx vite preview --mode e2e --outDir dist-perf-app --port ${PERF_PORT}`,
      url: APP_URL,
      reuseExistingServer: false,
      env: { CATALOG_DIR },
      timeout: 180_000,
    },
    {
      command: `npx vite build -c perf/vite.config.ts && npx vite preview -c perf/vite.config.ts --port ${BENCH_PORT}`,
      url: BENCH_URL,
      reuseExistingServer: false,
      env: { CATALOG_DIR },
      timeout: 180_000,
    },
  ],
});
