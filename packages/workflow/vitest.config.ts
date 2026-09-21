import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    alias: {
      // `cloudflare:workers` only resolves inside workerd; the stub is what lets
      // the CF adapter be imported (and therefore tested) under node.
      'cloudflare:workers': fileURLToPath(
        new URL('./tests/stubs/cloudflare-workers.ts', import.meta.url)
      ),
    },
  },
});
