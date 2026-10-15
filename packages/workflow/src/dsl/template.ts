/**
 * Templates — named message-content assets. The DSL only ever holds a
 * reference ({ channel, key, phantom props }); the content itself (react-email
 * components) lives in the app and meets the reference again in the studio and
 * at send time via the registry.
 *
 * Type technique: `templates(registry)` derives the references from the
 * registries so **the registries type the keys** — an unregistered key fails
 * to compile — while `PropsOf<M>` reads the props contract off each template's
 * Zod schema, so it is written exactly once.
 */

import type * as core from 'zod/v4/core';
import {
  type DiscordTemplate,
  type EmailTemplate,
  type PropsSchema,
  type PushTemplate,
  type SlackTemplate,
  isDiscordTemplate,
  isEmailTemplate,
  isPushTemplate,
  isSlackTemplate,
} from '../templates';

export type Channel = 'email' | 'sms' | 'push' | 'in_app' | 'slack' | 'discord' | 'survey';

export type EmptyProps = Record<never, never>;

/**
 * Template reference: a top-level named asset, reusable across workflows and
 * versioned on its own. The props shape is declared here and checked at use.
 */
export interface TemplateRef<C extends Channel = Channel, P extends object = EmptyProps> {
  readonly channel: C;
  readonly key: string;
  readonly __props?: P;
}

export interface TemplateFactory {
  email<P extends object = EmptyProps>(key: string): TemplateRef<'email', P>;
  sms<P extends object = EmptyProps>(key: string): TemplateRef<'sms', P>;
  push<P extends object = EmptyProps>(key: string): TemplateRef<'push', P>;
  inApp<P extends object = EmptyProps>(key: string): TemplateRef<'in_app', P>;
  slack<P extends object = EmptyProps>(key: string): TemplateRef<'slack', P>;
  discord<P extends object = EmptyProps>(key: string): TemplateRef<'discord', P>;
  survey<P extends object = EmptyProps>(key: string): TemplateRef<'survey', P>;
}

const makeTemplate =
  <C extends Channel>(channel: C) =>
  <P extends object = EmptyProps>(key: string): TemplateRef<C, P> => ({ channel, key });

/**
 * Unbound template references, props typed by hand. Email and push refs come
 * from the registries (`templates<Emails, Pushes>()`), which type both key and
 * props; this is the low-level form for channels without a registry (sms,
 * slack, …) and for tests.
 *
 *   const alert = template.slack<{ plan: string }>('cs_churn_alert');
 */
export const template: TemplateFactory = {
  email: makeTemplate('email'),
  sms: makeTemplate('sms'),
  push: makeTemplate('push'),
  inApp: makeTemplate('in_app'),
  slack: makeTemplate('slack'),
  discord: makeTemplate('discord'),
  survey: makeTemplate('survey'),
};

/* ----------------------------- Template registry ---------------------------- */

/** Template props: the input type of the template's Zod `props` schema — what the DSL passes. */
export type PropsOf<M> = M extends
  | EmailTemplate<infer S>
  | PushTemplate<infer S>
  | DiscordTemplate<infer S, never>
  | SlackTemplate<infer S, never>
  ? core.input<S> extends object
    ? core.input<S>
    : EmptyProps
  : never;

/**
 * The channel registries: what the config registers as `templates` and what
 * `templates()` derives the references from — one type for both. Leave it
 * inferred, or check it with `satisfies TemplateRegistry`: annotating a value
 * as the bare type widens the keys to `string`.
 */
export interface TemplateRegistry<
  E extends Readonly<Record<string, EmailTemplate>> = Readonly<Record<string, EmailTemplate>>,
  P extends Readonly<Record<string, PushTemplate>> = Readonly<Record<string, PushTemplate>>,
> {
  readonly email?: E;
  readonly push?: P;
  /** Discord webhook templates, each typed by the host's Env its `webhook` reads. */
  readonly discord?: Readonly<Record<string, DiscordTemplate<PropsSchema, never>>>;
  readonly slack?: Readonly<Record<string, SlackTemplate<PropsSchema, never>>>;
}

/** One channel's registry in `R`, without the `undefined` of an optional field; `never` when absent. */
type ChannelRegistry<R, K extends 'email' | 'push' | 'discord' | 'slack'> = K extends keyof R
  ? Exclude<R[K], undefined>
  : never;

/** One reference per registered key, each typed by its own template's `props`. */
export type TemplateRefTable<C extends Channel, R> = {
  readonly [K in keyof R & string]: TemplateRef<C, PropsOf<R[K]>>;
};

/** `t.email.<key>` / `t.push.<key>`; a channel the registry leaves out is an empty table. */
export interface TemplateRefs<R extends TemplateRegistry> {
  readonly email: [ChannelRegistry<R, 'email'>] extends [never]
    ? EmptyProps
    : TemplateRefTable<'email', ChannelRegistry<R, 'email'>>;
  readonly push: [ChannelRegistry<R, 'push'>] extends [never]
    ? EmptyProps
    : TemplateRefTable<'push', ChannelRegistry<R, 'push'>>;
  readonly discord: [ChannelRegistry<R, 'discord'>] extends [never]
    ? EmptyProps
    : TemplateRefTable<'discord', ChannelRegistry<R, 'discord'>>;
  readonly slack: [ChannelRegistry<R, 'slack'>] extends [never]
    ? EmptyProps
    : TemplateRefTable<'slack', ChannelRegistry<R, 'slack'>>;
}

/**
 * Template references derived from the registries themselves: **the
 * registries type the keys** — an unregistered key fails to compile, and a
 * push template is not accepted where an email is — and each template's
 * `props` schema types its use sites. Templates are registered once; the
 * config takes the registries, the workflows take the references:
 *
 *   export const registry = { email, push };
 *   export const t = templates(registry);
 *   flow.email(t.email.welcome, { name: u.name });
 *
 * Each reference is a plain `{ channel, key }` built from the registry's own
 * keys; no template is rendered, and the registries are left untouched.
 */
export function templates<const R extends TemplateRegistry>(registry: R): TemplateRefs<R> {
  return {
    email: refTable('email', registry.email, isEmailTemplate),
    push: refTable('push', registry.push, isPushTemplate),
    discord: refTable('discord', registry.discord, isDiscordTemplate),
    slack: refTable('slack', registry.slack, isSlackTemplate),
  } as unknown as TemplateRefs<R>;
}

const ARTICLE: Record<'email' | 'push' | 'discord' | 'slack', string> = {
  email: 'an email',
  push: 'a push',
  discord: 'a Discord',
  slack: 'a Slack',
};

function refTable(
  channel: 'email' | 'push' | 'discord' | 'slack',
  entries: Readonly<Record<string, unknown>> | undefined,
  is: (value: unknown) => boolean
): Readonly<Record<string, TemplateRef>> {
  const table: Record<string, TemplateRef> = Object.create(null);
  for (const [key, entry] of Object.entries(entries ?? {})) {
    if (!is(entry)) {
      throw new TypeError(
        `templates(): '${key}' in the ${channel} registry is not ${ARTICLE[channel]} template`
      );
    }
    table[key] = template[channel](key);
  }
  return Object.freeze(table);
}
