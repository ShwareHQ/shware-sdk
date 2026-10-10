import type { EmailAddress } from '../config';
import type { MessageSender, OutboundMessage } from '../engine/ports';
import { fillSubject } from '../engine/subject';
import type { ScalarIR } from '../ir';
import { JourneyFactSource } from '../store/facts';
import type { JourneyStore } from '../store/index';
import type { EmailBindingLike } from './bindings';

export type { EmailAddress } from '../config';
export type { EmailBindingLike } from './bindings';

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

/** A store or a custom lookup, as one lookup. */
function profileLookup(profile: JourneyStore | ProfileLookup): ProfileLookup {
  return typeof profile === 'function'
    ? profile
    : (userId, path) => new JourneyFactSource(profile, userId).getProperty(path);
}

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
 * HTTP. Throwing hands retries to the CF step, and the message's
 * idempotencyKey travels with the call so the binding can drop the duplicate a
 * retry or replay produces.
 */
export class CfEmailSender implements MessageSender {
  private readonly profile: ProfileLookup | undefined;

  constructor(private readonly options: CfEmailOptions) {
    this.profile = options.profile === undefined ? undefined : profileLookup(options.profile);
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
      idempotencyKey: message.idempotencyKey,
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

/**
 * One push outlet per platform, chosen by the user's `push_platform` property
 * (the producer identifies it next to `push_token`): `ios` straight to APNs,
 * `android` through FCM, say. A user with a token but no platform, or a
 * platform with no sender, fails the step rather than guessing.
 */
export function routeByPlatform(
  senders: Record<string, MessageSender>,
  profile: JourneyStore | ProfileLookup,
  property = 'push_platform'
): MessageSender {
  const lookup = profileLookup(profile);
  return {
    async send(message) {
      const platform = await lookup(message.userId, property);
      if (platform === undefined) {
        throw new Error(`no ${property} identified for user '${message.userId}'`);
      }
      const key = String(platform);
      if (!Object.hasOwn(senders, key)) {
        throw new Error(`no push sender configured for platform '${key}'`);
      }
      await senders[key].send(message);
    },
  };
}
