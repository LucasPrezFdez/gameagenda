import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Las constantes de compilación de `apps/web/vite.config.ts` que usa el código que se prueba aquí.
  define: { __STEAM_IMPORT__: 'true' },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'pipeline/**/*.test.ts',
      'apps/web/src/**/*.test.{ts,tsx}',
      'apps/web/worker/**/*.test.ts',
      'apps/desktop/*.test.ts',
      'scripts/**/*.test.ts',
    ],
  },
});
