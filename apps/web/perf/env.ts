// Entorno de `npm run perf` (§12.4), compartido por `playwright.perf.config.ts` y las pruebas.
// Puertos propios (`PERF_PORT`, por defecto 4174, y el siguiente para la página de prueba): la
// app se sirve con el catálogo completo y nunca debe reutilizar una vista previa del
// mini-catálogo de los E2E.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PERF_PORT = Number(process.env.PERF_PORT ?? 4174);
export const BENCH_PORT = PERF_PORT + 1;
export const APP_URL = `http://127.0.0.1:${PERF_PORT}`;
export const BENCH_URL = `http://127.0.0.1:${BENCH_PORT}/`;

/** Catálogo completo de `npm run catalog:frozen` (o, con el pipeline, de `catalog:build`). */
export const CATALOG_DIR = process.env.CATALOG_DIR ?? 'pipeline/out';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

/** Falla pronto, con el remedio, si falta el catálogo. */
export function assertCatalog(): void {
  if (!existsSync(`${repoRoot}${CATALOG_DIR}/manifest.json`)) {
    throw new Error(
      `npm run perf necesita el catálogo completo en ${CATALOG_DIR}/: ejecuta antes «npm run catalog:frozen» en la raíz.`,
    );
  }
}
