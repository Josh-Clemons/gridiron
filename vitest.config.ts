import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      // The web app's component tests need a DOM and the React plugin, so they carry
      // their own config next to the code they exercise.
      'apps/web/vitest.config.ts',
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
      {
        // The importer gets its own Postgres, preloaded with three real seasons of ESPN
        // schedules so the golden workbooks validate against the results they actually
        // had. Separate from the API's so neither suite's truncations disturb the other.
        test: {
          name: 'importer',
          include: ['apps/importer/test/**/*.test.ts'],
          globalSetup: ['apps/importer/test/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.{ts,tsx}'],
    },
  },
});
