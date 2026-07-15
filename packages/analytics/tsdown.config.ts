import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/**/*.ts', 'src/**/*.tsx', '!src/**/*.test.*'],
  format: ['esm', 'cjs'],
  unbundle: true,
  // bowser is CJS-only (main/browser -> es5.js, no exports map); bundle it so
  // consumers' dev-mode ESM resolution (e.g. Vite optimizeDeps exclusions)
  // never hits the raw CJS file.
  noExternal: ['bowser'],
  sourcemap: true,
  dts: true,
});
