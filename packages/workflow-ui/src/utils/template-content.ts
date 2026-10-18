import {
  type DiscordContent,
  type DiscordTemplate,
  type EmailTemplate,
  type PushContent,
  type PushTemplate,
  type SlackContent,
  type SlackTemplate,
  type TemplateIssue,
  TemplateValidationError,
  parseTemplateProps,
  renderDiscordContent,
  renderPushContent,
  renderSlackContent,
} from '@shware/workflow';
import type { ComponentType } from 'react';
import type { ResolvedStudioConfig } from '../config';
import { lookup } from './lookup';

/**
 * What the studio reads out of a template definition.
 *
 * Every registry entry is an `emailTemplate({...})` / `pushTemplate({...})`
 * (the dev server refuses anything else). Previews are validated with the
 * SDK's own functions (parseTemplateProps, renderPushContent), the same ones
 * the senders run, so the studio cannot accept props a send would refuse;
 * everything downstream reads the parsed value.
 */

export type Props = Record<string, unknown>;

/**
 * A failed render: which phase refused, and every field path with its message.
 * `json` is the studio's own: the props editor holds text that is not a JSON
 * object, so nothing was validated at all.
 */
export interface TemplateFailure {
  phase: 'json' | 'props' | 'content' | 'render';
  issues: TemplateIssue[];
}

/** The channels with a template registry; every other channel's messages have no preview. */
export type TemplateChannel = 'email' | 'push' | 'discord' | 'slack';

export function isTemplateChannel(channel: string): channel is TemplateChannel {
  return channel === 'email' || channel === 'push' || channel === 'discord' || channel === 'slack';
}

/** One registry entry, read from the registry its channel owns — a push key never resolves to an email. */
export type TemplateEntry =
  | { channel: 'email'; entry: EmailTemplate }
  | { channel: 'push'; entry: PushTemplate }
  | { channel: 'discord'; entry: DiscordTemplate }
  | { channel: 'slack'; entry: SlackTemplate };

export function lookupTemplate(
  config: Partial<Pick<ResolvedStudioConfig, 'emails' | 'pushes' | 'discords' | 'slacks'>>,
  channel: string,
  key: string
): TemplateEntry | undefined {
  const found = <T>(registry: Record<string, T> | undefined) =>
    registry === undefined ? undefined : lookup(registry, key);
  switch (channel) {
    case 'email': {
      const entry = found(config.emails);
      return entry === undefined ? undefined : { channel, entry };
    }
    case 'push': {
      const entry = found(config.pushes);
      return entry === undefined ? undefined : { channel, entry };
    }
    case 'discord': {
      const entry = found(config.discords);
      return entry === undefined ? undefined : { channel, entry };
    }
    case 'slack': {
      const entry = found(config.slacks);
      return entry === undefined ? undefined : { channel, entry };
    }
    default:
      return undefined;
  }
}

/** The sample props the studio renders with: the template's `preview`. */
export function previewPropsOf(entry: TemplateEntry['entry']): Props {
  return { ...entry.preview };
}

/** One line per issue, `path message`, for surfaces too small for a list. */
export function formatIssues(failure: TemplateFailure): string {
  return failure.issues
    .map((issue) => (issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`))
    .join('\n');
}

function failureOf(error: unknown, phase: TemplateFailure['phase']): TemplateFailure {
  if (error instanceof TemplateValidationError) return { phase: error.phase, issues: error.issues };
  return {
    phase,
    issues: [{ path: '', message: error instanceof Error ? error.message : String(error) }],
  };
}

/* ---------------------------------- Email ---------------------------------- */

/** What the renderer needs: a component and the parsed props to give it, plus the subject. */
export interface PreparedEmail {
  component: ComponentType<Props>;
  props: Props;
  subject: string;
}

export type EmailPreparation =
  | { ok: true; email: PreparedEmail }
  | { ok: false; failure: TemplateFailure };

/**
 * Parse the props a preview renders with against the template's schema, and
 * hand the component the parsed value — or refuse, with the field paths, and
 * render nothing.
 */
export function prepareEmail(entry: EmailTemplate, props?: Props): EmailPreparation {
  try {
    const parsed = parseTemplateProps(entry, props ?? previewPropsOf(entry));
    return {
      ok: true,
      email: {
        component: entry.component as ComponentType<Props>,
        props: parsed,
        subject: entry.subject,
      },
    };
  } catch (error) {
    return { ok: false, failure: failureOf(error, 'props') };
  }
}

/** A render that threw (the component itself failed), as a failure the page can show. */
export function renderFailure(error: unknown): TemplateFailure {
  return failureOf(error, 'render');
}

/* ----------------------------------- Push ---------------------------------- */

export type PushResolution =
  | { ok: true; push: PushContent }
  | { ok: false; failure: TemplateFailure };

/**
 * The notification a push template produces for some props: its `content`
 * over the parsed props, through the SDK (output checked, nothing
 * placeholder-filled afterwards).
 */
export function resolvePush(entry: PushTemplate, props?: Props): PushResolution {
  try {
    return { ok: true, push: renderPushContent(entry, props ?? previewPropsOf(entry)) };
  } catch (error) {
    return { ok: false, failure: failureOf(error, 'content') };
  }
}

/* -------------------------------- Webhooks --------------------------------- */

export type DiscordResolution =
  | { ok: true; message: DiscordContent }
  | { ok: false; failure: TemplateFailure };

export type SlackResolution =
  | { ok: true; message: SlackContent }
  | { ok: false; failure: TemplateFailure };

/** The Discord message a template posts for some props, checked like a send checks it. */
export function resolveDiscord(entry: DiscordTemplate, props?: Props): DiscordResolution {
  try {
    return { ok: true, message: renderDiscordContent(entry, props ?? previewPropsOf(entry)) };
  } catch (error) {
    return { ok: false, failure: failureOf(error, 'content') };
  }
}

/** The Slack message a template posts for some props, checked like a send checks it. */
export function resolveSlack(entry: SlackTemplate, props?: Props): SlackResolution {
  try {
    return { ok: true, message: renderSlackContent(entry, props ?? previewPropsOf(entry)) };
  } catch (error) {
    return { ok: false, failure: failureOf(error, 'content') };
  }
}

/* -------------------------------- Identity --------------------------------- */

const identities = new WeakMap<object, number>();
let nextIdentity = 0;

/**
 * A number per entry object, for query keys. HMR re-imports a template module
 * as a new object, so a changed component, content or schema gets a new key —
 * and a fresh render, never the cached one from before the edit.
 */
export function entryIdentity(entry: object | undefined): number | undefined {
  if (entry === undefined) return undefined;
  let id = identities.get(entry);
  if (id === undefined) {
    id = nextIdentity++;
    identities.set(entry, id);
  }
  return id;
}
