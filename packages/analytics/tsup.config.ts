import { defineConfig, Options } from 'tsup';

const cfg: Options = {
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: false,
  dts: true,
  format: ['esm', 'cjs'],
};

export default defineConfig([
  {
    ...cfg,
    entry: { index: 'src/index.ts' },
    outDir: 'dist',
  },
  {
    ...cfg,
    entry: { index: 'src/web/index.ts' },
    outDir: 'dist/web',
  },
  {
    ...cfg,
    entry: { index: 'src/react/index.tsx' },
    outDir: 'dist/react',
  },
]);
