import { execFile, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type SourceMapInput, TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import launch from 'launch-editor';
import { type Plugin, type ViteDevServer, createServer, searchForWorkspaceRoot } from 'vite';

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

/**
 * IR provenance (meta.loc) records files as the executing module saw them. In
 * the studio, workflows compile in the browser, so a loc's file is a Vite dev
 * URL — user code lives outside the Vite root (our app) and is served under
 * /@fs/<absolute-path>. Node-compiled IR carries cwd-relative paths instead.
 * Reduce all of these to an absolute filesystem path.
 */
function locToFsPath(rawFile: string, cwd: string): string {
  let path = rawFile;
  const asUrl = /^https?:\/\/[^/]+(\/.*)$/.exec(path);
  if (asUrl?.[1] !== undefined) path = asUrl[1];
  const query = path.indexOf('?');
  if (query !== -1) path = path.slice(0, query);
  if (path.startsWith('/@fs/')) return path.slice('/@fs'.length);
  if (path.startsWith('/') && existsSync(path)) return path;
  return resolve(cwd, path.replace(/^\//, ''));
}

/**
 * On macOS, launch-editor finds a running JetBrains IDE but execs its native
 * launcher directly — which rejects `--line` (the binary only accepts IDE args
 * when relayed through `open --args`; JetBrains' own Toolbox scripts wrap it
 * exactly that way) and prints a scary error while at it. So when a JetBrains
 * IDE is running, relay through `open` ourselves and skip launch-editor
 * entirely; every other editor still goes through launch-editor.
 */
function openViaJetBrainsApp(
  fsPath: string,
  line: number,
  column: number,
  warn: (message: string) => void
): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    const processes = execSync('ps x -o comm=', { stdio: ['pipe', 'pipe', 'ignore'] })
      .toString()
      .split('\n');
    const IDE =
      /\.app\/Contents\/MacOS\/(webstorm|idea|pycharm|phpstorm|goland|rubymine|clion|rider|appcode|datagrip|studio)$/;
    const launcher = processes.find((path) => IDE.test(path));
    if (launcher === undefined) return false;
    const app = launcher.slice(0, launcher.indexOf('.app') + '.app'.length);
    execFile(
      'open',
      ['-na', app, '--args', '--line', String(line), '--column', String(column), fsPath],
      (error) => {
        // `open` failing is environmental (sandboxes block LaunchServices) — say so instead of failing silently
        if (error) warn(`workflow-ui: 'open ${app}' failed: ${error.message}`);
      }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * POST-free jump endpoint for the canvas's code buttons: resolves the loc to a
 * file and asks launch-editor to open it (editor auto-detected from running
 * processes, WebStorm included). Dev-server-only by construction — the studio
 * has no production build.
 *
 * Browser stacks are NOT sourcemapped, so a loc captured in the browser points
 * into the esbuild-transformed module (comments stripped, lines shifted). Vite
 * keeps each module's transform sourcemap in the module graph — remap the
 * position back to the TypeScript source before launching the editor.
 */
function openInEditorPlugin(cwd: string): Plugin {
  return {
    name: 'workflow-ui:open-in-editor',
    configureServer(server) {
      server.middlewares.use('/__open-in-editor', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://internal');
        const file = url.searchParams.get('file');
        if (file === null || file === '') {
          res.statusCode = 400;
          res.end('missing file');
          return;
        }
        const fsPath = locToFsPath(file, cwd);
        if (!existsSync(fsPath)) {
          res.statusCode = 404;
          res.end(`not a file on this machine: ${fsPath}`);
          return;
        }

        let line = Number(url.searchParams.get('line') ?? '1') || 1;
        let column = Number(url.searchParams.get('column') ?? '1') || 1;
        const map = server.moduleGraph.getModuleById(fsPath)?.transformResult?.map;
        if (map) {
          // stack positions are 1-based; sourcemap columns are 0-based
          const pos = originalPositionFor(new TraceMap(map as SourceMapInput), {
            line,
            column: column - 1,
          });
          if (pos.line !== null) {
            line = pos.line;
            column = pos.column + 1;
          }
        }

        const warn = (message: string) => server.config.logger.warn(message);
        // An explicit LAUNCH_EDITOR choice always goes through launch-editor;
        // otherwise a running JetBrains IDE takes the open-relay path directly.
        const jetbrainsHandled =
          process.env.LAUNCH_EDITOR === undefined &&
          openViaJetBrainsApp(fsPath, line, column, warn);
        if (!jetbrainsHandled) {
          launch(`${fsPath}:${line}:${column}`, undefined, (_, errorMessage) => {
            warn(`workflow-ui: could not open editor: ${errorMessage ?? ''}`);
          });
        }
        res.statusCode = 204;
        res.end();
      });
    },
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
    plugins: [react(), tailwindcss(), configPlugin(configPath), openInEditorPlugin(cwd)],
    server: {
      port: options.port ?? 4321,
      open: options.open ?? false,
      /*
       * Both workspace roots have to be readable: the user's project (the
       * config and everything it imports) and ours — under pnpm our own
       * dependencies (fonts, css) resolve into a store beside the workspace
       * root rather than anywhere below the app.
       */
      fs: { allow: [searchForWorkspaceRoot(cwd), searchForWorkspaceRoot(packageRoot), appRoot] },
    },
    // The app and the user's project each have their own react; one copy only
    resolve: { dedupe: ['react', 'react-dom'] },
  });

  await server.listen();
  return server;
}
