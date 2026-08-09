import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** 直连 workspace 源码（免 build）：vite 按需编译 packages/workflow/src。 */
const workflowSrc = (path: string) =>
  fileURLToPath(new URL(`../../packages/workflow/src/${path}`, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@shware/workflow/react', replacement: workflowSrc('react/index.ts') },
      { find: '@shware/workflow/examples', replacement: workflowSrc('examples.ts') },
      { find: '@shware/workflow', replacement: workflowSrc('index.ts') },
    ],
  },
});
