import { existsSync, readdirSync, realpathSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
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
  resolveRegistryModule,
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
 *     the same registry object that types `templates<Emails>()` keys;
 *   - `src/pushes/index.ts` (or `pushes/index.ts`): must `export const pushes`,
 *     the push-notification registry, same contract;
 *   - `src/slack/index.ts` and `src/discord/index.ts`: must `export const
 *     slack` / `export const discord`, the chat-message registries.
 */
const WORKFLOWS_DIRS = ['src/workflows', 'workflows'];
const EMAILS_INDEXES = [
  'src/emails/index.ts',
  'src/emails/index.tsx',
  'emails/index.ts',
  'emails/index.tsx',
];
const PUSHES_INDEXES = [
  'src/pushes/index.ts',
  'src/pushes/index.tsx',
  'pushes/index.ts',
  'pushes/index.tsx',
];
/* Chat registries: the directory is the channel's own name, no plural to guess at. */
const CHAT_INDEXES = (channel: string): string[] => [
  `src/${channel}/index.ts`,
  `src/${channel}/index.tsx`,
  `${channel}/index.ts`,
  `${channel}/index.tsx`,
];

export function findWorkflowsDir(cwd: string): string | undefined {
  return WORKFLOWS_DIRS.map((dir) => resolve(cwd, dir)).find((path) => existsSync(path));
}

function findEmailsIndex(cwd: string): string | undefined {
  return EMAILS_INDEXES.map((file) => resolve(cwd, file)).find((path) => existsSync(path));
}

function findPushesIndex(cwd: string): string | undefined {
  return PUSHES_INDEXES.map((file) => resolve(cwd, file)).find((path) => existsSync(path));
}

function findChatIndex(cwd: string, channel: 'slack' | 'discord'): string | undefined {
  return CHAT_INDEXES(channel)
    .map((file) => resolve(cwd, file))
    .find((path) => existsSync(path));
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
 * The generated module's merge step. It has to run in the browser, beside the
 * user's own modules, because only there do the imported values exist to be
 * duck-typed — so it lives here as source text. Exported so the suite runs the
 * exact text that ships rather than a copy of it.
 */
export const MERGE_SOURCE = `function collectDefinitions(modules) {
  const workflows = {};
  const segments = [];
  const sources = {};
  for (const [file, mod] of modules) {
    for (const [key, value] of Object.entries(mod)) {
      if (value === null || typeof value !== 'object' && typeof value !== 'function') continue;
      if (typeof value.toIR === 'function') {
        /*
         * An export name is a workflow's identity — its studio URL, its reports
         * row, its key in IR — so two modules claiming one name is an ambiguity
         * only the developer can settle. Assigning over it (two files that both
         * 'export default workflow(...)' are both keyed 'default') dropped one
         * of them with nothing logged anywhere. The same value under the same
         * key is a re-export through a barrel, which is not a collision.
         */
        if (sources[key] !== undefined && workflows[key] !== value) {
          throw new Error(
            'workflow-ui: two workflow modules export "' + key + '" — ' + sources[key] +
              ' and ' + file + '. Rename one of them: the export name is how the ' +
              'studio, its URLs and your reports identify a workflow.'
          );
        }
        workflows[key] = value;
        sources[key] = file;
      } else if (value.__segment === true && !segments.includes(value)) {
        segments.push(value);
      }
    }
  }
  return { workflows, segments };
}`;

/**
 * Generate the virtual config module: import everything discovery found plus
 * the optional user config, and assemble the ResolvedStudioConfig at runtime.
 * Detection is duck-typed on values, so how users organise files (barrels,
 * subdirectories, re-exports) never matters — same key + same value collapses.
 *
 * `configPath` is resolved once by the caller, so `--config` reaches the module
 * it names instead of whatever `workflow.config.ts` happens to sit in cwd.
 */
export function discoveryModule(cwd: string, configPath: string | undefined): string {
  const workflowsDir = findWorkflowsDir(cwd);
  const emailsIndex = findEmailsIndex(cwd);
  const pushesIndex = findPushesIndex(cwd);
  const slackIndex = findChatIndex(cwd, 'slack');
  const discordIndex = findChatIndex(cwd, 'discord');
  const moduleFiles = workflowsDir === undefined ? [] : listWorkflowModules(workflowsDir);

  const imports: string[] = [];
  moduleFiles.forEach((file, index) => {
    imports.push(`import * as m${index} from ${JSON.stringify(file)};`);
  });
  if (emailsIndex !== undefined) {
    imports.push(`import { emails as registry } from ${JSON.stringify(emailsIndex)};`);
  }
  if (pushesIndex !== undefined) {
    imports.push(`import { pushes as pushRegistry } from ${JSON.stringify(pushesIndex)};`);
  }
  if (slackIndex !== undefined) {
    imports.push(`import { slack as slackRegistry } from ${JSON.stringify(slackIndex)};`);
  }
  if (discordIndex !== undefined) {
    imports.push(`import { discord as discordRegistry } from ${JSON.stringify(discordIndex)};`);
  }
  if (configPath !== undefined) {
    imports.push(`import userConfig from ${JSON.stringify(configPath)};`);
  }

  return `${imports.join('\n')}
${MERGE_SOURCE}
const modules = [${moduleFiles
    .map((file, index) => `[${JSON.stringify(file)}, m${index}]`)
    .join(', ')}];
const { workflows, segments } = collectDefinitions(modules);
const config = ${configPath !== undefined ? 'userConfig' : '{}'};
export default {
  ...(config.title !== undefined ? { title: config.title } : {}),
  workflows,
  emails: ${emailsIndex !== undefined ? 'registry' : '{}'},
  pushes: ${pushesIndex !== undefined ? 'pushRegistry' : '{}'},
  slack: ${slackIndex !== undefined ? 'slackRegistry' : '{}'},
  discord: ${discordIndex !== undefined ? 'discordRegistry' : '{}'},
  segments,
  addresses: config.emails?.addresses ?? [],
  ...(config.emails?.sendTest !== undefined ? { sendTest: config.emails.sendTest } : {}),
  ...(config.stats !== undefined ? { stats: config.stats } : {}),
};
`;
}

/** Serve the assembled module under a stable id, and refresh it when discovery inputs change. */
function discoveryPlugin(cwd: string, configPath: string | undefined): Plugin {
  return {
    name: 'workflow-ui:config',
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null),
    load: (id) => (id === RESOLVED_ID ? discoveryModule(cwd, configPath) : null),
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

/** `Sec-Fetch-Site` values no other site can produce: our own page, or a direct navigation. */
const OWN_FETCH_SITES = new Set(['same-origin', 'none']);

function headerValue(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined || value === '' ? undefined : value;
}

/**
 * Refuse any request another website could have caused, and say why.
 *
 * These endpoints rewrite files on the developer's disk, so a page they merely
 * *visit* reaching one of them is a stranger editing their source — and every
 * layer that looks like it covers this does not. Vite's CORS handling only
 * decides who may read the response, which is decided long after the patch is
 * written; its host check reads `Host`, and the browser sends our own.
 *
 * Three checks, each closing a different door:
 *   - `Sec-Fetch-Site` is attached by the browser and cannot be set from
 *     script, so anything but `same-origin` (our page) or `none` (the address
 *     bar) is a request some other page caused — including `same-site`, which
 *     covers another port on localhost.
 *   - `Origin` covers clients that send no fetch metadata: present and not our
 *     own host means cross-origin. Absent is allowed on purpose — a same-origin
 *     GET and a terminal `curl` both have no Origin at all, and a cross-origin
 *     browser request always has one.
 *   - A JSON content type on writes: a cross-site form or `<img>` can only send
 *     the CORS-safelisted types (text/plain, form-urlencoded, multipart), so
 *     demanding application/json forces a preflight that the two checks above
 *     then refuse. A backstop, never the gate on its own — a non-browser client
 *     sets any header it likes.
 */
export function studioRequestRejection(
  req: Pick<IncomingMessage, 'method' | 'headers'>
): string | undefined {
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
  if (req.method === 'POST') {
    const type = (headerValue(req.headers['content-type']) ?? '').split(';')[0].trim();
    if (type.toLowerCase() !== 'application/json') {
      return 'refused: expected content-type application/json';
    }
  }
  return undefined;
}

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
export function studioApiPlugin(cwd: string, configPath: string | undefined): Plugin {
  const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  };

  /** Answer and stop, or let the handler run. Every endpoint below writes files. */
  const refused = (req: IncomingMessage, res: ServerResponse): boolean => {
    const rejection = studioRequestRejection(req);
    if (rejection === undefined) return false;
    sendJson(res, 403, { error: rejection });
    return true;
  };

  return {
    name: 'workflow-ui:studio-api',
    configureServer(server) {
      server.middlewares.use('/__studio/envelope', (req, res) => {
        if (refused(req, res)) return;
        void (async () => {
          /* Every content registry, paired with the export name it must carry. */
          const registries: [path: string | undefined, exportName: string][] = [
            [findEmailsIndex(cwd), 'emails'],
            [findPushesIndex(cwd), 'pushes'],
            [findChatIndex(cwd, 'slack'), 'slack'],
            [findChatIndex(cwd, 'discord'), 'discord'],
          ];
          if (registries.every(([path]) => path === undefined)) {
            sendJson(res, 404, {
              error:
                'no template index (src/emails/index.ts, src/pushes/index.ts, src/slack/index.ts or src/discord/index.ts) in this project',
            });
            return;
          }
          /* A key lives in exactly one registry, so first hit wins. */
          const resolveModule = (key: string): string | undefined => {
            for (const [path, exportName] of registries) {
              if (path === undefined) continue;
              const found = resolveRegistryModule(path, key, exportName);
              if (found !== undefined) return found;
            }
            return undefined;
          };
          if (req.method === 'GET') {
            const key = new URL(req.url ?? '/', 'http://internal').searchParams.get('key') ?? '';
            const modulePath = resolveModule(key);
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
            ['from', 'replyTo', 'subject', 'name', 'description', 'title', 'body'].includes(
              candidate
            );
          if (typeof key !== 'string' || typeof value !== 'string' || !isEnvelopeField(field)) {
            sendJson(res, 400, {
              error:
                'expected { key, field: from|replyTo|subject|name|description|title|body, value }',
            });
            return;
          }
          const modulePath = resolveModule(key);
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
        if (refused(req, res)) return;
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
        if (refused(req, res)) return;
        void (async () => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'POST only' });
            return;
          }
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
 * `file=../../packages/billing/src/rates.ts` and patched it.
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

  if (!isInsideProject(cwd, path)) return { error: 'source file is outside the project' };
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
  // Explicit --config must exist (findConfig throws); otherwise everything is
  // optional. The resolved path is what the plugins use — resolving again from
  // cwd inside them is what made --config point at the file it does not name.
  const configPath = findConfig(cwd, options.config);
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
    plugins: [
      react(),
      svgr(),
      tailwindcss(),
      discoveryPlugin(cwd, configPath),
      studioApiPlugin(cwd, configPath),
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
      fs: { allow: [searchForWorkspaceRoot(cwd), searchForWorkspaceRoot(packageRoot), appRoot] },
    },
    // The app and the user's project each have their own react; one copy only
    resolve: { dedupe: ['react', 'react-dom'] },
  });

  await server.listen();
  return server;
}
