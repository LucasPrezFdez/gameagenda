import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
// Otro puerto con `E2E_PORT` (p. ej., para no reutilizar la vista previa de otro *worktree*).
const port = Number(process.env.E2E_PORT ?? 4173);
// El mini-catálogo versionado (§13.5); con `CATALOG_DIR=pipeline/out`, el catálogo completo.
const catalogDir = process.env.CATALOG_DIR ?? 'fixtures/catalog';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  reporter: isCI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  // En CI solo Chromium; WebKit (móvil emulado) se ejecuta en local (ver §12.1).
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(isCI ? [] : [{ name: 'webkit-movil', use: { ...devices['iPhone 15'] } }]),
  ],
  // *Build* del modo `e2e` (§12.3): el de producción más los ganchos de prueba de la búsqueda.
  webServer: {
    command: `npm run build:e2e && npx vite preview --mode e2e --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !isCI,
    env: { CATALOG_DIR: catalogDir },
    timeout: 180_000,
  },
});
