import * as z from 'zod/mini';
import type * as core from 'zod/v4/core';
import type { Contract } from './contract';
import { type ActionRef, type SegmentRef, type WorkflowBuilder, compileBundle } from './dsl';
import { templateUses } from './dsl/flow';
import { type EmailConfig, assertEmailConfig } from './email';
import type { BundleIR, ChannelIR, NodeIR, WorkflowIR } from './ir';
import type { JourneyMode, JourneyRuntimeConfig } from './runtime';
import {
  type AnyTemplate,
  CHANNEL_OF,
  type TemplateChannel,
  type TemplateRegistry,
  indexTemplates,
} from './templates';

/**
 * `workflow.config.ts` — the project's journey configuration, typed, flat and
 * committed with the code: what it deploys (workflows, segments, actions),
 * the template registries behind them, the contract every inbound event is
 * checked against, what the email templates share, and how the engine runs per
 * environment (time scale, APNs, FCM). The compiler (`compileConfig`), the
 * Worker (`journeyWorker({ config })`) and the Workflow Studio all read this
 * one object, so everything is registered exactly once:
 *
 *   export default defineConfig({
 *     title: 'Workflow Studio · Acme',
 *     contract,
 *     workflows, // [onboarding, notificationTest]
 *     templates, // { email, push }: the definitions the workflows send
 *     email: { unsubscribeUrl: 'https://acme.test/unsubscribe' },
 *     runtime: { development: { timeScale: 600, logMessages: true } },
 *     apns: { topic: 'io.acme.app', keyId: 'ABC123DEFG', teamId: 'TEAM123456' },
 *   });
 *
 * Secrets are the one thing that stay out: a `.p8`, a service account, the
 * ingest bearer. The host reads them from its environment under fixed names
 * (see `JourneyEnv`), so the config says *which* key without carrying it. The
 * config is a source object (schemas, components, functions); only its
 * compiled bundle and preview-safe template data may cross to a browser.
 */

/** Token-based APNs, the `.p8` auth key; the key itself is `APNS_PRIVATE_KEY_BASE64` in the environment. */
export interface ApnsConfig {
  /** The app's bundle id (`apns-topic`). */
  topic: string;
  /** The key's 10-character id. */
  keyId: string;
  /** The Apple Developer team id. */
  teamId: string;
  /**
   * Which APNs host each mode's device tokens belong to: `sandbox` for builds
   * signed with `aps-environment: development` (Xcode, the simulator),
   * `production` for App Store and TestFlight builds. Unlisted modes default
   * to `production` for the production mode and `sandbox` for every other.
   */
  environment?: Partial<Record<JourneyMode, 'sandbox' | 'production'>>;
}

/**
 * Standard Web Push for browsers (VAPID); the key pair is `VAPID_PUBLIC_KEY` /
 * `VAPID_PRIVATE_KEY` in the environment, and the site subscribes with the same public key.
 */
export interface WebPushConfig {
  /** Who push services may contact about this sender: `mailto:` or an `https:` URL. */
  subject: string;
  /**
   * The contract event a notification tap the browser reports (`opened_url`) is also recorded
   * as, with `{ message_id }`: the app reports its own taps as an event, and a service worker has
   * no session to do so — without this, browser opens reach the reports but not the conditions
   * (a `performed(e.push_opened)` segment). One event per copy, however often it is tapped.
   */
  openedEvent?: string;
}

/** FCM HTTP v1 for Android; the service account is `GOOGLE_APPLICATION_CREDENTIALS_BASE64` in the environment. */
export interface FcmConfig {
  /** Android notification channel the pushes land in (`android.notification.channel_id`). */
  androidChannelId?: string;
}

/**
 * The engine's tables live in a Postgres schema of their own, so their short names (`event`,
 * `profile`, `message`, …) never meet the app's. `workflow-ui generate` writes them as one drizzle
 * file on this schema; the host migrates it with its own tooling.
 */
export interface DatabaseConfig {
  /** The Postgres schema; `workflow` by default. */
  schema?: string;
}

export interface JourneyConfigDefinition {
  /** Studio title (the browser tab names the project). */
  title?: string;
  /** The shared `defineContract(...)` the Worker validates ingest against. */
  contract?: Contract;
  workflows: readonly WorkflowBuilder[];
  segments?: readonly SegmentRef[];
  actions?: readonly ActionRef[];
  /** The template definitions, per channel; each is identified by its own `id`. */
  templates?: TemplateRegistry;
  /** What every email template shares: the default unsubscribe link, how opens and clicks are judged. */
  email?: EmailConfig;
  /** How the engine behaves per mode (`development`, `production`, …): time scale, message logging. */
  runtime?: JourneyRuntimeConfig;
  apns?: ApnsConfig;
  fcm?: FcmConfig;
  webPush?: WebPushConfig;
  /** The schema the store keeps the engine's tables in. */
  database?: DatabaseConfig;
}

export interface JourneyConfig extends JourneyConfigDefinition {
  readonly kind: 'journey-config';
}

export function defineConfig(definition: JourneyConfigDefinition): JourneyConfig {
  return { kind: 'journey-config', ...definition };
}

export function isConfig(value: unknown): value is JourneyConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'journey-config'
  );
}

/** The APNs environment for `mode`: the configured one, else production only for production. */
export function apnsEnvironment(config: ApnsConfig, mode: JourneyMode): 'sandbox' | 'production' {
  return config.environment?.[mode] ?? (mode === 'production' ? 'production' : 'sandbox');
}

/** A message node the config's registries cannot serve, or whose literal props its template refuses. */
export class ConfigCompileError extends Error {
  override readonly name = 'ConfigCompileError';
}

/**
 * Compile the config: the bundle `compileBundle` would produce, with the
 * template manifest generated from the registry (every registered template,
 * by id, not a hand-kept list). The registry is checked first, used or not:
 * every entry is a template of its channel with an id, an id is registered
 * once per channel, and every email template's metadata is valid, as is the
 * config's `email` (which replaced `emails`: a config still carrying it fails).
 * Then every message node is checked against it — an
 * unregistered or cross-channel template fails with the workflow, node and
 * channel named, and so does a literal prop the template's schema refuses (a
 * missing required prop, an undeclared one, a wrong literal) — and every
 * definition a workflow sends must be the very object registered under its id,
 * not merely one with the same id. User-property references cannot be parsed
 * here (their values exist only at send time) — they are checked by name only,
 * and parsed before sending.
 */
export function compileConfig(config: JourneyConfig): BundleIR {
  let index: RegistryIndex;
  try {
    const email = indexTemplates('email', config.templates?.email);
    assertEmailConfig(config, email.values());
    index = {
      email,
      push: indexTemplates('push', config.templates?.push),
      discord: indexTemplates('discord', config.templates?.discord),
      slack: indexTemplates('slack', config.templates?.slack),
    };
  } catch (error) {
    throw new ConfigCompileError((error as Error).message);
  }
  const bundle = compileBundle({
    workflows: config.workflows,
    ...(config.segments === undefined ? {} : { segments: config.segments }),
    ...(config.actions === undefined ? {} : { actions: config.actions }),
    templates: TEMPLATE_CHANNELS.flatMap((channel) => [...index[channel].values()]),
  });
  bundle.workflows.forEach((workflow, i) => {
    checkMessages(workflow, workflow.flow, index, config);
    checkUses(workflow, config.workflows[i], index, config);
  });
  return bundle;
}

const TEMPLATE_CHANNELS = ['email', 'push', 'discord', 'slack'] as const;

/** The registry by id, per channel. */
type RegistryIndex = Record<TemplateChannel, ReadonlyMap<string, AnyTemplate>>;

/** The channel's templates by id; undefined for a channel templates cannot be declared for. */
function indexOf(
  index: RegistryIndex,
  channel: ChannelIR
): ReadonlyMap<string, AnyTemplate> | undefined {
  return (TEMPLATE_CHANNELS as readonly ChannelIR[]).includes(channel)
    ? index[channel as TemplateChannel]
    : undefined;
}

/**
 * The definitions a workflow sends against the registered ones: same id is not enough — a
 * workflow typed by one definition and a registry holding another under that id would render
 * with a schema the call was never checked against.
 */
function checkUses(
  workflow: WorkflowIR,
  builder: WorkflowBuilder,
  index: RegistryIndex,
  config: JourneyConfig
): void {
  for (const { template, loc } of templateUses(builder)) {
    const channel = CHANNEL_OF[template.kind];
    const registered = index[channel].get(template.id);
    if (registered === template) continue;
    const at = loc === undefined ? '' : ` (${loc.file}:${loc.line})`;
    const where = `workflow '${workflow.id}'${at}: ${channel} template '${template.id}'`;
    if (registered === undefined) throw new ConfigCompileError(`${where} is not registered`);
    const name = Object.entries(config.templates?.[channel] ?? {}).find(
      ([, entry]) => entry === registered
    )?.[0];
    throw new ConfigCompileError(
      `${where} is not the definition registered under that id (templates.${channel}.${name}) — two definitions share the id`
    );
  }
}

/** A field that may be left out: optional, or with a default the schema fills in. */
function canBeOmitted(schema: core.$ZodType): boolean {
  const type = schema._zod.def.type;
  return type === 'optional' || type === 'default' || type === 'prefault';
}

function checkMessages(
  workflow: WorkflowIR,
  nodes: readonly NodeIR[],
  index: RegistryIndex,
  config: JourneyConfig
): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'message':
        checkMessage(workflow, node, index, config);
        break;
      case 'send_event':
        checkEmit(workflow, node, config);
        break;
      case 'branch':
        for (const c of node.cases) checkMessages(workflow, c.flow, index, config);
        if (node.otherwise) checkMessages(workflow, node.otherwise, index, config);
        break;
      case 'cohort':
        for (const arm of node.arms) checkMessages(workflow, arm.flow, index, config);
        break;
      case 'wait_until':
        if (Array.isArray(node.onTimeout)) checkMessages(workflow, node.onTimeout, index, config);
        break;
      default:
        break;
    }
  }
}

function checkMessage(
  workflow: WorkflowIR,
  node: Extract<NodeIR, { type: 'message' }>,
  index: RegistryIndex,
  config: JourneyConfig
): void {
  const where = `workflow '${workflow.id}' node ${node.id}`;
  const registry = indexOf(index, node.channel);
  // Channels without template definitions (sms, …) are rendered by app-supplied senders
  if (registry === undefined) return;
  const entry = registry.get(node.template);
  if (entry === undefined) {
    const other = TEMPLATE_CHANNELS.find(
      (channel) => channel !== node.channel && index[channel].has(node.template)
    );
    const hint = other === undefined ? '' : ` (it is registered as a ${other} template)`;
    throw new ConfigCompileError(
      `${where}: ${node.channel} template '${node.template}' is not registered${hint}`
    );
  }
  const shape = (entry.props._zod.def as core.$ZodObjectDef).shape;
  const problems: string[] = [];
  for (const [field, value] of Object.entries(node.props)) {
    if (!Object.hasOwn(shape, field)) {
      problems.push(`'${field}' is not a prop of the template`);
      continue;
    }
    if (typeof value === 'object' && 'type' in value) {
      // A user ref's value exists only at send time (parsed then); here its name can be checked
      const profile = config.contract?.schemas.profile._zod.def;
      if (
        profile !== undefined &&
        value.path !== 'userId' &&
        !Object.hasOwn(profile.shape, value.path)
      ) {
        problems.push(
          `'${field}' reads u.${value.path}, which the contract's profile does not declare`
        );
      }
      continue;
    }
    const result = z.safeParse(shape[field], value);
    if (!result.success)
      problems.push(`'${field}' = ${JSON.stringify(value)} is refused by the schema`);
  }
  for (const [field, schema] of Object.entries(shape)) {
    const optional = canBeOmitted(schema);
    if (!optional && !Object.hasOwn(node.props, field))
      problems.push(`required prop '${field}' is missing`);
  }
  if (problems.length > 0) {
    throw new ConfigCompileError(
      `${where}: ${node.channel} '${node.template}': ${problems.join('; ')}`
    );
  }
}

/**
 * Whether an object schema refuses keys it does not declare: `z.strictObject`
 * sets its catchall to `never`; `z.object` strips unknown keys and
 * `z.looseObject` passes them through, and neither refuses.
 */
function refusesUnknownKeys(schema: core.$ZodType): boolean {
  return (schema._zod.def as core.$ZodObjectDef).catchall?._zod.def.type === 'never';
}

/**
 * An emitted event against the contract, as far as compile time can see: the
 * event is declared, literal payload values parse against their field, no
 * required field is missing, and — when the event's schema is strict — no
 * literal field is undeclared (the Worker would refuse the whole event at
 * emit time, failing the journey where the compile could have failed the
 * build). Values read from the profile are checked when the event is emitted,
 * by the same contract.
 */
function checkEmit(
  workflow: WorkflowIR,
  node: Extract<NodeIR, { type: 'send_event' }>,
  config: JourneyConfig
): void {
  const contract = config.contract;
  if (contract === undefined) return;
  const where = `workflow '${workflow.id}' node ${node.id}`;
  if (!contract.isEvent(node.event)) {
    throw new ConfigCompileError(
      `${where}: emits '${String(node.event)}', which is not in the contract`
    );
  }
  const schema = contract.schemas.events[node.event];
  const shape = (schema._zod.def as core.$ZodObjectDef).shape;
  const strict = refusesUnknownKeys(schema);
  const problems: string[] = [];
  for (const [field, value] of Object.entries(node.payload)) {
    if (typeof value === 'object' && 'type' in value) continue; // read at emit time
    if (!Object.hasOwn(shape, field)) {
      // A loose or stripping payload may carry extra fields; a strict one refuses them
      if (strict) problems.push(`'${field}' is not a field the contract declares for the event`);
      continue;
    }
    const result = z.safeParse(shape[field], value);
    if (!result.success)
      problems.push(`'${field}' = ${JSON.stringify(value)} is refused by the contract`);
  }
  for (const [field, fieldSchema] of Object.entries(shape)) {
    const optional = canBeOmitted(fieldSchema);
    if (!optional && !Object.hasOwn(node.payload, field))
      problems.push(`required field '${field}' is missing`);
  }
  if (problems.length > 0) {
    throw new ConfigCompileError(`${where}: event '${node.event}': ${problems.join('; ')}`);
  }
}
