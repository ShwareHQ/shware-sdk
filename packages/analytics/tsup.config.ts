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
    entry: { index: 'src/next/index.tsx' },
    external: ['react', 'next', '../index'],
    outDir: 'dist/next',
  },
  {
    ...cfg,
    entry: { index: 'src/react/index.tsx' },
    external: ['react'],
    outDir: 'dist/react',
  },
  {
    ...cfg,
    entry: { index: 'src/react-router/index.tsx' },
    external: ['react', 'react-router', '../index'],
    outDir: 'dist/react-router',
  },
]);
