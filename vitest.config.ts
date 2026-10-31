import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'pipeline/**/*.test.ts',
      'apps/web/src/**/*.test.{ts,tsx}',
      'apps/desktop/*.test.ts',
      'scripts/**/*.test.ts',
    ],
  },
});
