import { defineConfig, Options } from 'tsup';
import { esbuildPluginFilePathExtensions } from 'esbuild-plugin-file-path-extensions';

const cfg: Options = {
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: false,
  dts: true,
  format: ['esm', 'cjs'],
  outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
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
    external: ['bowser', 'cookie', 'uuid'],
    outDir: 'dist/web',
  },
  {
    ...cfg,
    entry: { index: 'src/next/index.tsx' },
    external: ['react', 'next'],
    outDir: 'dist/next',
    esbuildPlugins: [esbuildPluginFilePathExtensions()],
  },
  {
    ...cfg,
    entry: { index: 'src/react/index.tsx' },
    external: ['react'],
    outDir: 'dist/react',
    esbuildPlugins: [esbuildPluginFilePathExtensions()],
  },
  {
    ...cfg,
    entry: { index: 'src/react-router/index.tsx' },
    external: ['react', 'react-router'],
    outDir: 'dist/react-router',
    esbuildPlugins: [esbuildPluginFilePathExtensions()],
  },
]);
