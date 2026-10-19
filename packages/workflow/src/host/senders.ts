import type { MessageSender, OutboundMessage } from '../engine';

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
