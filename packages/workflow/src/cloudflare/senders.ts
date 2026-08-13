import type { MessageSender, OutboundMessage } from '../engine/ports';
import { fillSubject } from '../engine/subject';
import type { ScalarIR } from '../ir';

/** Cloudflare Email Service's send_email binding (structural subset). */
export interface EmailBindingLike {
  send(message: { to: string; from: string; subject: string; html: string }): Promise<unknown>;
}

/**
 * Template renderer, injected by the app — this package stays free of any
 * react-email dependency. An app-side implementation is typically a registry
 * lookup plus @react-email/render. The subject comes back as the module's raw
 * string template; the sender fills its `{prop}` placeholders from the profile.
 */
export type EmailRenderer = (
  template: string,
  props: Record<string, ScalarIR | undefined>
) => Promise<{ subject: string; html: string }>;

/** Profile access for personalization, keyed by user — the D1 fact source curried per userId. */
export type ProfileLookup = (userId: string, path: string) => Promise<ScalarIR | undefined>;

/**
 * Send straight through Cloudflare Email Service — a binding call, no outbound
 * HTTP. Throwing hands retries to the CF step; the delivery side de-duplicates
 * on idempotencyKey.
 */
export class CfEmailSender implements MessageSender {
  constructor(
    private readonly email: EmailBindingLike,
    private readonly from: string,
    private readonly render: EmailRenderer,
    /** Optional: without it, subject templates go out with placeholders emptied. */
    private readonly profile?: ProfileLookup
  ) {}

  async send(message: OutboundMessage): Promise<void> {
    if (message.channel !== 'email') {
      throw new Error(`CfEmailSender: unsupported channel '${message.channel}'`);
    }
    if (message.recipient === undefined) {
      throw new Error(`CfEmailSender: no recipient for user '${message.userId}'`);
    }
    const { subject, html } = await this.render(message.template, message.props);
    const filled = await fillSubject(subject, (path) =>
      this.profile === undefined ? Promise.resolve(undefined) : this.profile(message.userId, path)
    );
    await this.email.send({ to: message.recipient, from: this.from, subject: filled, html });
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
