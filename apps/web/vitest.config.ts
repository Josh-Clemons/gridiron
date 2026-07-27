import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Component tests for the web app.
 *
 * A separate project from `unit` and `api` because it needs a DOM and the React
 * plugin; it stays in milliseconds all the same, since nothing here touches the
 * network — the components take their data as props.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
  },
});
