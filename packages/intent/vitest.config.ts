import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The barrel and the real OpenRouter provider wiring (network-only, no
      // unit-testable logic) are excluded; all parsing logic lives in testable files.
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/provider.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 80 },
    },
  },
});
