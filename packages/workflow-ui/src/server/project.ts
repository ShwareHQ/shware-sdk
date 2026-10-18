import {
  ConfigCompileError,
  type EmailAddress,
  type JourneyConfig,
  compileConfig,
  formatEmailAddress,
  isConfig,
  isDiscordTemplate,
  isEmailTemplate,
  isPushTemplate,
  isSlackTemplate,
} from '@shware/workflow';
import type { ViteDevServer } from 'vite';
import type { ResolvedStudioConfig, StudioError } from '../config';

/**
 * Reading the project — on the dev server, never in the browser.
 *
 * workflow.config.ts default-exports `defineConfig({...})` from
 * `@shware/workflow`, and the studio reads exactly that: its workflows,
 * segments, actions, template registries, title and email envelope. It is
 * compiled with `compileConfig`, the same compile the Worker deploys, so the
 * studio lists exactly what would ship.
 *
 * What crosses to the browser is decided here too. The config is a source
 * object — schemas, components, the contract, runtime settings, whatever the
 * host imports — so it stays on the server. The browser receives the compiled
 * IR as JSON, and imports the two template registries (the code a preview has
 * to run) straight from the modules that export them, located by identity in
 * Vite's SSR module graph. It never imports workflow.config.ts.
 */

/** How the server evaluates a project module (Vite's ssrLoadModule in the studio). */
export type ModuleLoader = (file: string) => Promise<Record<string, unknown>>;

/** Every module the loader has evaluated so far, with its exports. */
export type LoadedModules = () => Iterable<[file: string, exports: Record<string, unknown>]>;

/** The modules a Vite server has evaluated for SSR — where registries are located by identity. */
export function ssrModulesOf(server: ViteDevServer): LoadedModules {
  return function* () {
    for (const mod of server.moduleGraph.idToModuleMap.values()) {
      const exports = mod.ssrModule as Record<string, unknown> | null;
      if (mod.file !== null && exports !== null) yield [mod.file, exports];
    }
  };
}

type Channel = 'email' | 'push' | 'discord' | 'slack';

/** One named export the browser imports — or one channel of it, for an exported `{ email, push }`. */
export interface ModuleRef {
  file: string;
  name: string;
  property?: Channel;
}

/** Per channel: how to recognise its entries, the factory to name, the virtual module's field. */
const CHANNELS: Record<
  Channel,
  { is: (value: unknown) => boolean; factory: string; field: string }
> = {
  email: { is: isEmailTemplate, factory: 'emailTemplate', field: 'emails' },
  push: { is: isPushTemplate, factory: 'pushTemplate', field: 'pushes' },
  discord: { is: isDiscordTemplate, factory: 'discordTemplate', field: 'discords' },
  slack: { is: isSlackTemplate, factory: 'slackTemplate', field: 'slacks' },
};

export interface StudioSnapshot {
  /** The JSON half of the virtual module: compiled output and labels only. */
  payload: Omit<ResolvedStudioConfig, 'emails' | 'pushes' | 'discords' | 'slacks' | 'stats'>;
  /** The import half: where each registry comes from. */
  registries: Record<Channel, ModuleRef | undefined>;
}

/** A project the studio cannot read: the message says what to change. */
class StudioLoadError extends Error {}

/* --------------------------------- Imports --------------------------------- */

/**
 * The module that exports `registry`, by identity: the registry itself, or
 * else an exported `{ email, push }` holding it (`export const templates =
 * { email, push }`).
 * workflow.config.ts itself is never a candidate: importing it would bring the
 * whole config (and everything it imports) into the browser. Sorted by path,
 * so the answer does not depend on load order.
 */
function locate(
  channel: Channel,
  registry: Record<string, unknown> | undefined,
  modules: LoadedModules,
  configPath: string
): ModuleRef | undefined {
  if (registry === undefined) return undefined;
  const { is: isTemplate, factory } = CHANNELS[channel];
  for (const [key, entry] of Object.entries(registry)) {
    if (!isTemplate(entry)) {
      throw new StudioLoadError(
        `templates.${channel}['${key}'] is not a ${factory}({...}) definition — every entry of the ${channel} registry must be one.`
      );
    }
  }
  /* An empty registry has nothing for the browser to import. */
  if (Object.keys(registry).length === 0) return undefined;
  const sorted = [...modules()]
    .filter(([file]) => file !== configPath)
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [file, exports] of sorted) {
    for (const [name, exported] of Object.entries(exports)) {
      if (exported === registry) return { file, name };
    }
  }
  for (const [file, exports] of sorted) {
    for (const [name, exported] of Object.entries(exports)) {
      if (
        typeof exported === 'object' &&
        exported !== null &&
        (exported as Partial<Record<Channel, unknown>>)[channel] === registry
      ) {
        return { file, name, property: channel };
      }
    }
  }
  throw new StudioLoadError(
    `templates.${channel} is not exported from a module of its own. Export the registry ` +
      `(e.g. \`export const ${channel} = {...}\` in src/${channel}/index.ts, or ` +
      '`export const templates = { email, push }` in src/templates.ts) ' +
      'and import it into workflow.config.ts — the studio loads that module, never the config, into the browser.'
  );
}

/* --------------------------------- Snapshot -------------------------------- */

function errorOf(error: unknown): StudioError {
  return {
    kind: error instanceof ConfigCompileError ? 'compile' : 'load',
    message: error instanceof Error ? error.message : String(error),
  };
}

function formatted(address: EmailAddress | undefined): string | undefined {
  return address === undefined ? undefined : formatEmailAddress(address);
}

function failed(error: unknown, title?: string): StudioSnapshot {
  return {
    payload: {
      ...(title !== undefined ? { title } : {}),
      workflows: {},
      segments: [],
      emailDefaults: {},
      error: errorOf(error),
    },
    registries: { email: undefined, push: undefined, discord: undefined, slack: undefined },
  };
}

/**
 * Load and compile. Never throws: a config that fails to load, is not a
 * `defineConfig({...})`, holds something other than template definitions, or
 * does not compile becomes a snapshot carrying the error, which the studio
 * shows in place of its views — a compile error names the workflow and node.
 */
export async function loadSnapshot(options: {
  configPath: string;
  load: ModuleLoader;
  modules: LoadedModules;
}): Promise<StudioSnapshot> {
  const { configPath, load, modules } = options;
  let config: JourneyConfig;
  let registries: StudioSnapshot['registries'];
  try {
    const exported = (await load(configPath)).default;
    if (!isConfig(exported)) {
      throw new StudioLoadError(
        `${configPath} must \`export default defineConfig({...})\` from '@shware/workflow'.`
      );
    }
    config = exported;
    registries = {
      email: locate('email', config.templates?.email, modules, configPath),
      push: locate('push', config.templates?.push, modules, configPath),
      discord: locate('discord', config.templates?.discord, modules, configPath),
      slack: locate('slack', config.templates?.slack, modules, configPath),
    };
  } catch (error) {
    return failed(error);
  }

  const from = formatted(config.emails?.from);
  const replyTo = formatted(config.emails?.replyTo);
  const shared = {
    ...(config.title !== undefined ? { title: config.title } : {}),
    emailDefaults: {
      ...(from !== undefined ? { from } : {}),
      ...(replyTo !== undefined ? { replyTo } : {}),
    },
  };

  try {
    const bundle = compileConfig(config);
    return {
      payload: {
        ...shared,
        workflows: Object.fromEntries(bundle.workflows.map((workflow) => [workflow.id, workflow])),
        segments: bundle.segments,
      },
      registries,
    };
  } catch (error) {
    return {
      payload: { ...shared, workflows: {}, segments: [], error: errorOf(error) },
      registries,
    };
  }
}

/* ------------------------------ Virtual module ----------------------------- */

/** The `StatsSource` methods, the only names the stats endpoint answers. */
export const STATS_METHODS = [
  'reports',
  'segments',
  'profiles',
  'nodeStats',
  'metrics',
  'links',
  'messages',
] as const;
export type StatsMethod = (typeof STATS_METHODS)[number];

/**
 * The module the browser imports as `virtual:workflow-config`: the payload as
 * a JSON literal, the template registries as imports from their own modules
 * (re-keyed by template id), and
 * the stats source as calls to the studio's server, one per method
 * workflow.stats.ts defines — the source itself runs there, next to the
 * database and the secrets it reads with, never in the browser.
 */
/** An export name as an import names it: quoted (ES2022) when it is not an identifier. */
const exportName = (name: string) =>
  /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);

export function virtualModule(
  snapshot: StudioSnapshot,
  statsMethods: readonly StatsMethod[] | undefined
): string {
  const imports: string[] = [];
  const importOf = (ref: ModuleRef, local: string): string => {
    /* One channel of an exported `{ email, push }`: import the whole under its own alias. */
    const binding = ref.property === undefined ? local : `${local}Source`;
    imports.push(
      ref.name === 'default'
        ? `import ${binding} from ${JSON.stringify(ref.file)};`
        : `import { ${ref.name === binding ? binding : `${exportName(ref.name)} as ${binding}`} } from ${JSON.stringify(ref.file)};`
    );
    return ref.property === undefined ? binding : `${binding}.${ref.property}`;
  };
  const registries = (Object.keys(CHANNELS) as Channel[]).map((channel) => {
    const ref = snapshot.registries[channel];
    const { field } = CHANNELS[channel];
    return `  ${field}: ${ref === undefined ? '{}' : `byId(${importOf(ref, field)})`},`;
  });
  const stats =
    statsMethods === undefined
      ? undefined
      : `{ ${statsMethods.map((method) => `${method}: call(${JSON.stringify(method)})`).join(', ')} }`;
  const call =
    stats === undefined
      ? ''
      : `
const call = (method) => async (...args) => {
  const response = await fetch(\`/__studio/stats/\${method}\`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? \`stats \${method} failed: \${response.status}\`);
  return body;
};`;

  return `${imports.join('\n')}${call}
/* The views look a template up by its id, the name messages use, never by the property holding it. */
const byId = (registry) => Object.fromEntries(Object.values(registry).map((t) => [t.id, t]));
const payload = ${JSON.stringify(snapshot.payload)};
export default {
  ...payload,
${registries.join('\n')}${stats === undefined ? '' : `\n  stats: ${stats},`}
};
`;
}
