/**
 * Templates — named message-content assets. The DSL only ever holds a
 * reference ({ channel, key, phantom props }); the content itself (react-email
 * components) lives in the app and meets the reference again in the studio and
 * at send time via the registry.
 *
 * Type technique: `templates<Emails>()` binds the registry so **the registry
 * types the key** — an unregistered key fails to compile — while `PropsOf<M>`
 * infers the props contract from the component's own signature, so it is
 * written exactly once.
 */

export type Channel = 'email' | 'sms' | 'push' | 'in_app' | 'slack' | 'survey';

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

/**
 * Template content: a component taking props (react-email and friends). Pass
 * the component, not a JSX element — that way P is inferred from the
 * component's own props signature, keeping the key, the content and every use
 * site aligned. The content system (rendering, liquid compat, i18n) is a
 * separate topic; this is a placeholder type.
 */
export type TemplateContent<P extends object> = (props: P) => unknown;

export interface TemplateFactory {
  email<P extends object = EmptyProps>(
    key: string,
    content?: TemplateContent<P>
  ): TemplateRef<'email', P>;
  sms<P extends object = EmptyProps>(
    key: string,
    content?: TemplateContent<P>
  ): TemplateRef<'sms', P>;
  push<P extends object = EmptyProps>(
    key: string,
    content?: TemplateContent<P>
  ): TemplateRef<'push', P>;
  inApp<P extends object = EmptyProps>(
    key: string,
    content?: TemplateContent<P>
  ): TemplateRef<'in_app', P>;
  slack<P extends object = EmptyProps>(
    key: string,
    content?: TemplateContent<P>
  ): TemplateRef<'slack', P>;
  survey<P extends object = EmptyProps>(
    key: string,
    content?: TemplateContent<P>
  ): TemplateRef<'survey', P>;
}

const makeTemplate =
  <C extends Channel>(channel: C) =>
  <P extends object = EmptyProps>(key: string, content?: TemplateContent<P>): TemplateRef<C, P> =>
    ({ channel, key, content }) as TemplateRef<C, P>;

/**
 * Template definition: a plain object — a template's type (its props shape) is
 * self-contained at the declaration site.
 *
 *   const welcome = template.email('onboarding_welcome');
 *   const offer = template.email('n2_offer', OfferEmail);   // P inferred from the component
 */
export const template: TemplateFactory = {
  email: makeTemplate('email'),
  sms: makeTemplate('sms'),
  push: makeTemplate('push'),
  inApp: makeTemplate('in_app'),
  slack: makeTemplate('slack'),
  survey: makeTemplate('survey'),
};

/* ----------------------------- Template registry ---------------------------- */

/** One email module: a default-exported component (plus an optional subject). */
export interface TemplateModule {
  default: (props: never) => unknown;
  subject?: unknown;
}

/** Derive template props from the component's signature — the contract is written once, on the component. */
export type PropsOf<M> = M extends { default: (props: infer P) => unknown }
  ? P extends object
    ? P
    : EmptyProps
  : EmptyProps;

export interface BoundTemplateFactory<R extends Record<string, TemplateModule>> {
  email<K extends keyof R & string>(key: K): TemplateRef<'email', PropsOf<R[K]>>;
}

/**
 * Template factory bound to a registry: **the registry types the key** — so
 * referencing an unregistered template fails to compile, while props types
 * flow in from the component signature (same pattern as the u/e tables).
 *
 *   import type { Emails } from '../emails';   // type-only: no react at runtime
 *   const t = templates<Emails>();
 *   export const welcome = t.email('welcome');
 */
export function templates<R extends Record<string, TemplateModule>>(): BoundTemplateFactory<R> {
  return { email: (key) => template.email(key) as never };
}
