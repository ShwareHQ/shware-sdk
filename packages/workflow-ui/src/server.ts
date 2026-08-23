import { existsSync, readdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { type Plugin, type ViteDevServer, createServer, searchForWorkspaceRoot } from 'vite';
import svgr from 'vite-plugin-svgr';
import {
  type EnvelopeField,
  type ValuePath,
  addAddress,
  callLiteralAt,
  envelopeEditability,
  offsetOf,
  patchCallLiteral,
  patchEnvelopeField,
  removeAddress,
  resolveEmailModule,
  updateAddress,
} from './server/patch';

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

/** The config is optional — conventions carry the definitions (see discovery below). */
export function findConfig(cwd: string, explicit?: string): string | undefined {
  if (explicit !== undefined) {
    const path = resolve(cwd, explicit);
    if (!existsSync(path)) throw new Error(`workflow-ui: config not found at ${path}`);
    return path;
  }
  for (const name of CONFIG_CANDIDATES) {
    const path = resolve(cwd, name);
    if (existsSync(path)) return path;
  }
  return undefined;
}

/* --------------------------------- Discovery -------------------------------- */

/**
 * Convention over configuration, next.js-style:
 *   - `src/workflows/` (or `workflows/`): every module in the tree is loaded;
 *     exports that quack like a WorkflowBuilder (`toIR`) become workflows keyed
 *     by export name, exports marked `__segment` become the segment list.
 *   - `src/emails/index.ts` (or `emails/index.ts`): must `export const emails`,
 *     the same registry object that types `templates<Emails>()` keys.
 */
const WORKFLOWS_DIRS = ['src/workflows', 'workflows'];
const EMAILS_INDEXES = [
  'src/emails/index.ts',
  'src/emails/index.tsx',
  'emails/index.ts',
  'emails/index.tsx',
];

export function findWorkflowsDir(cwd: string): string | undefined {
  return WORKFLOWS_DIRS.map((dir) => resolve(cwd, dir)).find((path) => existsSync(path));
}

function findEmailsIndex(cwd: string): string | undefined {
  return EMAILS_INDEXES.map((file) => resolve(cwd, file)).find((path) => existsSync(path));
}

/** Modules to load from the workflows dir: .ts/.tsx, skipping declarations and tests. */
function listWorkflowModules(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listWorkflowModules(path));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.(d|test|spec|test-d)\.tsx?$/.test(entry.name)) continue;
    files.push(path);
  }
  return files.sort();
}

const VIRTUAL_ID = 'virtual:workflow-config';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/**
 * Generate the virtual config module: import everything discovery found plus
 * the optional user config, and assemble the ResolvedStudioConfig at runtime.
 * Detection is duck-typed on values, so how users organise files (barrels,
 * subdirectories, re-exports) never matters — same key + same value collapses.
 */
function discoveryModule(cwd: string): string {
  const workflowsDir = findWorkflowsDir(cwd);
  const emailsIndex = findEmailsIndex(cwd);
  const configPath = findConfig(cwd);
  const moduleFiles = workflowsDir === undefined ? [] : listWorkflowModules(workflowsDir);

  const imports: string[] = [];
  moduleFiles.forEach((file, index) => {
    imports.push(`import * as m${index} from ${JSON.stringify(file)};`);
  });
  if (emailsIndex !== undefined) {
    imports.push(`import { emails as registry } from ${JSON.stringify(emailsIndex)};`);
  }
  if (configPath !== undefined) {
    imports.push(`import userConfig from ${JSON.stringify(configPath)};`);
  }

  return `${imports.join('\n')}
const modules = [${moduleFiles.map((_, index) => `m${index}`).join(', ')}];
const workflows = {};
const segments = [];
for (const mod of modules) {
  for (const [key, value] of Object.entries(mod)) {
    if (value === null || typeof value !== 'object' && typeof value !== 'function') continue;
    if (typeof value.toIR === 'function') workflows[key] = value;
    else if (value.__segment === true && !segments.includes(value)) segments.push(value);
  }
}
const config = ${configPath !== undefined ? 'userConfig' : '{}'};
export default {
  ...(config.title !== undefined ? { title: config.title } : {}),
  workflows,
  emails: ${emailsIndex !== undefined ? 'registry' : '{}'},
  segments,
  addresses: config.emails?.addresses ?? [],
  ...(config.emails?.sendTest !== undefined ? { sendTest: config.emails.sendTest } : {}),
  ...(config.stats !== undefined ? { stats: config.stats } : {}),
};
`;
}

/** Serve the assembled module under a stable id, and refresh it when discovery inputs change. */
function discoveryPlugin(cwd: string): Plugin {
  return {
    name: 'workflow-ui:config',
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null),
    load: (id) => (id === RESOLVED_ID ? discoveryModule(cwd) : null),
    configureServer(server) {
      const workflowsDir = findWorkflowsDir(cwd);
      if (workflowsDir !== undefined) server.watcher.add(workflowsDir);
      const refresh = (file: string): void => {
        // Adding or removing a module changes the generated import list
        if (workflowsDir !== undefined && !file.startsWith(workflowsDir)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) {
          server.moduleGraph.invalidateModule(mod);
          server.ws.send({ type: 'full-reload' });
        }
      };
      server.watcher.on('add', refresh);
      server.watcher.on('unlink', refresh);
    },
  };
}

/* ------------------------------ Studio write-back ----------------------------- */

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolvePromise(
          JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
        );
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    req.on('error', reject);
  });
}

/**
 * The studio's write-back API. Edits only ever land on source literals (see
 * server/patch.ts); the response is JSON and the real feedback is the file
 * change itself — Vite HMR refreshes the preview the moment the patch lands.
 */
function studioApiPlugin(cwd: string): Plugin {
  const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  };

  return {
    name: 'workflow-ui:studio-api',
    configureServer(server) {
      server.middlewares.use('/__studio/envelope', (req, res) => {
        void (async () => {
          const emailsIndex = findEmailsIndex(cwd);
          if (emailsIndex === undefined) {
            sendJson(res, 404, { error: 'no emails index (src/emails/index.ts) in this project' });
            return;
          }
          if (req.method === 'GET') {
            const key = new URL(req.url ?? '/', 'http://internal').searchParams.get('key') ?? '';
            const modulePath = resolveEmailModule(emailsIndex, key);
            if (modulePath === undefined) {
              sendJson(res, 404, { error: `no registered module for key '${key}'` });
              return;
            }
            sendJson(res, 200, { editable: envelopeEditability(modulePath) });
            return;
          }
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'GET or POST only' });
            return;
          }
          const body = await readJsonBody(req);
          const { key, field, value } = body as { key?: string; field?: string; value?: string };
          const isEnvelopeField = (candidate: unknown): candidate is EnvelopeField =>
            typeof candidate === 'string' &&
            ['from', 'replyTo', 'subject', 'name', 'description'].includes(candidate);
          if (typeof key !== 'string' || typeof value !== 'string' || !isEnvelopeField(field)) {
            sendJson(res, 400, {
              error: 'expected { key, field: from|replyTo|subject|name|description, value }',
            });
            return;
          }
          const modulePath = resolveEmailModule(emailsIndex, key);
          if (modulePath === undefined) {
            sendJson(res, 404, { error: `no registered module for key '${key}'` });
            return;
          }
          const result = patchEnvelopeField(modulePath, field, value);
          sendJson(res, result.ok ? 200 : 422, result);
        })().catch((error: unknown) => {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        });
      });

      /*
       * Node write-back. The client sends the position the DSL captured at
       * build time (NodeMetaIR.loc), which is a position in the module Vite
       * *served* — its transform collapses a builder chain onto one line, so
       * the recorded line is not the line in the file on disk. Vite keeps the
       * source map for that transform; one lookup through it turns the served
       * position back into the original one, and only then is it safe to patch.
       */
      server.middlewares.use('/__studio/node', (req, res) => {
        void (async () => {
          const positionFrom = (params: URLSearchParams) => ({
            file: params.get('file') ?? '',
            line: Number(params.get('line')),
            column: Number(params.get('column')),
          });
          /* `0`, `1.timeout`, `0.between.1` — numeric segments index, the rest name. */
          const parsePath = (raw: string | null | undefined): ValuePath =>
            (raw ?? '')
              .split('.')
              .filter((segment) => segment !== '')
              .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
          /*
           * Read side: resolve a captured position to the file on disk, so the
           * panel can show the real line — the captured one belongs to the
           * transformed module — and only offer an input where a literal backs
           * the value, the same contract envelopeEditability follows.
           */
          if (req.method === 'GET') {
            const query = positionFrom(new URL(req.url ?? '/', 'http://internal').searchParams);
            const found = await originalSourcePosition(
              server,
              cwd,
              query.file,
              query.line,
              query.column
            );
            if ('error' in found) {
              sendJson(res, 422, { error: found.error });
              return;
            }
            const offset = offsetOf(found.file, found.line, found.column);
            const path = parsePath(
              new URL(req.url ?? '/', 'http://internal').searchParams.get('path')
            );
            const literal =
              offset === undefined ? undefined : callLiteralAt(found.file, offset, path);
            sendJson(res, 200, {
              file: relative(cwd, found.file),
              line: found.line,
              editable: literal !== undefined,
            });
            return;
          }
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'GET or POST only' });
            return;
          }
          const body = (await readJsonBody(req)) as {
            file?: string;
            line?: number;
            column?: number;
            path?: string;
            value?: string;
          };
          const { file, line, column, value } = body;
          if (
            typeof file !== 'string' ||
            typeof line !== 'number' ||
            typeof column !== 'number' ||
            typeof value !== 'string'
          ) {
            sendJson(res, 400, { error: 'expected { file, line, column, value }' });
            return;
          }
          const located = await originalSourcePosition(server, cwd, file, line, column);
          if ('error' in located) {
            sendJson(res, 422, { error: located.error });
            return;
          }
          const offset = offsetOf(located.file, located.line, located.column);
          if (offset === undefined) {
            sendJson(res, 422, { error: 'recorded position is outside the source file' });
            return;
          }
          const result = patchCallLiteral(located.file, offset, parsePath(body.path), value);
          sendJson(res, result.ok ? 200 : 422, result);
        })().catch((error: unknown) => {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        });
      });

      server.middlewares.use('/__studio/addresses', (req, res) => {
        void (async () => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'POST only' });
            return;
          }
          const configPath = findConfig(cwd);
          if (configPath === undefined) {
            sendJson(res, 404, { error: 'no workflow.config.ts to store addresses in' });
            return;
          }
          const body = (await readJsonBody(req)) as {
            action?: string;
            address?: string;
            newAddress?: string;
          };
          const action = body.action ?? 'add';
          const address = typeof body.address === 'string' ? body.address.trim() : '';
          if (address === '') {
            sendJson(res, 400, { error: 'expected { address }' });
            return;
          }
          if (action === 'update') {
            const newAddress = typeof body.newAddress === 'string' ? body.newAddress.trim() : '';
            if (newAddress === '') {
              sendJson(res, 400, { error: "action 'update' expects { newAddress }" });
              return;
            }
            const result = updateAddress(configPath, address, newAddress);
            sendJson(res, result.ok ? 200 : 422, result);
            return;
          }
          if (action === 'remove') {
            const result = removeAddress(configPath, address);
            sendJson(res, result.ok ? 200 : 422, result);
            return;
          }
          const result = addAddress(configPath, address);
          sendJson(res, result.ok ? 200 : 422, result);
        })().catch((error: unknown) => {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        });
      });
    },
  };
}

type Located = { file: string; line: number; column: number } | { error: string };

/**
 * Turn a served position into a position on disk.
 *
 * The path is validated against cwd before anything is read: it arrives from
 * the browser, and a write-back endpoint that follows an arbitrary path is a
 * write-anywhere endpoint.
 */
async function originalSourcePosition(
  server: ViteDevServer,
  cwd: string,
  rawFile: string,
  line: number,
  column: number
): Promise<Located> {
  let path = rawFile;
  if (/^https?:\/\//.test(path)) path = new URL(path).pathname;
  const fsPrefix = '/@fs';
  if (path.startsWith(fsPrefix)) path = path.slice(fsPrefix.length);
  path = resolve(cwd, decodeURIComponent(path));

  const root = searchForWorkspaceRoot(cwd);
  if (!path.startsWith(`${root}/`)) return { error: 'source file is outside the project' };
  if (!existsSync(path)) return { error: `no such source file: ${path}` };

  const transformed = await server.transformRequest(`${fsPrefix}${path}`);
  const map = transformed?.map;
  /*
   * No map means no transform happened, so the served position is already the
   * position on disk. V8 columns are 1-based; everything below is 0-based.
   */
  if (!map) return { file: path, line, column: column - 1 };

  const original = originalPositionFor(
    new TraceMap(map as ConstructorParameters<typeof TraceMap>[0]),
    {
      line,
      column: column - 1,
    }
  );
  if (original.line === null) return { error: 'could not map the position back to source' };
  return { file: path, line: original.line, column: original.column };
}

export interface StartOptions {
  cwd?: string;
  config?: string;
  port?: number;
  open?: boolean;
}

export async function startStudio(options: StartOptions = {}): Promise<ViteDevServer> {
  const cwd = options.cwd ?? process.cwd();
  // Explicit --config must exist (findConfig throws); otherwise everything is optional
  if (options.config !== undefined) findConfig(cwd, options.config);
  if (findWorkflowsDir(cwd) === undefined) {
    throw new Error(
      `workflow-ui: no workflows directory in ${cwd}.\n` +
        `Create src/workflows/ (or workflows/) and export your workflow() definitions from it.`
    );
  }
  const appRoot = resolveAppRoot();

  const server = await createServer({
    root: appRoot,
    configFile: false,
    envFile: false,
    plugins: [react(), svgr(), tailwindcss(), discoveryPlugin(cwd), studioApiPlugin(cwd)],
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
