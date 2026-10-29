import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Plugin,
  type ViteDevServer,
  isFileLoadingAllowed,
  normalizePath,
  resolveConfig,
} from 'vite';
import { describe, expect, test } from 'vitest';
import {
  STUDIO_FS_DENY,
  isInsideDir,
  isInsideProject,
  projectFileDeny,
  studioApiPlugin,
  studioRequestRejection,
} from '../src/server';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function tempProject(): string {
  return mkdtempSync(resolve(tmpdir(), 'workflow-ui-'));
}

/* ------------------------------ Request origin ------------------------------ */

function request(headers: Record<string, string>): IncomingMessage {
  return { method: 'GET', headers: { host: 'localhost:4321', ...headers } } as IncomingMessage;
}

describe('who is allowed to reach the node endpoint', () => {
  test('a same-origin read from the studio page is accepted', () => {
    expect(
      studioRequestRejection(
        request({ origin: 'http://localhost:4321', 'sec-fetch-site': 'same-origin' })
      )
    ).toBeUndefined();
  });

  test('a request with no origin and no fetch metadata is accepted', () => {
    expect(studioRequestRejection(request({}))).toBeUndefined();
  });

  test('an origin on another site is refused, whatever it claims about itself', () => {
    expect(studioRequestRejection(request({ origin: 'https://evil.test' }))).toMatch(
      /cross-origin/
    );
    /* Another port on localhost is same-site to the browser, but not us. */
    expect(studioRequestRejection(request({ origin: 'http://localhost:3000' }))).toMatch(
      /cross-origin/
    );
    /* An opaque origin (sandboxed frame, file://) has no host to match. */
    expect(studioRequestRejection(request({ origin: 'null' }))).toMatch(/cross-origin/);
  });

  test('fetch metadata refuses a request another page caused even with the origin stripped', () => {
    expect(studioRequestRejection(request({ 'sec-fetch-site': 'cross-site' }))).toMatch(
      /sec-fetch-site/
    );
    expect(studioRequestRejection(request({ 'sec-fetch-site': 'same-site' }))).toMatch(
      /sec-fetch-site/
    );
  });
});

/* ------------------------------ Path containment ---------------------------- */

describe('keeping a browser-supplied path inside the project', () => {
  test('containment is not a string prefix', () => {
    expect(isInsideDir('/proj', '/proj/src/a.ts')).toBe(true);
    expect(isInsideDir('/proj', '/proj')).toBe(true);
    expect(isInsideDir('/proj', '/proj-evil/src/a.ts')).toBe(false);
    expect(isInsideDir('/proj', '/proj/../other/a.ts')).toBe(false);
    /* A dotfile-ish name is not an escape. */
    expect(isInsideDir('/proj', '/proj/..rc')).toBe(true);
  });

  test('windows paths are contained, where a forward-slash prefix never matched', () => {
    expect(isInsideDir('C:\\proj', 'C:\\proj\\src\\a.ts', win32)).toBe(true);
    expect(isInsideDir('C:\\proj', 'C:\\proj-evil\\a.ts', win32)).toBe(false);
    expect(isInsideDir('C:\\proj', 'D:\\proj\\a.ts', win32)).toBe(false);
    /* What the old check did: no `C:\proj\src\a.ts` ever starts with `C:\proj/`. */
    expect('C:\\proj\\src\\a.ts'.startsWith('C:\\proj/')).toBe(false);
  });

  test('a sibling package of the same monorepo is outside the project', () => {
    const repo = tempProject();
    mkdirSync(resolve(repo, 'apps/marketing/src'), { recursive: true });
    mkdirSync(resolve(repo, 'packages/billing/src'), { recursive: true });
    writeFileSync(resolve(repo, 'packages/billing/src/rates.ts'), 'export const rate = 1;\n');

    expect(
      isInsideProject(
        resolve(repo, 'apps/marketing'),
        resolve(repo, 'packages/billing/src/rates.ts')
      )
    ).toBe(false);
  });

  test('a symlink inside the project pointing out of it is outside the project', () => {
    const project = tempProject();
    const outside = tempProject();
    mkdirSync(resolve(project, 'src'));
    writeFileSync(resolve(outside, 'secret.ts'), 'export const secret = 1;\n');
    symlinkSync(resolve(outside, 'secret.ts'), resolve(project, 'src/secret.ts'));

    expect(isInsideProject(project, resolve(project, 'src/secret.ts'))).toBe(false);
    /* The link's own path passes a lexical read of it, which is the trap. */
    expect(isInsideDir(project, resolve(project, 'src/secret.ts'))).toBe(true);
  });
});

/* --------------------------- Endpoints, end to end -------------------------- */

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

/**
 * The plugin's middlewares, dispatched the way connect does — first mount
 * whose path is the URL or a segment-prefix of it, with the mount stripped —
 * without standing up a real dev server.
 */
function dispatcher(
  plugin: Plugin,
  server: Partial<ViteDevServer> = {}
): (req: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}) => Promise<Answer> {
  const mounted: [path: string, handler: Handler][] = [];
  const configureServer = plugin.configureServer;
  if (typeof configureServer !== 'function') throw new Error('expected a configureServer hook');
  void configureServer.call(
    undefined as never,
    {
      ...server,
      middlewares: { use: (path: string, handler: Handler) => mounted.push([path, handler]) },
    } as unknown as ViteDevServer
  );

  return (req) =>
    new Promise((done) => {
      const [pathname, search = ''] = req.url.split('?');
      const message = new EventEmitter() as IncomingMessage & { method: string };
      message.method = req.method;
      message.headers = {
        host: 'localhost:4321',
        'content-type': 'application/json',
        ...req.headers,
      };
      let status = 200;
      const res = {
        set statusCode(value: number) {
          status = value;
        },
        setHeader: () => undefined,
        end: (payload: string) =>
          done({ status, body: JSON.parse(payload) as Record<string, unknown> }),
      } as unknown as ServerResponse;

      const match = mounted.find(([path]) => pathname === path || pathname.startsWith(`${path}/`));
      /* Nothing of ours claimed it: Vite's own stack takes over from here. */
      if (match === undefined) {
        done({ status: 0, body: {} });
        return;
      }
      const [path, handler] = match;
      message.url = `${pathname.slice(path.length) || '/'}${search === '' ? '' : `?${search}`}`;
      handler(message, res, () => done({ status: 0, body: {} }));
      if (req.body !== undefined) message.emit('data', Buffer.from(JSON.stringify(req.body)));
      message.emit('end');
    });
}

const CONFIG = `import { defineConfig } from '@shware/workflow-ui/config';

export default defineConfig({ emails: { addresses: ['Acme <hello@acme.io>'] } });
`;

const EMAILS = `export const email = {
  welcome: { subject: 'Welcome', from: 'Acme <hello@acme.io>' },
};
`;

const WORKFLOW = `import { workflow } from '@shware/workflow';

export const onboarding = workflow({ id: 'onboarding' }).delay('1 day');
`;

describe('the studio is read-only', () => {
  /** Every route that used to write a file, with a body that used to succeed. */
  const FORMER_WRITES = [
    {
      url: '/__studio/envelope',
      body: { key: 'welcome', field: 'subject', value: 'Pwned' },
    },
    {
      url: '/__studio/addresses',
      body: { action: 'add', address: 'Attacker <evil@evil.test>' },
    },
    {
      url: '/__studio/node',
      body: { file: 'src/workflows/onboarding.ts', line: 3, column: 1, value: '9 days' },
    },
  ];

  function project(): { cwd: string; files: string[] } {
    const cwd = tempProject();
    mkdirSync(resolve(cwd, 'src/email'), { recursive: true });
    mkdirSync(resolve(cwd, 'src/workflows'), { recursive: true });
    const files = [
      resolve(cwd, 'workflow.config.ts'),
      resolve(cwd, 'src/email/index.ts'),
      resolve(cwd, 'src/workflows/onboarding.ts'),
    ];
    writeFileSync(files[0], CONFIG);
    writeFileSync(files[1], EMAILS);
    writeFileSync(files[2], WORKFLOW);
    return { cwd, files };
  }

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'a same-origin %s to every former write route is refused and no file changes',
    async (method) => {
      const { cwd, files } = project();
      const before = files.map((file) => readFileSync(file, 'utf8'));
      const send = dispatcher(studioApiPlugin(cwd), {
        transformRequest: () => Promise.resolve(null),
      });

      for (const { url, body } of FORMER_WRITES) {
        const answer = await send({
          method,
          url,
          headers: { origin: 'http://localhost:4321', 'sec-fetch-site': 'same-origin' },
          body,
        });
        expect([404, 405], `${method} ${url}`).toContain(answer.status);
      }

      expect(files.map((file) => readFileSync(file, 'utf8'))).toEqual(before);
    }
  );

  test('the envelope and addresses routes are gone, not just refused', async () => {
    const { cwd } = project();
    const send = dispatcher(studioApiPlugin(cwd));

    for (const url of ['/__studio/envelope?key=welcome', '/__studio/addresses']) {
      expect((await send({ method: 'GET', url })).status).toBe(404);
    }
  });

  test('the node endpoint still maps a node to its line on disk', async () => {
    const { cwd } = project();
    const send = dispatcher(studioApiPlugin(cwd), {
      transformRequest: () => Promise.resolve(null),
    });

    const answer = await send({
      method: 'GET',
      url: '/__studio/node?file=src/workflows/onboarding.ts&line=3&column=1',
    });

    expect(answer).toEqual({
      status: 200,
      body: { file: 'src/workflows/onboarding.ts', line: 3 },
    });
  });

  test('a cross-origin read of the node endpoint is refused', async () => {
    const { cwd } = project();
    const send = dispatcher(studioApiPlugin(cwd), {
      transformRequest: () => Promise.resolve(null),
    });

    const answer = await send({
      method: 'GET',
      url: '/__studio/node?file=src/workflows/onboarding.ts&line=3&column=1',
      headers: { origin: 'https://evil.test' },
    });

    expect(answer.status).toBe(403);
  });
});

describe('the node endpoint refuses a file outside the project', () => {
  test('a sibling package in the same repo is refused', async () => {
    /*
     * packageRoot is a real package in this monorepo, so the old guard —
     * anchored on the workspace root the lockfile marks — accepted a walk up
     * into its neighbours. transformRequest never runs: the path is refused
     * before anything is read.
     */
    const send = dispatcher(studioApiPlugin(packageRoot), {
      transformRequest: () => Promise.resolve(null),
    });

    const answer = await send({
      method: 'GET',
      url: '/__studio/node?file=../workflow/package.json&line=1&column=1',
    });

    expect(answer).toEqual({ status: 422, body: { error: 'source file is outside the project' } });
  });
});

/* ------------------------ What /@fs/ may hand the page ------------------------ */

describe('the config and the stats file are not served to the page', () => {
  /** Vite's real file-serving verdict for `deny` as the studio sets it. */
  async function allowed(cwd: string, deny: string[]) {
    const config = await resolveConfig(
      { root: cwd, configFile: false, envDir: false, server: { fs: { allow: [cwd], deny } } },
      'serve'
    );
    return (file: string) => isFileLoadingAllowed(config, normalizePath(resolve(file)));
  }

  function project(dir: string) {
    mkdirSync(resolve(dir, 'src/email'), { recursive: true });
    const configPath = resolve(dir, 'workflow.config.ts');
    const statsPath = resolve(dir, 'workflow.stats.ts');
    const registry = resolve(dir, 'src/email/index.ts');
    writeFileSync(configPath, CONFIG);
    writeFileSync(statsPath, 'export default {};\n');
    writeFileSync(registry, EMAILS);
    return { configPath, statsPath, registry };
  }

  test('both files are denied; the registry the browser imports is still served', async () => {
    const cwd = tempProject();
    const { configPath, statsPath, registry } = project(cwd);
    const serves = await allowed(cwd, projectFileDeny([configPath, statsPath]));

    expect(serves(statsPath)).toBe(false);
    expect(serves(configPath)).toBe(false);
    expect(serves(registry)).toBe(true);
  });

  test('a missing stats file is simply left out', () => {
    const cwd = tempProject();
    const { configPath } = project(cwd);
    /* The config under its own name and, where tmpdir is itself a symlink, its real one; nothing else. */
    const deny = projectFileDeny([configPath, undefined]);
    expect(deny.length).toBeGreaterThanOrEqual(1);
    expect(deny.every((pattern) => pattern.endsWith('/workflow.config.ts'))).toBe(true);
  });

  test('a project path with glob characters in it is matched literally', async () => {
    const cwd = resolve(tempProject(), 'acme (1) [beta]+{x}');
    mkdirSync(cwd, { recursive: true });
    const { configPath, statsPath, registry } = project(cwd);
    const serves = await allowed(cwd, projectFileDeny([configPath, statsPath]));

    expect(serves(statsPath)).toBe(false);
    expect(serves(registry)).toBe(true);
  });

  test('a symlinked stats file is denied under its real name too', async () => {
    const cwd = tempProject();
    const real = resolve(tempProject(), 'stats.real.ts');
    writeFileSync(real, 'export default {};\n');
    const { configPath } = project(cwd);
    const link = resolve(cwd, 'workflow.stats.link.ts');
    symlinkSync(real, link);
    const deny = projectFileDeny([configPath, link]);
    const serves = await allowed(cwd, deny);

    expect(serves(link)).toBe(false);
    expect(serves(real)).toBe(false);
  });
});

describe('credentials beside the project are not served to the page', () => {
  test('wrangler vars, signing keys and platform credentials are denied; source is not', async () => {
    const cwd = tempProject();
    const config = await resolveConfig(
      {
        root: cwd,
        configFile: false,
        envDir: false,
        server: { fs: { allow: [cwd], deny: [...STUDIO_FS_DENY] } },
      },
      'serve'
    );
    const serves = (file: string) =>
      isFileLoadingAllowed(config, normalizePath(resolve(cwd, file)));

    const secrets = [
      '.dev.vars',
      'apps/worker/.dev.vars.production',
      'keys/AuthKey_ABC123.p8',
      'ios/GoogleService-Info.plist',
      'android/app/google-services.json',
      'certs/push.pfx',
      'certs/push.pem',
      'certs/server.key',
      '.env',
    ];
    expect(secrets.filter((file) => serves(file))).toEqual([]);
    expect(serves('src/email/index.ts')).toBe(true);
  });
});
