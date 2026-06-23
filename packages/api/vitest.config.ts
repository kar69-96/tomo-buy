import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: false,
    // The happy-path integration test spins up a real Temporal dev server.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts', // barrel re-exports only
        'src/ports.ts', // type-only declarations
        'src/start.ts', // live composition root — integration glue, exercised by the live run
        'src/start-server.ts', // process entry point; exercised by the live run, not unit tests
        'src/composition.ts', // real Agentcard/Playwright/Vault construction — live-run glue
        'src/test-support/**', // shared test fakes
      ],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 80 },
    },
  },
});
