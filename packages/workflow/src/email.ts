import type { EmailAddress, EmailConfig } from './template-rules';
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
