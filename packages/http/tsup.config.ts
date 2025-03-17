import { defineConfig, Options } from 'tsup';

const cfg: Options = {
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: false,
  dts: true,
  format: ['esm', 'cjs'],
  outExtension: ({ format }) => {
    return format === 'esm' ? { js: '.mjs' } : { js: '.cjs' };
  },
};

export default defineConfig([
  {
    ...cfg,
    entry: { index: 'src/index.ts' },
    outDir: 'dist',
  },
  {
    ...cfg,
    entry: { index: 'src/polyfills/index.ts' },
    outDir: 'dist/polyfills',
  },
]);
