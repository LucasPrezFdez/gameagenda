// *Build* de la página de prueba de `npm run perf` (§12.4), aparte del de la app: sale en
// `dist-perf/` y nunca en `dist/` (lo comprueba `scripts/size-gate.ts`). `vite preview` la sirve
// con el catálogo de `CATALOG_DIR` en `/catalog-dev/`, como `npm run preview`.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { catalogDevPlugin } from '../catalog-dev-plugin.ts';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('./bench', import.meta.url)),
  plugins: [catalogDevPlugin(repoRoot)],
  build: {
    outDir: fileURLToPath(new URL('../dist-perf', import.meta.url)),
    emptyOutDir: true,
  },
  preview: { host: '127.0.0.1', strictPort: true },
});
