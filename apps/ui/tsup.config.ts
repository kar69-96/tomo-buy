import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', 'start-ui': 'src/start-ui.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'node20',
  shims: true,
});
