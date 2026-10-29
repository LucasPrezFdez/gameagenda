import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'pipeline/**/*.test.ts',
      'apps/web/src/**/*.test.{ts,tsx}',
      'scripts/**/*.test.ts',
    ],
  },
});
