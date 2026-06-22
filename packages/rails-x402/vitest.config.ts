import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Excluded: the barrel re-export; the X402Rail stub (P0 settlement is
      // deferred to phase-10); and the on-chain RPC helpers (need a live Base
      // node / CDP — not unit-testable in CI). The pure ported logic IS covered.
      exclude: ['src/index.ts', 'src/**/*.test.ts', 'src/client/types.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 },
      reporter: ['text', 'text-summary'],
    },
  },
});
