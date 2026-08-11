import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { type Plugin, type ViteDevServer, createServer } from 'vite';

/**
 * The studio dev server.
 *
 * Rather than shipping a prebuilt SPA and a JSON API, the CLI runs Vite over
 * the app source with the user's config injected as a virtual module. Vite then
 * compiles our app, the user's workflow definitions and their react-email
 * components as one graph — which buys HMR on every one of them for free, and
 * means email previews render with exactly the component code on disk.
 */

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** `src/app` when running from source in the monorepo, the published copy otherwise. */
function resolveAppRoot(): string {
  const candidates = [resolve(packageRoot, 'src/app'), resolve(packageRoot, '../src/app')];
  const found = candidates.find((path) => existsSync(resolve(path, 'index.html')));
  if (!found) throw new Error('workflow-ui: could not locate the app root');
  return found;
}

const CONFIG_CANDIDATES = [
  'workflow.config.ts',
  'workflow.config.tsx',
  'workflow.config.js',
  'workflow.config.mjs',
];

export function findConfig(cwd: string, explicit?: string): string {
  if (explicit !== undefined) {
    const path = resolve(cwd, explicit);
    if (!existsSync(path)) throw new Error(`workflow-ui: config not found at ${path}`);
    return path;
  }
  for (const name of CONFIG_CANDIDATES) {
    const path = resolve(cwd, name);
    if (existsSync(path)) return path;
  }
  throw new Error(
    `workflow-ui: no config found in ${cwd}. Create workflow.config.ts:\n\n` +
      `  import { defineConfig } from '@shware/workflow-ui/config';\n` +
      `  import * as workflows from './src/journeys';\n\n` +
      `  export default defineConfig({ workflows });\n`
  );
}

const VIRTUAL_ID = 'virtual:workflow-config';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** Re-export the user's config through a stable module id the app can import. */
function configPlugin(configPath: string): Plugin {
  return {
    name: 'workflow-ui:config',
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null),
    load: (id) =>
      id === RESOLVED_ID ? `export { default } from ${JSON.stringify(configPath)};` : null,
  };
}

export interface StartOptions {
  cwd?: string;
  config?: string;
  port?: number;
  open?: boolean;
}

export async function startStudio(options: StartOptions = {}): Promise<ViteDevServer> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = findConfig(cwd, options.config);
  const appRoot = resolveAppRoot();

  const server = await createServer({
    root: appRoot,
    configFile: false,
    envFile: false,
    plugins: [react(), tailwindcss(), configPlugin(configPath)],
    // The config, and everything it imports, lives outside the app root
    server: {
      port: options.port ?? 4321,
      open: options.open ?? false,
      fs: { allow: [cwd, appRoot] },
    },
    // The app and the user's project each have their own react; one copy only
    resolve: { dedupe: ['react', 'react-dom'] },
  });

  await server.listen();
  return server;
}
