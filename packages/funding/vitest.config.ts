import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The barrel re-export and the manual sandbox script (needs a live sk_test_
      // key + human checkout) can't be unit-covered in CI.
      exclude: ['src/index.ts', 'src/**/*.test.ts', 'scripts/**'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 },
      reporter: ['text', 'text-summary'],
    },
  },
});
