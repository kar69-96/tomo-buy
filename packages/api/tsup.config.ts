import { defineConfig } from 'tsup';

export default defineConfig({
  // `index` is the library surface; `start-server` is the runnable bootstrap (`pnpm start`).
  entry: { index: 'src/index.ts', 'start-server': 'src/start-server.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'node20',
  shims: true,
});
