// @vitest-environment node
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ViteDevServer, createServer } from 'vite';
import { afterAll, describe, expect, test } from 'vitest';
import { projectPlugin } from '../src/server';
import {
  type StudioSnapshot,
  loadSnapshot,
  ssrModulesOf,
  virtualModule,
} from '../src/server/project';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const servers: ViteDevServer[] = [];

afterAll(async () => {
  await Promise.all(servers.map((server) => server.close()));
});

/** A bare Vite server over one fixture: the same ssrLoadModule the studio evaluates the project with. */
async function snapshotOf(
  name: string,
  configFile = 'workflow.config.ts'
): Promise<StudioSnapshot> {
  const cwd = resolve(fixtures, name);
  const server = await createServer({
    root: cwd,
    configFile: false,
    envDir: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  servers.push(server);
  return loadSnapshot({
    configPath: resolve(cwd, configFile),
    load: (file) => server.ssrLoadModule(file),
    modules: ssrModulesOf(server),
  });
}

/** Every path inside a value that holds a function or a Zod schema — nothing a payload may carry. */
function opaquePaths(value: unknown, path = 'payload'): string[] {
  if (typeof value === 'function') return [path];
  if (typeof value !== 'object' || value === null) return [];
  if (Object.hasOwn(value, '_zod')) return [path];
  return Object.entries(value).flatMap(([key, child]) => opaquePaths(child, `${path}.${key}`));
}

describe('a defineConfig project', () => {
  test('lists its workflows and imports its registry from the module that exports it', async () => {
    const snapshot = await snapshotOf('project');

    expect(snapshot.payload.error).toBeUndefined();
    expect(Object.keys(snapshot.payload.workflows)).toEqual(['onboarding']);
    expect(snapshot.payload.title).toBe('Fixture project');
    expect(snapshot.registries.email).toEqual({
      file: resolve(fixtures, 'project/src/email.ts'),
      name: 'email',
    });
    expect(snapshot.registries.push).toBeUndefined();
  });

  test('the browser looks templates up by id, not by the property holding them', async () => {
    const snapshot = await snapshotOf('project');
    const server = servers.at(-1);
    if (server === undefined) throw new Error('no fixture server');
    /* Evaluate the generated module the way the browser would, beside the fixture it imports. */
    const file = resolve(fixtures, 'project/.virtual.mjs');
    writeFileSync(file, virtualModule(snapshot, undefined));
    try {
      const { default: config } = await server.ssrLoadModule(file);
      const { email } = await server.ssrLoadModule(resolve(fixtures, 'project/src/email.ts'));
      expect(Object.keys(config.emails)).toEqual(['welcome']);
      expect(config.emails.welcome).toBe(email.welcomeEmail);
      expect(config.workflows.onboarding.flow[0]).toMatchObject({ template: 'welcome' });
    } finally {
      rmSync(file);
    }
  });

  test('its emails envelope is what the studio shows', async () => {
    const snapshot = await snapshotOf('project');

    expect(snapshot.payload.emailDefaults).toEqual({
      from: 'Acme <hello@acme.test>',
      replyTo: 'support@acme.test',
    });
  });

  test('the browser gets compiled output and the registry import — never the config', async () => {
    const snapshot = await snapshotOf('project');
    const code = virtualModule(snapshot, undefined);

    expect(opaquePaths(snapshot.payload)).toEqual([]);
    expect(JSON.parse(JSON.stringify(snapshot.payload))).toEqual(snapshot.payload);
    expect(code).not.toContain('workflow.config');
    expect(code).not.toContain('timeScale');
    /* Workflows arrive as IR; the only import is the template registry, never the `t` references. */
    expect(code.match(/^import .*$/gm)).toEqual([
      `import { email as emails } from ${JSON.stringify(resolve(fixtures, 'project/src/email.ts'))};`,
    ]);
  });

  test('the stats source reaches the browser as calls to the server, never as code', async () => {
    const snapshot = await snapshotOf('project');
    const code = virtualModule(snapshot, ['reports', 'segments']);

    expect(code).toContain('stats: { reports: call("reports"), segments: call("segments") }');
    expect(code).toContain('/__studio/stats/');
    expect(code).not.toContain('workflow.stats');
    expect(virtualModule(snapshot, undefined)).not.toContain('stats:');
  });
});

describe('one exported { email, push } registry', () => {
  test('each channel is imported as a property of the aggregate export', async () => {
    const snapshot = await snapshotOf('aggregate');
    const file = resolve(fixtures, 'aggregate/src/templates.ts');

    expect(snapshot.payload.error).toBeUndefined();
    expect(snapshot.registries).toEqual({
      email: { file, name: 'registry', property: 'email' },
      push: { file, name: 'registry', property: 'push' },
    });
    const code = virtualModule(snapshot, undefined);
    expect(code.match(/^import .*$/gm)).toEqual([
      `import { registry as emailsSource } from ${JSON.stringify(file)};`,
      `import { registry as pushesSource } from ${JSON.stringify(file)};`,
    ]);
    expect(code).toContain('emails: byId(emailsSource.email),');
    expect(code).toContain('pushes: byId(pushesSource.push),');
  });
});

describe('a project the studio cannot show', () => {
  test('a compile error is compileConfig’s own, naming the workflow and the node', async () => {
    const snapshot = await snapshotOf('broken');

    expect(snapshot.payload.error?.kind).toBe('compile');
    expect(snapshot.payload.error?.message).toMatch(
      /workflow 'onboarding' node 1: email template 'never_written' is not registered/
    );
    expect(snapshot.payload.workflows).toEqual({});
    expect(opaquePaths(snapshot.payload)).toEqual([]);
  });

  test('a default export that is not defineConfig({...}) is a load error saying so', async () => {
    const snapshot = await snapshotOf('not-config');

    expect(snapshot.payload.error?.kind).toBe('load');
    expect(snapshot.payload.error?.message).toMatch(/must `export default defineConfig/);
  });

  test('a registry entry that is not a template definition is named', async () => {
    const snapshot = await snapshotOf('not-template');

    expect(snapshot.payload.error?.message).toMatch(
      /templates\.push\['nudge'\] is not a pushTemplate\(\{\.\.\.\}\) definition/
    );
  });

  test('a registry written inline in the config is refused: the browser would need the config', async () => {
    const snapshot = await snapshotOf('inline');

    expect(snapshot.payload.error?.message).toMatch(
      /templates\.email is not exported from a module/
    );
  });

  test('a config that fails to load is a load error, not an exception', async () => {
    const snapshot = await snapshotOf('project', 'no-such-config.ts');

    expect(snapshot.payload.error?.kind).toBe('load');
  });
});

/* ------------------------------------ HMR ----------------------------------- */

describe('changing the registration list', () => {
  test('re-serves the virtual module with the new workflow', async () => {
    /* A scratch copy beside the fixtures, so its imports still resolve this package's dependencies. */
    const cwd = mkdtempSync(resolve(fixtures, '.tmp-'));
    try {
      cpSync(resolve(fixtures, 'project'), cwd, { recursive: true });
      const configPath = resolve(cwd, 'workflow.config.ts');
      const server = await createServer({
        root: cwd,
        configFile: false,
        envDir: false,
        logLevel: 'silent',
        appType: 'custom',
        server: { middlewareMode: true, hmr: false },
        plugins: [projectPlugin(configPath, undefined)],
      });
      servers.push(server);
      const served = async () =>
        (await server.transformRequest('virtual:workflow-config'))?.code ?? '';

      expect(await served()).toContain('"onboarding"');
      expect(await served()).not.toContain('"second"');

      writeFileSync(
        resolve(cwd, 'src/second.ts'),
        readFileSync(resolve(cwd, 'src/flows.ts'), 'utf8')
          .replace("'onboarding'", "'second'")
          .replace('export const onboarding', 'export const second')
      );
      writeFileSync(
        configPath,
        readFileSync(configPath, 'utf8')
          .replace(
            "import { onboarding } from './src/flows';",
            "import { onboarding } from './src/flows';\nimport { second } from './src/second';"
          )
          .replace('workflows: [onboarding]', 'workflows: [onboarding, second]')
      );

      await expect.poll(served, { timeout: 10_000, interval: 100 }).toContain('"second"');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 20_000);
});

describe('a config outside the working directory', () => {
  test('edits to it, and to modules it imports, still refresh the snapshot', async () => {
    /*
     * `--config ../shared/workflow.config.ts`: the studio runs in `app/`, the
     * config and everything it imports live in `shared/`. A cwd-prefix filter
     * would drop every one of these changes and leave the canvas stale.
     */
    const scratch = mkdtempSync(resolve(fixtures, '.tmp-'));
    try {
      const cwd = resolve(scratch, 'app');
      const shared = resolve(scratch, 'shared');
      mkdirSync(cwd);
      cpSync(resolve(fixtures, 'project'), shared, { recursive: true });
      cpSync(resolve(fixtures, 'contract.ts'), resolve(scratch, 'contract.ts'));
      const configPath = resolve(shared, 'workflow.config.ts');
      const server = await createServer({
        root: cwd,
        configFile: false,
        envDir: false,
        logLevel: 'silent',
        appType: 'custom',
        server: { middlewareMode: true, hmr: false },
        plugins: [projectPlugin(configPath, undefined)],
      });
      servers.push(server);
      const served = async () =>
        (await server.transformRequest('virtual:workflow-config'))?.code ?? '';

      expect(await served()).toContain('"title":"Fixture project"');

      /* The config itself. */
      writeFileSync(
        configPath,
        readFileSync(configPath, 'utf8').replace("'Fixture project'", "'Shared project'")
      );
      await expect
        .poll(served, { timeout: 10_000, interval: 100 })
        .toContain('"title":"Shared project"');

      /* A module the config imports — a shared workflow. */
      const flows = resolve(shared, 'src/flows.ts');
      writeFileSync(
        flows,
        readFileSync(flows, 'utf8').replace("name: 'Onboarding'", "name: 'Renamed'")
      );
      await expect.poll(served, { timeout: 10_000, interval: 100 }).toContain('"name":"Renamed"');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 30_000);
});
