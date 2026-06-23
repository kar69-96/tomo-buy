import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: false,
    // Integration tests boot a real Temporal dev server; give them headroom.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts', // barrel re-exports only
        // The workflow executes from the pre-bundled dist/workflow.js inside the
        // Temporal sandbox, so v8 can't instrument the source here. Its behaviour
        // is proven by the live-server integration tests in workflow/checkout.test.ts.
        'src/workflow/checkout.ts',
      ],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 80 },
    },
  },
});
