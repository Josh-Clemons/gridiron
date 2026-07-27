import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

/**
 * jsdom has no `matchMedia`, and MUI's responsive helpers call it on first render.
 *
 * It always answers "no match", which lands the components in their desktop layout.
 * That's the wrong half of a mobile-first app to be testing, but the breakpoint only
 * decides whether a dialog is full-screen — no rule, lock or score depends on it.
 */
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});
