import type { EmailTemplate } from './templates';

/**
 * Email metadata: who a template's email comes from, where replies go, and the unsubscribe and
 * preference links its layout carries. Each `emailTemplate` declares its own `from` (and
 * `replyTo`, if replies should go elsewhere) and says what it is: a `topic` the recipient may
 * unsubscribe from, or `transactional: true`. A topic email's unsubscribe link is the template's
 * `unsubscribeUrl`, else the config's `email.unsubscribeUrl`, else none; its preferences link is
 * the config's `email.preferencesUrl` with the copy's message id, when the copy has one (reporting
 * on); a transactional email never has either, whatever the config says. `resolveEmail` is that
 * rule, and the sender, the renderer, the Worker's preview and the studio all go through it. No
 * React and no I/O here, so a browser can import it.
 */

/** An address as the transports take it: bare, or with a display name. */
export type EmailAddress = string | { email: string; name?: string };

/** `Name <email>`, or the bare address. */
export function formatEmailAddress(address: EmailAddress): string {
  if (typeof address === 'string') return address;
  return address.name === undefined ? address.email : `${address.name} <${address.email}>`;
}

const ASCII = /^[\x20-\x7e]*$/;
const SPECIALS = /[()<>[\]:;@\\,."]/;

/**
 * An address as a mail API reads it (RFC 5322): a display name with specials is quoted, one
 * outside ASCII is a MIME encoded-word — raw non-ASCII names are refused (SES), and an unquoted
 * comma splits the address in two.
 */
export function mimeAddress(address: EmailAddress): string {
  if (typeof address === 'string') return address;
  const { email, name } = address;
  if (name === undefined || name === '') return email;
  if (!ASCII.test(name)) {
    const bytes = new TextEncoder().encode(name);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `=?UTF-8?B?${btoa(binary)}?= <${email}>`;
  }
  if (SPECIALS.test(name)) return `"${name.replace(/(["\\])/g, '\\$1')}" <${email}>`;
  return `${name} <${email}>`;
}

/** The config's `email`: what every email template shares. */
export interface EmailConfig {
  /**
   * The unsubscribe link of every email template that names none of its own. The layout reads it
   * with `useEmailContext()`; sent, it is tracked like every link, but following it shows a
   * confirmation page, and only the confirmation (a POST no link scanner sends) unsubscribes.
   */
  unsubscribeUrl?: string;
  /**
   * The app's email preference page. A topic email sent with reporting on links to it with the
   * copy's message id as the `m` query parameter (`useEmailContext().preferencesUrl`), and the
   * page reads and sets the recipient's subscriptions by that id — no sign-in — through
   * `GET` / `PUT /subscriptions/by-message/:messageId` (`JourneyClient.getSubscriptionsByMessage`
   * / `setSubscriptionsByMessage`). Tracked as an ordinary link; it must not share its origin and
   * path with `unsubscribeUrl`, which would make it the unsubscribe link instead.
   */
  preferencesUrl?: string;
  /** How the Worker tells a person's opens and clicks from a machine's (see the reporting classifier). */
  tracking?: {
    /**
     * An open or click this many milliseconds after delivery is a weak machine signal — machine
     * only together with another (a second link within seconds); 1000 by default. A person
     * tapping a mail notification can click within a few seconds, so keep it short.
     */
    quickClickMs?: number;
  };
}

/** One template's email metadata, resolved against the config. */
export interface ResolvedEmail {
  from: EmailAddress;
  /** The template's subscription topic; null for a transactional email. */
  topic: string | null;
  /** Absent when the template names none: the email goes out without a Reply-To. */
  replyTo?: EmailAddress;
  /**
   * Absent when the email is transactional, or neither the template nor the config names one:
   * the email has no unsubscribe link.
   */
  unsubscribeUrl?: string;
  /**
   * The config's `preferencesUrl` with this copy's message id as `m`. Absent when the email is
   * transactional, the config names no page, or the copy has no message id (reporting off): the
   * email has no preferences link, and a layout renders none.
   */
  preferencesUrl?: string;
}

/** What a render knows of the copy beyond the template: its message id, when reporting records one. */
export interface EmailRenderOptions {
  /** The copy's id in the reporting tables — what `/t/...` and `/subscriptions/by-message` key on. */
  messageId?: string | undefined;
}

/**
 * The message id a preview renders with: the preferences link shows in the studio and
 * `GET /preview`, pointing at a copy that does not exist.
 */
export const PREVIEW_MESSAGE_ID = '00000000-0000-0000-0000-000000000000';

/**
 * The template's metadata, its `unsubscribeUrl` falling back to the config's, and the
 * preferences link built from the config's page and the copy's message id — for a topic email; a
 * transactional one resolves to neither link. Leaves the inputs untouched.
 */
export function resolveEmail(
  template: Pick<EmailTemplate, 'from' | 'replyTo' | 'unsubscribeUrl' | 'topic'>,
  config?: EmailConfig,
  options: EmailRenderOptions = {}
): ResolvedEmail {
  const topical = template.topic !== null;
  const unsubscribeUrl = topical ? (template.unsubscribeUrl ?? config?.unsubscribeUrl) : undefined;
  const preferencesUrl =
    topical && config?.preferencesUrl !== undefined && options.messageId !== undefined
      ? preferencesLink(config.preferencesUrl, options.messageId)
      : undefined;
  return {
    from: template.from,
    topic: template.topic,
    ...(template.replyTo === undefined ? {} : { replyTo: template.replyTo }),
    ...(unsubscribeUrl === undefined ? {} : { unsubscribeUrl }),
    ...(preferencesUrl === undefined ? {} : { preferencesUrl }),
  };
}

/** The preference page's URL for one copy: `m=<message id>` set on its query, the rest of it kept. */
export function preferencesLink(preferencesUrl: string, messageId: string): string {
  const url = new URL(preferencesUrl);
  url.searchParams.set('m', messageId);
  return url.toString();
}

const ADDRESS = /^[^\s@<>]+@[^\s@<>]+$/;

/** Whether `value` is a bare `user@host` address — the shape a profile's email must have to be sent to. */
export function isEmailAddress(value: string): boolean {
  return ADDRESS.test(value);
}

/** Throws naming `where` when `address` is neither `user@host` nor `{ email: 'user@host', name? }`. */
export function assertEmailAddress(address: unknown, where: string): void {
  const email =
    typeof address === 'object' && address !== null
      ? (address as { email?: unknown }).email
      : address;
  const name =
    typeof address === 'object' && address !== null
      ? (address as { name?: unknown }).name
      : undefined;
  if (typeof email !== 'string' || !ADDRESS.test(email)) {
    throw new TypeError(`${where} must be an email address or { email, name? }`);
  }
  if (name !== undefined && typeof name !== 'string') {
    throw new TypeError(`${where}.name must be a string`);
  }
}

/** Throws naming `where` unless `url` is an absolute http(s) URL; '' and null are not a way to leave it out. */
export function assertHttpUrl(url: unknown, where: string): void {
  let parsed: URL | undefined;
  try {
    parsed = typeof url === 'string' ? new URL(url) : undefined;
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
    throw new TypeError(`${where} must be an http(s) URL (leave it out for none)`);
  }
}

/** `assertHttpUrl`, under its earlier name. */
export const assertUnsubscribeUrl: typeof assertHttpUrl = assertHttpUrl;

/** The config's `email` and every registered template's metadata; throws on the first invalid value. */
export function assertEmailConfig(
  config: { email?: EmailConfig },
  templates: Iterable<EmailTemplate>
): void {
  if (Object.hasOwn(config, 'emails')) {
    throw new TypeError(
      "the config's `emails` is gone: `from` and `replyTo` are declared on each emailTemplate, " +
        'and the rest moved to `email: { unsubscribeUrl, preferencesUrl, tracking }`'
    );
  }
  const email = config.email;
  if (email !== undefined) {
    if (email.unsubscribeUrl !== undefined) {
      assertHttpUrl(email.unsubscribeUrl, 'email.unsubscribeUrl');
    }
    if (email.preferencesUrl !== undefined) {
      assertHttpUrl(email.preferencesUrl, 'email.preferencesUrl');
      // The sender tells the unsubscribe link from the others by origin and path: a preference
      // page at the same address would be tracked as the unsubscribe link and land on `/t/u`
      if (isUnsubscribeLink(email.preferencesUrl, email.unsubscribeUrl)) {
        throw new TypeError(
          'email.preferencesUrl must not share its origin and path with email.unsubscribeUrl: ' +
            'the sender would track the preferences link as the unsubscribe link'
        );
      }
    }
    const quick = email.tracking?.quickClickMs;
    if (
      quick !== undefined &&
      !(typeof quick === 'number' && Number.isFinite(quick) && quick >= 0)
    ) {
      throw new TypeError('email.tracking.quickClickMs must be a non-negative number');
    }
  }
  for (const template of templates) {
    const where = `email template '${template.id}'`;
    assertEmailMetadata(template, where, true);
    if (
      email?.preferencesUrl !== undefined &&
      isUnsubscribeLink(email.preferencesUrl, template.unsubscribeUrl)
    ) {
      throw new TypeError(
        `${where}: its unsubscribeUrl shares its origin and path with email.preferencesUrl, so ` +
          'the sender would track the preferences link as the unsubscribe link'
      );
    }
  }
}

/**
 * A template's own `from` / `replyTo` / `unsubscribeUrl` and what it is (`topic` or
 * `transactional: true`), as `emailTemplate` checks them — and `compileConfig` again, for a
 * definition that did not come through `emailTemplate`. A declared template carries `topic`
 * (a string, or null for transactional); a definition carries one of the two options.
 */
export function assertEmailMetadata(
  template: {
    from?: unknown;
    replyTo?: unknown;
    unsubscribeUrl?: unknown;
    topic?: unknown;
    transactional?: unknown;
  },
  where: string,
  /** True for a declared template (`topic: string | null`), false for `emailTemplate`'s argument. */
  declared = false
): void {
  assertEmailAddress(template.from, `${where}: from`);
  if (template.replyTo !== undefined) assertEmailAddress(template.replyTo, `${where}: replyTo`);
  if (template.unsubscribeUrl !== undefined) {
    assertHttpUrl(template.unsubscribeUrl, `${where}: unsubscribeUrl`);
  }
  const transactional = assertTemplateTopic(template, where, 'email', declared);
  if (transactional && template.unsubscribeUrl !== undefined) {
    throw new TypeError(
      `${where}: a transactional email has no unsubscribe link, so it takes no 'unsubscribeUrl'`
    );
  }
}

/**
 * What a template is — `topic: <id>` or `transactional: true`, one of the two — as `emailTemplate`
 * and `pushTemplate` check their argument and `compileConfig` checks a declared template (where
 * `topic: null` is transactional). Answers whether the template is transactional. Whether the
 * topic is one the contract declares is `compileConfig`'s check, where the contract is at hand.
 */
export function assertTemplateTopic(
  template: { topic?: unknown; transactional?: unknown },
  where: string,
  channel: 'email' | 'push',
  declared = false
): boolean {
  const { topic } = template;
  // A declared template says `topic: null` for transactional; a definition says `transactional: true`
  const transactional = template.transactional === true || (declared && topic === null);
  if (template.transactional !== undefined && template.transactional !== true) {
    throw new TypeError(
      `${where}: 'transactional' must be the literal true (leave it out for a topic ${channel})`
    );
  }
  const hasTopic = topic !== undefined && topic !== null;
  if (hasTopic && (typeof topic !== 'string' || topic.trim() === '')) {
    throw new TypeError(`${where}: 'topic' must be a topic id the contract declares`);
  }
  if (hasTopic && transactional) {
    throw new TypeError(`${where}: give either 'topic' or 'transactional: true', not both`);
  }
  if (!hasTopic && !transactional) {
    throw new TypeError(
      `${where}: every ${channel} template says what it is — 'topic: <id>' (one the contract's subscriptions.topics declares) or 'transactional: true'`
    );
  }
  return transactional;
}

/** The unsubscribe link may carry its own query (a token, a list): the path names it. */
export function isUnsubscribeLink(url: string, unsubscribeUrl: string | undefined): boolean {
  if (unsubscribeUrl === undefined) return false;
  try {
    const a = new URL(url);
    const b = new URL(unsubscribeUrl);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return false;
  }
}
