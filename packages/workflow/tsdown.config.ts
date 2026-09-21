import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/**/*.ts', '!src/**/*.test.*'],
  format: ['esm', 'cjs'],
  unbundle: true,
  sourcemap: true,
  dts: true,
  // The D1 schema is not code, but nothing in this package runs without those
  // tables. `files` publishes dist alone, so a schema left in src/ reaches no
  // one — it ships next to the adapter that needs it instead.
  copy: [{ from: 'src/cloudflare/schema.sql', to: 'dist/cloudflare' }],
});
