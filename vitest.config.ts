import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // Pure packages: no I/O, so these stay in milliseconds.
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts'],
        },
      },
      {
        // The API talks to a real Postgres, started once per run by the global setup.
        // Serial on purpose: the suites share that database and truncate between tests.
        test: {
          name: 'api',
          include: ['apps/api/test/**/*.test.ts'],
          globalSetup: ['apps/api/test/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
    },
  },
});
