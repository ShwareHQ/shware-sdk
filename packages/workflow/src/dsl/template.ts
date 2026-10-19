/**
 * Templates in the DSL. The four channels with template definitions (email, push, discord,
 * slack) take the definition itself — `.email(welcome, props)` — so its Zod `props` schema types
 * the call (`PropsOf`) and its `id` lands in the IR. The channels rendered by app-supplied
 * senders (sms, in-app, survey) have no definition; they take a hand-typed reference by key.
 */

import type * as core from 'zod/v4/core';
import type { DiscordTemplate, EmailTemplate, PushTemplate, SlackTemplate } from '../templates';

export type Channel = 'email' | 'sms' | 'push' | 'in_app' | 'slack' | 'discord' | 'survey';

export type EmptyProps = Record<string, never>;

/** A template by key, its props typed by hand: for the channels without template definitions. */
export interface TemplateRef<C extends Channel = Channel, P extends object = object> {
  readonly channel: C;
  readonly key: string;
  readonly __props?: P;
}

export interface TemplateFactory {
  sms<P extends object = EmptyProps>(key: string): TemplateRef<'sms', P>;
  inApp<P extends object = EmptyProps>(key: string): TemplateRef<'in_app', P>;
  survey<P extends object = EmptyProps>(key: string): TemplateRef<'survey', P>;
}

const makeTemplate =
  <C extends Channel>(channel: C) =>
  <P extends object = EmptyProps>(key: string): TemplateRef<C, P> => ({ channel, key });

/**
 * Template references for the channels an app-supplied sender renders:
 *
 *   const code = template.sms<{ code: string }>('login_code');
 */
export const template: TemplateFactory = {
  sms: makeTemplate('sms'),
  inApp: makeTemplate('in_app'),
  survey: makeTemplate('survey'),
};

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
