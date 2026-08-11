import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** 直连 workspace 源码（免 build）：vite 按需编译 packages/workflow/src。 */
const workflowSrc = (path: string) =>
  fileURLToPath(new URL(`../../packages/workflow/src/${path}`, import.meta.url));

export default defineConfig({
  // 端口由环境注入（多实例并行时避免占用冲突），缺省回落 vite 默认
  server: process.env.PORT ? { port: Number(process.env.PORT) } : {},
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@shware/workflow/react', replacement: workflowSrc('react/index.ts') },
      { find: '@shware/workflow/examples', replacement: workflowSrc('examples.ts') },
      { find: '@shware/workflow', replacement: workflowSrc('index.ts') },
    ],
  },
});
