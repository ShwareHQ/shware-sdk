import type { MessageSender, OutboundMessage } from '../engine/ports';
import { fillSubject } from '../engine/subject';
import type { ScalarIR } from '../ir';
import { JourneyFactSource } from '../store/facts';
import type { JourneyStore } from '../store/index';

/** An address as Cloudflare Email Sending takes it: bare, or with a display name. */
export type EmailAddress = string | { email: string; name?: string };

/** Cloudflare Email Service's send_email binding (the structural subset used). */
export interface EmailBindingLike {
  send(message: {
    from: EmailAddress;
    to: EmailAddress;
    replyTo?: EmailAddress;
    subject: string;
    html: string;
  }): Promise<unknown>;
}

/**
 * Template renderer, injected by the app — this package's core stays free of
 * any react-email dependency (`@shware/workflow/react-email` ships one over a
 * registry). The subject comes back as the module's raw string template; the
 * sender fills its `{{ user.x }}` placeholders from the profile.
 */
export type EmailRenderer = (
  template: string,
  props: Record<string, ScalarIR | undefined>
) => Promise<{ subject: string; html: string }>;

/** Profile access for personalization, keyed by user. */
export type ProfileLookup = (userId: string, path: string) => Promise<ScalarIR | undefined>;

export interface CfEmailOptions {
  /** The Worker's `send_email` binding. */
  binding: EmailBindingLike;
  from: EmailAddress;
  replyTo?: EmailAddress;
  render: EmailRenderer;
  /**
   * Where `{{ user.x }}` subject placeholders are filled from: the journey
   * store, or a custom lookup. Without it, placeholders render empty.
   */
  profile?: JourneyStore | ProfileLookup;
}

/**
 * Send straight through Cloudflare Email Service — a binding call, no outbound
 * HTTP. Throwing hands retries to the CF step; the delivery side de-duplicates
 * on idempotencyKey.
 */
export class CfEmailSender implements MessageSender {
  private readonly profile: ProfileLookup | undefined;

  constructor(private readonly options: CfEmailOptions) {
    const { profile } = options;
    this.profile =
      profile === undefined
        ? undefined
        : typeof profile === 'function'
          ? profile
          : (userId, path) => new JourneyFactSource(profile, userId).getProperty(path);
  }

  async send(message: OutboundMessage): Promise<void> {
    if (message.channel !== 'email') {
      throw new Error(`CfEmailSender: unsupported channel '${message.channel}'`);
    }
    if (message.recipient === undefined) {
      throw new Error(`CfEmailSender: no recipient for user '${message.userId}'`);
    }
    const { subject, html } = await this.options.render(message.template, message.props);
    const filled = await fillSubject(subject, (path) =>
      this.profile === undefined ? Promise.resolve(undefined) : this.profile(message.userId, path)
    );
    await this.options.binding.send({
      from: this.options.from,
      to: message.recipient,
      ...(this.options.replyTo === undefined ? {} : { replyTo: this.options.replyTo }),
      subject: filled,
      html,
    });
  }
}

/** Development sender: structured logs, for eyeballing the pipeline. */
export class LogMessageSender implements MessageSender {
  async send(message: OutboundMessage): Promise<void> {
    console.log(`[send] ${JSON.stringify(message)}`);
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
      await sender.send(message);
    },
  };
}
