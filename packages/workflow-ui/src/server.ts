import { existsSync, realpathSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { type Plugin, type ViteDevServer, createServer, searchForWorkspaceRoot } from 'vite';
import svgr from 'vite-plugin-svgr';
import {
  STATS_METHODS,
  type StatsMethod,
  loadSnapshot,
  ssrModulesOf,
  virtualModule,
} from './server/project';

/**
 * The studio dev server.
 *
 * Rather than shipping a prebuilt SPA and a JSON API, the CLI runs Vite over
 * the app source with the project injected as a virtual module: compiled on
 * the server, the template registries imported by the browser from their own
 * modules. Vite serves our app and the user's react-email components as one
 * graph — HMR on every one of them for free, and email previews render with
 * exactly the component code on disk.
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

/**
 * The project file — `export default defineConfig({...})` from
 * `@shware/workflow`. Required: it is the only place the studio reads
 * definitions from.
 */
export function findConfig(cwd: string, explicit?: string): string {
  if (explicit !== undefined) {
    const path = resolve(cwd, explicit);
    if (!existsSync(path)) throw new Error(`workflow-ui: config not found at ${path}`);
    return path;
  }
  const found = CONFIG_CANDIDATES.map((name) => resolve(cwd, name)).find((path) =>
    existsSync(path)
  );
  if (found === undefined) {
    throw new Error(
      `workflow-ui: no workflow.config.ts in ${cwd}.\n` +
        `Export defineConfig({ workflows, templates }) from '@shware/workflow' there, or pass --config <path>.`
    );
  }
  return found;
}

const STATS_CANDIDATES = ['workflow.stats.ts', 'workflow.stats.tsx', 'workflow.stats.js'];

/**
 * The studio's optional stats source, apart from the project: an explicit
 * path must exist; otherwise `workflow.stats.ts` beside the config, if any.
 */
export function findStats(cwd: string, explicit?: string): string | undefined {
  if (explicit !== undefined) {
    const path = resolve(cwd, explicit);
    if (!existsSync(path)) throw new Error(`workflow-ui: stats source not found at ${path}`);
    return path;
  }
  return STATS_CANDIDATES.map((name) => resolve(cwd, name)).find((path) => existsSync(path));
}

/* ---------------------------------- Project --------------------------------- */

const VIRTUAL_ID = 'virtual:workflow-config';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

const NODE_MODULES = /[/\\]node_modules[/\\]/;

/**
 * Every file the last project load evaluated: the config and, transitively,
 * whatever it imported in Vite's SSR module graph — wherever those files live.
 * Dependencies under node_modules are left out: they change with an install,
 * not an edit.
 */
function evaluatedFiles(dev: ViteDevServer, configPath: string): Set<string> {
  const files = new Set<string>([resolve(configPath)]);
  const graph = dev.environments.ssr.moduleGraph;
  const queue = [...(graph.getModulesByFile(configPath) ?? [])];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const mod = queue.pop();
    if (mod === undefined) continue;
    if (mod.file !== null) {
      if (NODE_MODULES.test(mod.file)) continue;
      files.add(resolve(mod.file));
    }
    for (const imported of mod.importedModules) {
      if (!seen.has(imported)) {
        seen.add(imported);
        queue.push(imported);
      }
    }
  }
  return files;
}

/**
 * Serve `virtual:workflow-config` and keep it current.
 *
 * The project is evaluated on the server (ssrLoadModule) and compiled there;
 * see server/project.ts for what reaches the browser. After every load the
 * plugin records the files that load evaluated — the config and everything it
 * imported, inside the working directory or not (`--config ../shared/...`,
 * a contract in a sibling package) — and watches them. A change to any of
 * them drops those evaluated modules and pushes a fresh snapshot over HMR, so
 * adding a workflow or a template to the registration list shows up without a
 * reload. Template components also update through their own client-side HMR,
 * as any module does.
 */
/** The stats source's default export, evaluated on the dev server. */
async function loadStats(
  dev: ViteDevServer,
  statsPath: string
): Promise<Partial<Record<StatsMethod, (...args: unknown[]) => unknown>>> {
  const mod = await dev.ssrLoadModule(statsPath);
  const stats: unknown = mod.default;
  if (typeof stats !== 'object' || stats === null) {
    throw new Error(`workflow-ui: ${statsPath} must default-export defineStats({...})`);
  }
  return stats;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => resolveBody(body));
    req.on('error', reject);
  });
}

export function projectPlugin(configPath: string, statsPath: string | undefined): Plugin {
  let server: ViteDevServer | undefined;
  let evaluated = new Set<string>([resolve(configPath)]);
  return {
    name: 'workflow-ui:project',
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null),
    async load(id) {
      if (id !== RESOLVED_ID || server === undefined) return null;
      const dev = server;
      const snapshot = await loadSnapshot({
        configPath,
        load: (file) => dev.ssrLoadModule(file),
        modules: ssrModulesOf(dev),
      });
      evaluated = evaluatedFiles(dev, configPath);
      let methods: StatsMethod[] | undefined;
      if (statsPath !== undefined) {
        const stats = await loadStats(dev, statsPath);
        methods = STATS_METHODS.filter((method) => typeof stats[method] === 'function');
        for (const file of evaluatedFiles(dev, statsPath)) evaluated.add(file);
      }
      dev.watcher.add([...evaluated]);
      return virtualModule(snapshot, methods);
    },
    configureServer(dev) {
      server = dev;
      /* Positions the DSL captures while the project is evaluated are then lines on disk. */
      process.setSourceMapsEnabled(true);
      for (const file of [configPath, statsPath]) {
        if (file !== undefined) dev.watcher.add(file);
      }
      const refresh = (file: string): void => {
        if (!evaluated.has(resolve(file))) return;
        const virtual = dev.moduleGraph.getModuleById(RESOLVED_ID);
        if (virtual === undefined) return;
        /*
         * ssrLoadModule keeps an evaluated module until it is invalidated, and
         * the config caches everything it imported — so every evaluated module
         * goes, not just the file that changed.
         */
        for (const path of evaluated) {
          for (const mod of dev.moduleGraph.getModulesByFile(path) ?? []) {
            dev.moduleGraph.invalidateModule(mod);
          }
        }
        dev.moduleGraph.invalidateModule(virtual);
        void dev.reloadModule(virtual);
      };
      dev.watcher.on('change', refresh);
      dev.watcher.on('add', refresh);
      dev.watcher.on('unlink', refresh);

      /*
       * The stats source runs here, not in the browser: it reads the project's
       * own database or API, with credentials the page must never hold. The
       * page calls one method per request — the arguments as a JSON array, the
       * answer as JSON — and only the StatsSource method names are served.
       */
      dev.middlewares.use('/__studio/stats/', (req, res) => {
        const sendJson = (status: number, body: unknown): void => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        void (async () => {
          if (req.method !== 'POST') {
            res.setHeader('allow', 'POST');
            sendJson(405, { error: 'stats calls are POST' });
            return;
          }
          const rejection = studioRequestRejection(req);
          if (rejection !== undefined) {
            sendJson(403, { error: rejection });
            return;
          }
          const method = (req.url ?? '').replace(/^\//, '').split('?')[0] as StatsMethod;
          if (statsPath === undefined || !STATS_METHODS.includes(method)) {
            sendJson(404, { error: `no stats method '${method}'` });
            return;
          }
          try {
            const args: unknown = JSON.parse((await readBody(req)) || '[]');
            if (!Array.isArray(args)) {
              sendJson(400, { error: 'the body is the arguments, as a JSON array' });
              return;
            }
            const fn = (await loadStats(dev, statsPath))[method];
            if (fn === undefined) {
              sendJson(404, { error: `workflow.stats.ts defines no '${method}'` });
              return;
            }
            sendJson(200, (await fn(...args)) ?? null);
          } catch (error) {
            dev.config.logger.error(`[workflow-ui] stats ${method} failed: ${String(error)}`);
            sendJson(500, { error: error instanceof Error ? error.message : String(error) });
          }
        })();
      });
    },
  };
}

/* -------------------------------- Studio API -------------------------------- */

/** `Sec-Fetch-Site` values no other site can produce: our own page, or a direct navigation. */
const OWN_FETCH_SITES = new Set(['same-origin', 'none']);

function headerValue(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined || value === '' ? undefined : value;
}

/**
 * Refuse any request another website could have caused, and say why.
 *
 * The node endpoint reads the developer's source files to answer, so a page
 * they merely *visit* should not be able to probe it. Vite's CORS handling
 * decides who may read a response; this decides whether the request is served
 * at all.
 *
 *   - `Sec-Fetch-Site` is attached by the browser and cannot be set from
 *     script, so anything but `same-origin` (our page) or `none` (the address
 *     bar) is a request some other page caused — including `same-site`, which
 *     covers another port on localhost.
 *   - `Origin` covers clients that send no fetch metadata: present and not our
 *     own host means cross-origin. Absent is allowed on purpose — a same-origin
 *     GET and a terminal `curl` both have no Origin at all, and a cross-origin
 *     browser request always has one.
 */
export function studioRequestRejection(req: Pick<IncomingMessage, 'headers'>): string | undefined {
  const site = headerValue(req.headers['sec-fetch-site']);
  if (site !== undefined && !OWN_FETCH_SITES.has(site)) {
    return `refused: sec-fetch-site is '${site}', so another site caused this request`;
  }
  const origin = headerValue(req.headers.origin);
  if (origin !== undefined) {
    const host = headerValue(req.headers.host);
    let originHost: string | undefined;
    try {
      originHost = new URL(origin).host;
    } catch {
      /* Opaque origins ('null' from a sandboxed frame or file://) never match. */
      originHost = undefined;
    }
    if (host === undefined || originHost?.toLowerCase() !== host.toLowerCase()) {
      return `refused: cross-origin request from ${origin}`;
    }
  }
  return undefined;
}

/**
 * The studio's dev-server API — read-only. The studio views source and never
 * writes it: edits happen in the editor, and Vite's watcher and HMR bring them
 * to the page. The one endpoint resolves a node's captured position to a line
 * on disk for display; everything else under `/__studio` answers 404, so the
 * write routes earlier versions served (`/__studio/envelope`,
 * `/__studio/addresses`, POST `/__studio/node`) are gone rather than hidden.
 */
export function studioApiPlugin(cwd: string): Plugin {
  const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  };

  return {
    name: 'workflow-ui:studio-api',
    configureServer(server) {
      /*
       * The client sends the position the DSL captured (NodeMetaIR.loc). The
       * project is evaluated on the server with source maps enabled, so that
       * is already a line on disk; this checks the path stays inside the
       * project and answers it relative to it. Navigation only: the panel
       * shows the row when this answers and leaves it out when it does not.
       */
      server.middlewares.use('/__studio/node', (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.setHeader('allow', 'GET, HEAD');
          sendJson(res, 405, { error: 'the studio is read-only: GET only' });
          return;
        }
        const rejection = studioRequestRejection(req);
        if (rejection !== undefined) {
          sendJson(res, 403, { error: rejection });
          return;
        }
        const params = new URL(req.url ?? '/', 'http://internal').searchParams;
        const found = sourcePosition(cwd, params.get('file') ?? '', Number(params.get('line')));
        if ('error' in found) {
          sendJson(res, 422, { error: found.error });
          return;
        }
        sendJson(res, 200, { file: relative(cwd, found.file), line: found.line });
      });

      /* Registered after the routes above, so it only sees what none of them took. */
      server.middlewares.use('/__studio', (_req, res) => {
        sendJson(res, 404, { error: 'no such studio endpoint' });
      });
    },
  };
}

type Located = { file: string; line: number } | { error: string };

/** The two `node:path` functions containment needs, so the suite can hand in `path.win32`. */
interface PathOps {
  isAbsolute: (path: string) => boolean;
  relative: (from: string, to: string) => string;
}

/**
 * Is `candidate` `root` itself or something below it?
 *
 * Asked through `relative`, never a string prefix. A prefix test needs a
 * trailing separator (or `/proj-evil` passes for `/proj`), and the separator it
 * appends is the wrong one on Windows, where `resolve()` returns `C:\proj\…`:
 * that mismatch failed every path on Windows, which is how the whole
 * /__studio/node surface came to answer "outside the project" there.
 */
export function isInsideDir(
  root: string,
  candidate: string,
  ops: PathOps = { isAbsolute, relative }
): boolean {
  const rel = ops.relative(root, candidate);
  if (rel === '') return true;
  /* An absolute answer means there is no way down from root — another drive. */
  if (ops.isAbsolute(rel)) return false;
  /* Segment-wise, so a file legitimately named '..rc' is not read as an escape. */
  return rel.split(/[/\\]/)[0] !== '..';
}

/**
 * Keep a path that arrived from the browser inside the project.
 *
 * The scope is `cwd` — the project the studio was started in — and not the
 * workspace root `searchForWorkspaceRoot` walks up to: in a monorepo that root
 * is the whole repo, so a studio started in `apps/marketing` accepted
 * `file=../../packages/billing/src/rates.ts` and read it.
 */
export function isInsideProject(cwd: string, candidate: string): boolean {
  const root = resolve(cwd);
  const path = resolve(candidate);
  if (!isInsideDir(root, path)) return false;
  /*
   * Then again on the real paths: a symlink inside the project may point
   * anywhere, and the check above only ever sees the link's own path. A path
   * that does not exist has nothing to resolve — the caller reports that.
   */
  if (!existsSync(path)) return true;
  return isInsideDir(realpathSync(root), realpathSync(path));
}

/**
 * Check a captured position before answering with it.
 *
 * The path is validated against cwd before anything is touched: it arrives
 * from the browser, and an endpoint that follows an arbitrary path is a
 * read-anywhere endpoint.
 */
function sourcePosition(cwd: string, rawFile: string, line: number): Located {
  let path = rawFile;
  if (/^https?:\/\//.test(path)) path = new URL(path).pathname;
  const fsPrefix = '/@fs';
  if (path.startsWith(fsPrefix)) path = path.slice(fsPrefix.length);
  path = resolve(cwd, decodeURIComponent(path));

  if (!isInsideProject(cwd, path)) return { error: 'source file is outside the project' };
  if (!existsSync(path)) return { error: `no such source file: ${path}` };
  if (!Number.isInteger(line) || line < 1) return { error: 'expected a line number' };
  return { file: path, line };
}

export interface StartOptions {
  cwd?: string;
  config?: string;
  /** The studio's stats source (default ./workflow.stats.ts, if present). */
  stats?: string;
  port?: number;
  open?: boolean;
}

export async function startStudio(options: StartOptions = {}): Promise<ViteDevServer> {
  const cwd = options.cwd ?? process.cwd();
  // The config is required (findConfig throws); the stats source is optional.
  // The resolved path is what the plugin loads — resolving again from cwd
  // inside it is what once made --config point at a file it does not name.
  const configPath = findConfig(cwd, options.config);
  const statsPath = findStats(cwd, options.stats);
  const appRoot = resolveAppRoot();

  const server = await createServer({
    root: appRoot,
    configFile: false,
    envDir: false,
    plugins: [
      react(),
      svgr(),
      tailwindcss(),
      projectPlugin(configPath, statsPath),
      studioApiPlugin(cwd),
    ],
    server: {
      port: options.port ?? 4321,
      open: options.open ?? false,
      /*
       * Both workspace roots have to be readable: the user's project (the
       * config and everything it imports) and ours — under pnpm our own
       * dependencies (fonts, css) resolve into a store beside the workspace
       * root rather than anywhere below the app.
       */
      fs: {
        allow: [
          searchForWorkspaceRoot(cwd),
          /* A config outside cwd brings its own workspace: the registries the browser imports live there. */
          searchForWorkspaceRoot(dirname(configPath)),
          searchForWorkspaceRoot(packageRoot),
          appRoot,
        ],
      },
    },
    // The app and the user's project each have their own react; one copy only. One
    // @shware/workflow too: the preview's <EmailProvider> and the project's layout calling
    // useEmailContext() must share the context object
    resolve: { dedupe: ['react', 'react-dom', '@shware/workflow'] },
    /*
     * @react-email/render imports react-dom/server lazily, so the dep scan never
     * sees it: the first email preview made Vite discover it, re-optimize and
     * change the deps hash under a page that still held the old one — the
     * preview then failed with "Failed to fetch dynamically imported module"
     * (a 504 Outdated Optimize Dep) until a reload. Bundling both up front
     * keeps the hash stable from the first request. The project's config is
     * scanned too (never served — only crawled), so its templates'
     * dependencies (@react-email/components, zod, …) are bundled before the
     * first preview rather than discovered by it.
     */
    optimizeDeps: {
      entries: ['index.html', configPath],
      include: ['@react-email/render', 'react-dom/server'],
    },
  });

  await server.listen();
  return server;
}
