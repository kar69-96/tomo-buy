import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: false,
    // The prime-directive integration test launches a real headless browser; give it room.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Exclude tests, the barrel, and the Playwright I/O glue (exercised live by the
      // prime-directive gate test, but its launch fallbacks need a real browser to branch).
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        // Interface-only (no runtime) + Playwright I/O glue exercised live by the gate test.
        'src/browser/driver.ts',
        'src/browser/playwright-driver.ts',
      ],
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
});
