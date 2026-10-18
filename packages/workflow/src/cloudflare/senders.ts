import { type ResolvedEmail, isUnsubscribeLink } from '../email';
import type { MessageSender, MessageTracking, OutboundMessage } from '../engine';
import type { ScalarIR } from '../ir';
import type { EmailBindingLike } from './bindings';

export type { EmailAddress } from '../email';
export type { EmailBindingLike } from './bindings';

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

export interface CfEmailOptions {
  /** The Worker's `send_email` binding. */
  binding: EmailBindingLike;
  render: EmailRenderer;
}

/**
 * Send straight through Cloudflare Email Service — a binding call, no outbound
 * HTTP. Throwing hands retries to the CF step, and the message's
 * idempotencyKey travels with the call so the binding can drop the duplicate a
 * retry or replay produces.
 */
export class CfEmailSender implements MessageSender {
  constructor(private readonly options: CfEmailOptions) {}

  async send(message: OutboundMessage): Promise<void> {
    if (message.channel !== 'email') {
      throw new Error(`CfEmailSender: unsupported channel '${message.channel}'`);
    }
    if (message.recipient === undefined) {
      throw new Error(`CfEmailSender: no recipient for user '${message.userId}'`);
    }
    const { subject, html, from, replyTo, unsubscribeUrl } = await this.options.render(
      message.template,
      message.props
    );
    const tracked =
      message.tracking === undefined ? html : trackEmail(html, message.tracking, unsubscribeUrl);
    // The tracked links resolve before the email exists anywhere a scanner could follow them
    await message.tracking?.commit?.();
    await this.options.binding.send({
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

/** Development sender: structured logs, for eyeballing the pipeline. */
export class LogMessageSender implements MessageSender {
  async send(message: OutboundMessage): Promise<void> {
    const { tracking: _tracking, ...logged } = message;
    console.log(`[send] ${JSON.stringify(logged)}`);
  }
}

/**
 * Webhook sender: POST to an external delivery service (a Resend/SES gateway,
 * say). The idempotency key travels with it, so the receiver de-duplicates
 * retries and replays on idempotencyKey.
 */
export class WebhookMessageSender implements MessageSender {
  constructor(private readonly url: string) {}

  async send(message: OutboundMessage): Promise<void> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': message.idempotencyKey,
      },
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      throw new Error(`message webhook failed: ${response.status}`);
    }
  }
}

/**
 * One sender per channel: the runner has a single outlet, this fans it out.
 * A channel without a sender fails the send (a misconfiguration, not a retry).
 */
export function routeByChannel(
  senders: Partial<Record<OutboundMessage['channel'], MessageSender>>
): MessageSender {
  return {
    async send(message) {
      const sender = senders[message.channel];
      if (sender === undefined) {
        throw new Error(`no sender configured for channel '${message.channel}'`);
      }
      return sender.send(message);
    },
  };
}

/**
 * One push outlet per platform, chosen by the device each copy goes to (the
 * engine sends one message per device, and the host's directory says which
 * platform a token belongs to): `ios` straight to APNs, `android` through FCM,
 * say. A platform with no sender fails the step rather than guessing.
 */
export function routeByPlatform(senders: Record<string, MessageSender>): MessageSender {
  return {
    async send(message) {
      const platform = message.device?.platform;
      if (platform === undefined) {
        throw new Error(`push for user '${message.userId}' carries no device`);
      }
      if (!Object.hasOwn(senders, platform)) {
        throw new Error(`no push sender configured for platform '${platform}'`);
      }
      return senders[platform].send(message);
    },
  };
}
