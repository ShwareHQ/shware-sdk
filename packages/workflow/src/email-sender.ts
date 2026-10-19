import { type EmailAddress, type ResolvedEmail, isUnsubscribeLink } from './email';
import type { MessageSender, MessageTracking, OutboundMessage } from './engine/ports';
import type { ScalarIR } from './ir';

/**
 * The email channel, split where the runtime stops mattering: `EmailSender` renders a copy,
 * applies its tracking and commits the tracked links — the same on every host — and hands the
 * finished email to an `EmailTransport`, the only part that knows a provider (SES, Cloudflare
 * Email, ...). Nothing here imports a platform module, so a Worker and a Lambda share it.
 */

/** A rendered email: the template's resolved metadata (`resolveEmail`), its subject and its HTML. */
export interface RenderedEmail extends ResolvedEmail {
  subject: string;
  html: string;
}

/**
 * Template renderer, injected by the app — this package's core stays free of
 * any react-email dependency (`@shware/workflow/react-email` ships one over a
 * registry). The subject comes back final: it is sent exactly as written, from
 * the template's own sender, and the unsubscribe link is the one the HTML was
 * rendered with.
 */
export type EmailRenderer = (
  template: string,
  props: Record<string, ScalarIR | undefined>
) => Promise<RenderedEmail>;

/** A finished email, as a transport takes it: rendered, tracked, addressed. */
export interface EmailMessage {
  from: EmailAddress;
  to: string;
  replyTo?: EmailAddress;
  subject: string;
  html: string;
  /**
   * `${instanceId}:${nodeId}`: the copy's identity, stable across retries and replays. A provider
   * that de-duplicates on a key receives it; one that cannot (SES) still sends at least once —
   * the window between the provider accepting the email and the step's checkpoint stays open.
   */
  idempotencyKey: string;
}

/**
 * One email provider. Throwing hands the retry to the durable step; resolving means the provider
 * accepted the email (not that it was delivered).
 */
export interface EmailTransport {
  send(message: EmailMessage): Promise<{ providerMessageId?: string }>;
}

export interface EmailSenderOptions {
  transport: EmailTransport;
  render: EmailRenderer;
}

/**
 * The email channel over any transport: render → tracking applied to the HTML → the tracked
 * links committed → the transport. The links resolve before the email exists anywhere a
 * scanner could follow them.
 */
export class EmailSender implements MessageSender {
  constructor(private readonly options: EmailSenderOptions) {}

  async send(message: OutboundMessage): Promise<void> {
    if (message.channel !== 'email') {
      throw new Error(`EmailSender: unsupported channel '${message.channel}'`);
    }
    if (message.recipient === undefined) {
      throw new Error(`EmailSender: no recipient for user '${message.userId}'`);
    }
    const { subject, html, from, replyTo, unsubscribeUrl } = await this.options.render(
      message.template,
      message.props
    );
    const tracked =
      message.tracking === undefined ? html : trackEmail(html, message.tracking, unsubscribeUrl);
    await message.tracking?.commit?.();
    await this.options.transport.send({
      from,
      to: message.recipient,
      ...(replyTo === undefined ? {} : { replyTo }),
      subject,
      html: tracked,
      idempotencyKey: message.idempotencyKey,
    });
  }
}

const LINK = /(<a\b[^>]*?\shref\s*=\s*)(["'])(https?:\/\/[^"']+)\2/gi;

/**
 * An email's tracking applied to its rendered HTML: every `http(s)` anchor routed through
 * `link` (the original URL decoded from its attribute escaping, the tracking URL escaped back) —
 * as the unsubscribe link when it is the one the email was rendered with, so what a click on it
 * means is fixed when the email is sent — and the open pixel appended before `</body>`, or at the
 * end when there is none.
 */
export function trackEmail(
  html: string,
  tracking: MessageTracking,
  unsubscribeUrl?: string
): string {
  const { link, pixel } = tracking;
  let out = html;
  if (link !== undefined) {
    out = out.replace(LINK, (_, start: string, quote: string, attribute: string) => {
      const url = unescapeAttribute(attribute);
      const purpose = isUnsubscribeLink(url, unsubscribeUrl) ? 'unsubscribe' : 'link';
      return `${start}${quote}${escapeAttribute(link(url, purpose))}${quote}`;
    });
  }
  if (pixel !== undefined) {
    const image = `<img src="${escapeAttribute(pixel)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px" />`;
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${image}</body>`) : `${out}${image}`;
  }
  return out;
}

function unescapeAttribute(value: string): string {
  return value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#x27;', "'");
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}
