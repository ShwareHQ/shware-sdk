import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/**/*.ts', '!src/**/*.test.*'],
  format: ['esm', 'cjs'],
  unbundle: true,
  sourcemap: true,
  dts: true,
});
