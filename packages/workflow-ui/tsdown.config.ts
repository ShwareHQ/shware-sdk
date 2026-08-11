import { defineConfig } from 'tsdown';

/**
 * Only the library entries and the CLI are bundled. `src/app` ships as source:
 * the CLI hands it to Vite, which compiles it together with the user's own
 * definitions and email components.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/config.ts', 'src/cli.ts'],
  format: ['esm'],
  sourcemap: true,
  dts: true,
});
