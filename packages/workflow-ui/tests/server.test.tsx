import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import type { Plugin, ViteDevServer } from 'vite';
import { describe, expect, test } from 'vitest';
import {
  MERGE_SOURCE,
  discoveryModule,
  isInsideDir,
  isInsideProject,
  studioApiPlugin,
  studioRequestRejection,
} from '../src/server';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function tempProject(): string {
  return mkdtempSync(resolve(tmpdir(), 'workflow-ui-'));
}

/* ------------------------------ Request origin ------------------------------ */

const JSON_POST = { method: 'POST', headers: { 'content-type': 'application/json' } };

function request(headers: Record<string, string>, method = 'POST'): IncomingMessage {
  return {
    method,
    headers: { ...JSON_POST.headers, host: 'localhost:4321', ...headers },
  } as unknown as IncomingMessage;
}

describe('who is allowed to reach the write-back endpoints', () => {
  test('a same-origin write from the studio page is accepted', () => {
    expect(
      studioRequestRejection(
        request({ origin: 'http://localhost:4321', 'sec-fetch-site': 'same-origin' })
      )
    ).toBeUndefined();
  });

  test('a request with no origin and no fetch metadata is accepted', () => {
    expect(studioRequestRejection(request({}))).toBeUndefined();
    expect(studioRequestRejection(request({}, 'GET'))).toBeUndefined();
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

  test('a write needs a content type a cross-site form cannot send', () => {
    const simplePost = {
      method: 'POST',
      headers: { host: 'localhost:4321', 'content-type': 'text/plain' },
    };
    expect(studioRequestRejection(simplePost)).toMatch(/content-type/);
    /* Charset and casing are the client's business, the type is not. */
    expect(
      studioRequestRejection(request({ 'content-type': 'Application/JSON; charset=utf-8' }))
    ).toBeUndefined();
    /* Reads carry no body, so nothing to demand of them. */
    expect(
      studioRequestRejection({ method: 'GET', headers: { host: 'localhost:4321' } })
    ).toBeUndefined();
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

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/** Collect the plugin's middlewares without standing up a real dev server. */
function handlers(plugin: Plugin, server: Partial<ViteDevServer> = {}): Map<string, Handler> {
  const collected = new Map<string, Handler>();
  const configureServer = plugin.configureServer;
  if (typeof configureServer !== 'function') throw new Error('expected a configureServer hook');
  void configureServer.call(
    undefined as never,
    {
      ...server,
      middlewares: { use: (path: string, handler: Handler) => collected.set(path, handler) },
    } as unknown as ViteDevServer
  );
  return collected;
}

function call(
  handler: Handler,
  req: { method: string; url?: string; headers?: Record<string, string>; body?: unknown }
): Promise<Answer> {
  return new Promise((done) => {
    const message = new EventEmitter() as IncomingMessage & { method: string };
    message.method = req.method;
    message.url = req.url ?? '/';
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

    handler(message, res);
    if (req.body !== undefined) message.emit('data', Buffer.from(JSON.stringify(req.body)));
    message.emit('end');
  });
}

const CONFIG = `import { defineConfig } from '@shware/workflow-ui/config';

export default defineConfig({ emails: { addresses: ['Acme <hello@acme.io>'] } });
`;

describe('--config names the file the studio reads and writes', () => {
  function projectWithTwoConfigs(): { cwd: string; named: string } {
    const cwd = tempProject();
    mkdirSync(resolve(cwd, 'apps/marketing'), { recursive: true });
    /* The decoy is what an unthreaded findConfig(cwd) picks up instead. */
    writeFileSync(resolve(cwd, 'workflow.config.ts'), CONFIG);
    const named = resolve(cwd, 'apps/marketing/workflow.config.ts');
    writeFileSync(named, CONFIG);
    return { cwd, named };
  }

  test('the generated module imports the named config, not the one in cwd', () => {
    const { cwd, named } = projectWithTwoConfigs();
    const generated = discoveryModule(cwd, named);

    expect(generated).toContain(`import userConfig from ${JSON.stringify(named)};`);
    expect(generated).not.toContain(JSON.stringify(resolve(cwd, 'workflow.config.ts')));
  });

  test('"add address" writes into the named config, leaving the one in cwd alone', async () => {
    const { cwd, named } = projectWithTwoConfigs();
    const handler = handlers(studioApiPlugin(cwd, named)).get('/__studio/addresses');
    if (handler === undefined) throw new Error('no addresses handler');

    const answer = await call(handler, {
      method: 'POST',
      headers: { origin: 'http://localhost:4321', 'sec-fetch-site': 'same-origin' },
      body: { action: 'add', address: 'Growth <growth@acme.io>' },
    });

    expect(answer.status).toBe(200);
    expect(readFileSync(named, 'utf8')).toContain('Growth <growth@acme.io>');
    expect(readFileSync(resolve(cwd, 'workflow.config.ts'), 'utf8')).not.toContain('growth@');
  });

  test('a cross-origin write never reaches the file', async () => {
    const { cwd, named } = projectWithTwoConfigs();
    const handler = handlers(studioApiPlugin(cwd, named)).get('/__studio/addresses');
    if (handler === undefined) throw new Error('no addresses handler');

    const answer = await call(handler, {
      method: 'POST',
      headers: { origin: 'https://evil.test', 'content-type': 'text/plain' },
      body: { action: 'add', address: 'Attacker <evil@evil.test>' },
    });

    expect(answer.status).toBe(403);
    expect(readFileSync(named, 'utf8')).not.toContain('evil@evil.test');
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
    const handler = handlers(studioApiPlugin(packageRoot, undefined), {
      transformRequest: () => Promise.resolve(null),
    }).get('/__studio/node');
    if (handler === undefined) throw new Error('no node handler');

    const answer = await call(handler, {
      method: 'GET',
      url: '/?file=../workflow/package.json&line=1&column=1',
    });

    expect(answer).toEqual({ status: 422, body: { error: 'source file is outside the project' } });
  });
});

/* -------------------------------- Discovery --------------------------------- */

interface Collected {
  workflows: Record<string, unknown>;
  segments: unknown[];
}

/** Run the merge step that ships inside the generated module, exactly as it ships. */
const collectDefinitions = runInNewContext(`${MERGE_SOURCE}; collectDefinitions;`) as (
  modules: [string, Record<string, unknown>][]
) => Collected;

describe('two modules claiming one workflow name', () => {
  const onboarding = { toIR: () => ({}) };
  const winback = { toIR: () => ({}) };

  test('the collision is an error naming both files, not a silent overwrite', () => {
    expect(() =>
      collectDefinitions([
        ['/proj/src/workflows/a.ts', { default: onboarding }],
        ['/proj/src/workflows/b.ts', { default: winback }],
      ])
    ).toThrow(/two workflow modules export "default"[\s\S]*a\.ts[\s\S]*b\.ts/);
  });

  test('the same workflow re-exported through a barrel is not a collision', () => {
    const collected = collectDefinitions([
      ['/proj/src/workflows/a.ts', { onboarding }],
      ['/proj/src/workflows/index.ts', { onboarding }],
    ]);

    expect(Object.keys(collected.workflows)).toEqual(['onboarding']);
  });

  test('distinct names and segments still collect as before', () => {
    const segment = { __segment: true };
    const collected = collectDefinitions([
      ['/proj/src/workflows/a.ts', { onboarding, active: segment }],
      ['/proj/src/workflows/b.ts', { winback, activeAgain: segment, note: 'not a workflow' }],
    ]);

    expect(Object.keys(collected.workflows)).toEqual(['onboarding', 'winback']);
    expect(collected.segments).toEqual([segment]);
  });
});
