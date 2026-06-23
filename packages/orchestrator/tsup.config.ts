import { defineConfig } from 'tsup';

export default defineConfig({
  // Two entries: the package barrel, and a standalone workflow bundle the
  // Temporal worker registers by path (real .js → no TS .js-extension pitfall).
  entry: { index: 'src/index.ts', workflow: 'src/workflow/checkout.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'node20',
  shims: true,
});
