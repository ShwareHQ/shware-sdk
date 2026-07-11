import { defineConfig } from 'tsdown';

// typescript@7 is the native (tsgo) compiler and no longer exposes the JS
// compiler API that dts generation relies on, so point the dts plugin at the
// native binary instead.
const tsPackageJson = import.meta.resolve('typescript/package.json');
const { default: getTscExePath } = await import(new URL('lib/getExePath.js', tsPackageJson).href);

export default defineConfig({
  entry: ['src/**/*.ts', 'src/**/*.tsx', '!src/**/*.test.*'],
  outDir: 'dist',
  format: ['esm', 'cjs'],
  outExtensions: ({ format }) =>
    format === 'cjs' ? { js: '.cjs', dts: '.d.cts' } : { js: '.mjs', dts: '.d.ts' },
  unbundle: true,
  sourcemap: true,
  clean: true,
  dts: { tsgo: { path: getTscExePath() } },
});
