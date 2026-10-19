import type { EmailTemplate } from './templates';

/**
 * Email metadata: who a template's email comes from, where replies go, and the unsubscribe link
 * its layout carries. Each `emailTemplate` declares its own `from` (and `replyTo`, if replies should
 * go elsewhere); the unsubscribe link is the template's `unsubscribeUrl`, else the config's
 * `email.unsubscribeUrl`, else none. `resolveEmail` is that rule, and the sender, the renderer,
 * the Worker's preview and the studio all go through it. No React and no I/O here, so a browser
 * can import it.
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
  /** Absent when the template names none: the email goes out without a Reply-To. */
  replyTo?: EmailAddress;
  /** Absent when neither the template nor the config names one: the email has no unsubscribe link. */
  unsubscribeUrl?: string;
}

/** The template's metadata, its `unsubscribeUrl` falling back to the config's. Leaves both untouched. */
export function resolveEmail(
  template: Pick<EmailTemplate, 'from' | 'replyTo' | 'unsubscribeUrl'>,
  config?: EmailConfig
): ResolvedEmail {
  const unsubscribeUrl = template.unsubscribeUrl ?? config?.unsubscribeUrl;
  return {
    from: template.from,
    ...(template.replyTo === undefined ? {} : { replyTo: template.replyTo }),
    ...(unsubscribeUrl === undefined ? {} : { unsubscribeUrl }),
  };
}

const ADDRESS = /^[^\s@<>]+@[^\s@<>]+$/;

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
export function assertUnsubscribeUrl(url: unknown, where: string): void {
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

/** The config's `email` and every registered template's metadata; throws on the first invalid value. */
export function assertEmailConfig(
  config: { email?: EmailConfig },
  templates: Iterable<EmailTemplate>
): void {
  if (Object.hasOwn(config, 'emails')) {
    throw new TypeError(
      "the config's `emails` is gone: `from` and `replyTo` are declared on each emailTemplate, " +
        'and the rest moved to `email: { unsubscribeUrl, tracking }`'
    );
  }
  const email = config.email;
  if (email !== undefined) {
    if (email.unsubscribeUrl !== undefined) {
      assertUnsubscribeUrl(email.unsubscribeUrl, 'email.unsubscribeUrl');
    }
    const quick = email.tracking?.quickClickMs;
    if (
      quick !== undefined &&
      !(typeof quick === 'number' && Number.isFinite(quick) && quick >= 0)
    ) {
      throw new TypeError('email.tracking.quickClickMs must be a non-negative number');
    }
  }
  for (const template of templates)
    assertEmailMetadata(template, `email template '${template.id}'`);
}

/** A template's own `from` / `replyTo` / `unsubscribeUrl`, as `emailTemplate` checks them. */
export function assertEmailMetadata(
  template: { from?: unknown; replyTo?: unknown; unsubscribeUrl?: unknown },
  where: string
): void {
  assertEmailAddress(template.from, `${where}: from`);
  if (template.replyTo !== undefined) assertEmailAddress(template.replyTo, `${where}: replyTo`);
  if (template.unsubscribeUrl !== undefined) {
    assertUnsubscribeUrl(template.unsubscribeUrl, `${where}: unsubscribeUrl`);
  }
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
