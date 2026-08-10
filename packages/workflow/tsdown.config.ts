import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/**/*.ts', 'src/**/*.tsx', '!src/**/*.test.*'],
  format: ['esm', 'cjs'],
  unbundle: true,
  sourcemap: true,
  dts: true,
});
