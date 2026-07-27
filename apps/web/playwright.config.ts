import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * `localhost`, not `127.0.0.1`.
 *
 * They are the same host and a different origin. The API's `APP_URL` defaults to
 * `http://localhost:5173` and `originGuard` refuses anything else, so a browser served
 * from `127.0.0.1` sends `Origin: http://127.0.0.1:5173` on every POST and gets a 403
 * before the handler runs. Changing this line means changing `APP_URL` too.
 */
const BASE_URL = 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  // The specs register accounts and write picks against a live server; running two
  // files at once against one database buys nothing and makes failures ambiguous.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Picks get made on phones — the plan's "done when" says so explicitly, and the
    // team picker is a different component at this width (a full-screen dialog rather
    // than a modal), so the smoke has to actually run there.
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],

  /**
   * The real API and the real Vite dev server, not a mock.
   *
   * `RATE_LIMIT=off` is the one deliberate difference from a normal dev run: the
   * register limiter allows 10 accounts an hour from one address, and a two-project
   * run burns four. The limiter keeps its own dedicated test in the API suite, so
   * turning it off here costs no coverage.
   */
  webServer: [
    {
      command: 'pnpm --filter @gridiron/api start',
      cwd: repoRoot,
      url: 'http://127.0.0.1:8082/health',
      reuseExistingServer: process.env.CI === undefined,
      timeout: 60_000,
      env: { RATE_LIMIT: 'off' },
    },
    {
      command: 'pnpm --filter @gridiron/web dev',
      cwd: repoRoot,
      url: BASE_URL,
      reuseExistingServer: process.env.CI === undefined,
      timeout: 60_000,
    },
  ],
});
