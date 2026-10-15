import type { Block, KnownBlock } from '@slack/types';
import type { RESTPostAPIWebhookWithTokenJSONBody } from 'discord-api-types/v10';
import * as z from 'zod/mini';
import type * as core from 'zod/v4/core';
import type { ScalarIR } from './ir';

/**
 * Template definitions — `emailTemplate`, `pushTemplate`, `discordTemplate` and `slackTemplate`. One
 * object per template, and its Zod `props` schema is the only source of the
 * props type: the DSL's `.email()/.push()` arguments, the `preview`, and the
 * `component`/`content` parameter are all derived from it, and every render
 * parses the props against it first (types alone check nothing at run time).
 *
 * Kept free of React and of any renderer: the definitions are plain data plus
 * a function, so the DSL, the Worker and the studio can all import them; the
 * React rendering lives in `@shware/workflow/react-email`.
 *
 * Supported schemas (v1): a strict object (`z.strictObject`) whose fields are
 * string / number / boolean — optionally as enums or literals, optionally
 * `.optional()`, with the built-in checks (min, email, …). That is exactly
 * what IR message props can carry, and it keeps input and output identical, so
 * producer, studio and sender never disagree about a transformed value.
 * Anything else (nested objects, arrays, null, default/transform/coerce,
 * custom refinements) is rejected when the template is declared.
 */

/** A strict Zod object schema of scalar fields — the accepted shape of `props`. */
export type PropsSchema = core.$ZodObject;

/** What a push template's `content` returns: the notification itself. */
export interface PushContent {
  title: string;
  body: string;
  /** Rich image URL (iOS attachment / Android BigPicture). */
  image?: string;
  /** Where a tap leads: the page a browser push opens (the site's root when absent). */
  url?: string;
}

/** A Discord webhook message (`discord-api-types`): content, embeds, username, allowed mentions… */
export type DiscordContent = RESTPostAPIWebhookWithTokenJSONBody;

/** A Slack incoming-webhook message: the fallback `text` and, usually, Block Kit `blocks`. */
export interface SlackContent {
  /** Shown in notifications and wherever blocks cannot be; required even with blocks. */
  text: string;
  blocks?: (KnownBlock | Block)[];
  username?: string;
  icon_emoji?: string;
  icon_url?: string;
  mrkdwn?: boolean;
  unfurl_links?: boolean;
  unfurl_media?: boolean;
}

/** The channels a template can be declared for. */
export type TemplateChannel = 'email' | 'push' | 'discord' | 'slack';

interface TemplateBase<S extends PropsSchema> {
  /** Display name in the studio (not the email subject, not the notification title). */
  readonly title: string;
  readonly description?: string | undefined;
  readonly props: S;
  /** Sample props for the studio; parsed against `props` when the template is declared. */
  readonly preview: core.input<S>;
}

export interface EmailTemplate<S extends PropsSchema = PropsSchema> extends TemplateBase<S> {
  readonly kind: 'email-template';
  readonly version: 1;
  readonly subject: string;
  /** The email body: a component over the parsed props (rendered by `@shware/workflow/react-email`). */
  readonly component: (props: Readonly<core.output<S>>) => unknown;
}

export interface PushTemplate<S extends PropsSchema = PropsSchema> extends TemplateBase<S> {
  readonly kind: 'push-template';
  readonly version: 1;
  /** The notification, from the parsed props. Synchronous and pure; its result is checked before sending. */
  readonly content: (props: Readonly<core.output<S>>) => PushContent;
}

/**
 * A message posted to a team channel through an incoming webhook (Discord, Slack). The webhook
 * URL is a secret, so it lives in the Worker's environment and the template reads it from there
 * at send time: `webhook: (env: Env) => env.WEBHOOK_DISCORD_ALERTS`, with `Env` the host's
 * zod-validated environment (`journeyWorker({ env: schema })`). The studio never calls it.
 */
interface WebhookTemplateBase<S extends PropsSchema, Env> extends TemplateBase<S> {
  readonly version: 1;
  // A method, so a template typed by the host's Env still fits a registry of any Env
  webhook(env: Env): string | undefined;
}

export interface DiscordTemplate<
  S extends PropsSchema = PropsSchema,
  Env = Record<string, unknown>,
> extends WebhookTemplateBase<S, Env> {
  readonly kind: 'discord-template';
  /** The message, from the parsed props. Synchronous and pure; checked before sending. */
  readonly content: (props: Readonly<core.output<S>>) => DiscordContent;
}

export interface SlackTemplate<
  S extends PropsSchema = PropsSchema,
  Env = Record<string, unknown>,
> extends WebhookTemplateBase<S, Env> {
  readonly kind: 'slack-template';
  /** The message, from the parsed props. Synchronous and pure; checked before sending. */
  readonly content: (props: Readonly<core.output<S>>) => SlackContent;
}

/** Strips a Promise return out of the accepted callback types: async content is rejected at the type level. */
type Sync<T> = T extends Promise<unknown> ? never : T;

export interface EmailTemplateDefinition<S extends PropsSchema> {
  title: string;
  description?: string;
  props: S;
  subject: string;
  preview: NoInfer<core.input<S>>;
  component: (props: NoInfer<Readonly<core.output<S>>>) => unknown;
}

export interface PushTemplateDefinition<S extends PropsSchema, R> {
  title: string;
  description?: string;
  props: S;
  preview: NoInfer<core.input<S>>;
  content: (props: NoInfer<Readonly<core.output<S>>>) => Sync<R> & PushContent;
}

export interface WebhookTemplateDefinition<S extends PropsSchema, Env, C> {
  title: string;
  description?: string;
  props: S;
  preview: NoInfer<core.input<S>>;
  /** The webhook URL, read from the Worker's environment when a message is sent. */
  webhook: (env: Env) => string | undefined;
  content: (props: NoInfer<Readonly<core.output<S>>>) => Sync<C>;
}

/** Declare a Discord webhook template. Throws when `props` is unsupported or `preview` does not parse. */
export function discordTemplate<S extends PropsSchema, Env = Record<string, unknown>>(
  definition: WebhookTemplateDefinition<S, Env, DiscordContent>
): DiscordTemplate<S, Env> {
  assertSupportedSchema(definition.props, definition.title);
  parsePreview(definition.props, definition.preview, 'discord', definition.title);
  return { kind: 'discord-template', version: 1, ...definition };
}

/** Declare a Slack webhook template. Throws when `props` is unsupported or `preview` does not parse. */
export function slackTemplate<S extends PropsSchema, Env = Record<string, unknown>>(
  definition: WebhookTemplateDefinition<S, Env, SlackContent>
): SlackTemplate<S, Env> {
  assertSupportedSchema(definition.props, definition.title);
  parsePreview(definition.props, definition.preview, 'slack', definition.title);
  return { kind: 'slack-template', version: 1, ...definition };
}

/** Declare an email template. Throws when `props` uses an unsupported schema or `preview` does not parse. */
export function emailTemplate<S extends PropsSchema>(
  definition: EmailTemplateDefinition<S>
): EmailTemplate<S> {
  assertSupportedSchema(definition.props, definition.title);
  parsePreview(definition.props, definition.preview, 'email', definition.title);
  return { kind: 'email-template', version: 1, ...definition };
}

/** Declare a push template. Throws when `props` uses an unsupported schema or `preview` does not parse. */
export function pushTemplate<S extends PropsSchema, R extends PushContent>(
  definition: PushTemplateDefinition<S, R>
): PushTemplate<S> {
  assertSupportedSchema(definition.props, definition.title);
  parsePreview(definition.props, definition.preview, 'push', definition.title);
  return { kind: 'push-template', version: 1, ...definition } as unknown as PushTemplate<S>;
}

export function isEmailTemplate(value: unknown): value is EmailTemplate {
  return isMarked(value, 'email-template');
}

export function isPushTemplate(value: unknown): value is PushTemplate {
  return isMarked(value, 'push-template');
}

export function isDiscordTemplate(value: unknown): value is DiscordTemplate {
  return isMarked(value, 'discord-template');
}

export function isSlackTemplate(value: unknown): value is SlackTemplate {
  return isMarked(value, 'slack-template');
}

/** Any declared template. */
export type AnyTemplate = EmailTemplate | PushTemplate | DiscordTemplate | SlackTemplate;

const CHANNEL_OF: Record<AnyTemplate['kind'], TemplateChannel> = {
  'email-template': 'email',
  'push-template': 'push',
  'discord-template': 'discord',
  'slack-template': 'slack',
};

function isMarked(value: unknown, kind: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === kind &&
    (value as { version?: unknown }).version === 1
  );
}

/* ------------------------------- validation -------------------------------- */

/** One failed field, with the dotted path the studio and the logs show. */
export interface TemplateIssue {
  path: string;
  message: string;
}

/**
 * A template refused its input (`phase: 'props'` — the component/content was
 * never called) or its content function returned something that is not a
 * notification (`phase: 'content'` — called, but nothing is sent). Never a
 * provider failure: a sender must not read it as a dead device token.
 */
export class TemplateValidationError extends Error {
  override readonly name = 'TemplateValidationError';
  constructor(
    readonly channel: TemplateChannel,
    readonly template: string,
    readonly phase: 'props' | 'content',
    readonly issues: TemplateIssue[]
  ) {
    super(
      `${channel} template '${template}' ${phase === 'props' ? 'rejected its props' : 'returned invalid content'}: ${issues
        .map((i) => `${i.path || '(root)'} ${i.message}`)
        .join('; ')}`
    );
  }
}

function issuesOf(error: core.$ZodError): TemplateIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/**
 * Parse message props against a template's schema and return the parsed value
 * — the only value anything downstream may use. Throws TemplateValidationError.
 */
export function parseTemplateProps<S extends PropsSchema>(
  template: EmailTemplate<S> | PushTemplate<S> | DiscordTemplate<S> | SlackTemplate<S>,
  key: string,
  props: Record<string, unknown>
): core.output<S> {
  const channel = CHANNEL_OF[template.kind];
  const result = z.safeParse(template.props, props);
  if (!result.success) {
    throw new TemplateValidationError(channel, key, 'props', issuesOf(result.error));
  }
  return result.data;
}

const pushContentSchema = z.strictObject({
  title: z.string(),
  body: z.string(),
  image: z.optional(z.string()),
  url: z.optional(z.string()),
});

/** Run a push template's content over parsed props and check the notification it returns. */
export function renderPushContent(
  template: PushTemplate,
  key: string,
  props: Record<string, unknown>
): PushContent {
  const parsed = parseTemplateProps(template, key, props);
  const output: unknown = template.content(parsed);
  // A Promise (async content smuggled past the types) is an object without title/body: refused here
  const result = z.safeParse(pushContentSchema, output);
  if (!result.success) {
    throw new TemplateValidationError('push', key, 'content', issuesOf(result.error));
  }
  return result.data;
}

/**
 * What a Discord webhook accepts at all: something to show (content, an embed, a poll or
 * components) and content within Discord's 2000 characters. The rest of the body is Discord's to
 * judge; its types come from `discord-api-types`.
 */
const discordContentSchema = z.looseObject({
  content: z.optional(z.string().check(z.maxLength(2000))),
  embeds: z.optional(z.array(z.looseObject({}))),
});

const slackContentSchema = z.looseObject({
  text: z.string().check(z.minLength(1)),
  blocks: z.optional(z.array(z.looseObject({ type: z.string() }))),
});

/** Run a Discord template's content over parsed props and check the message it returns. */
export function renderDiscordContent(
  template: DiscordTemplate,
  key: string,
  props: Record<string, unknown>
): DiscordContent {
  const output: unknown = template.content(parseTemplateProps(template, key, props));
  const result = z.safeParse(discordContentSchema, output);
  const empty =
    result.success &&
    !result.data.content &&
    (result.data.embeds?.length ?? 0) === 0 &&
    (output as { poll?: unknown; components?: unknown[] }).poll === undefined &&
    ((output as { components?: unknown[] }).components?.length ?? 0) === 0;
  if (!result.success || empty) {
    const issues = result.success
      ? [{ path: '', message: 'a Discord message needs content, an embed, a poll or components' }]
      : issuesOf(result.error);
    throw new TemplateValidationError('discord', key, 'content', issues);
  }
  return output as DiscordContent;
}

/** Run a Slack template's content over parsed props and check the message it returns. */
export function renderSlackContent(
  template: SlackTemplate,
  key: string,
  props: Record<string, unknown>
): SlackContent {
  const output: unknown = template.content(parseTemplateProps(template, key, props));
  const result = z.safeParse(slackContentSchema, output);
  if (!result.success) {
    throw new TemplateValidationError('slack', key, 'content', issuesOf(result.error));
  }
  return output as SlackContent;
}

function parsePreview(
  schema: PropsSchema,
  preview: unknown,
  channel: TemplateChannel,
  title: string
) {
  const result = z.safeParse(schema, preview);
  if (!result.success) {
    throw new TemplateValidationError(
      channel,
      title,
      'props',
      issuesOf(result.error).map((i) => Object.assign(i, { message: `preview: ${i.message}` }))
    );
  }
}

/* ---------------------------- supported schemas ---------------------------- */

const SCALAR_TYPES = new Set(['string', 'number', 'boolean', 'enum']);

/** Throws when `schema` is outside the v1 subset (see the header). */
export function assertSupportedSchema(schema: unknown, where: string): void {
  const fail = (reason: string): never => {
    throw new TypeError(`template '${where}': unsupported props schema — ${reason}`);
  };
  const def = (schema as core.$ZodType | undefined)?._zod?.def;
  if (def?.type !== 'object') fail('props must be a z.strictObject({...})');
  const object = def as core.$ZodObjectDef;
  if (object.catchall?._zod.def.type !== 'never') {
    fail(
      'props must be strict (z.strictObject): unknown fields would be dropped or passed through'
    );
  }
  rejectCustomChecks(object, where, fail);
  for (const [field, value] of Object.entries(object.shape)) {
    let fieldDef = value._zod.def;
    if (fieldDef.type === 'optional') {
      // The wrapper carries checks of its own (`.optional().overwrite(...)`): refuse them too
      rejectCustomChecks(fieldDef, `${where}.${field}`, fail);
      fieldDef = (fieldDef as core.$ZodOptionalDef).innerType._zod.def;
    }
    if (fieldDef.type === 'literal') {
      const values = (fieldDef as core.$ZodLiteralDef<core.util.Literal>).values;
      if (!values.every((v) => ['string', 'number', 'boolean'].includes(typeof v))) {
        fail(`field '${field}' is a literal of a non-scalar value`);
      }
    } else if (!SCALAR_TYPES.has(fieldDef.type)) {
      fail(
        `field '${field}' is ${fieldDef.type}; only string, number, boolean, enum and literal fields (optionally .optional()) are supported`
      );
    }
    if ((fieldDef as { coerce?: boolean }).coerce === true) {
      fail(`field '${field}' coerces its input (z.coerce), which would change what the props mean`);
    }
    rejectCustomChecks(fieldDef, `${where}.${field}`, fail);
  }
}

/**
 * Checks the subset refuses: `custom` runs arbitrary code (`.refine()`), and
 * `overwrite` changes the value (`.overwrite()`, `.trim()`, `.toLowerCase()`…)
 * — the props are parsed more than once on the way to a send (the validator,
 * then the renderer), so a value-changing check would apply twice and the
 * email would differ from the preview.
 */
function rejectCustomChecks(def: core.$ZodTypeDef, where: string, fail: (reason: string) => never) {
  for (const check of def.checks ?? []) {
    if (check._zod.def.check === 'custom') {
      fail(`'${where}' uses a custom refinement, which the template subset does not support`);
    }
    if (check._zod.def.check === 'overwrite') {
      fail(
        `'${where}' changes the value (.overwrite, .trim, .toLowerCase, …), which the template subset does not support`
      );
    }
  }
}

/** The scalar props a template accepts, as the IR resolves them before parsing. */
export type ResolvedProps = Record<string, ScalarIR | undefined>;

/**
 * The engine's MessageValidator over the template registries: the message's
 * props are parsed by its template (the parsed value is what gets sent); a
 * push's content is also run once and checked, so an invalid notification
 * stops the send before any device; Discord and Slack content likewise. Channels without a
 * registry here (sms, …) pass through to their app-supplied senders.
 */
export function registryValidator(registries: {
  email?: Record<string, EmailTemplate> | undefined;
  push?: Record<string, PushTemplate> | undefined;
  discord?: Readonly<Record<string, DiscordTemplate<PropsSchema, never>>> | undefined;
  slack?: Readonly<Record<string, SlackTemplate<PropsSchema, never>>> | undefined;
}): {
  validate(message: { channel: string; template: string; props: ResolvedProps }): ResolvedProps;
} {
  return {
    validate({ channel, template, props }) {
      if (channel === 'email') {
        return parseTemplateProps(
          lookup(registries.email, 'email', template),
          template,
          props
        ) as ResolvedProps;
      }
      if (channel === 'push') {
        const entry = lookup(registries.push, 'push', template);
        renderPushContent(entry, template, props);
        return parseTemplateProps(entry, template, props) as ResolvedProps;
      }
      if (channel === 'discord') {
        const entry = lookup(registries.discord, 'discord', template) as DiscordTemplate;
        renderDiscordContent(entry, template, props);
        return parseTemplateProps(entry, template, props) as ResolvedProps;
      }
      if (channel === 'slack') {
        const entry = lookup(registries.slack, 'slack', template) as SlackTemplate;
        renderSlackContent(entry, template, props);
        return parseTemplateProps(entry, template, props) as ResolvedProps;
      }
      return props;
    },
  };
}

function lookup<T>(registry: Record<string, T> | undefined, channel: string, key: string): T {
  if (registry === undefined || !Object.hasOwn(registry, key)) {
    throw new Error(`${channel} template '${key}' is not registered`);
  }
  return registry[key];
}
