import type { MessageSender, OutboundMessage, SendResult } from './engine';
import { awaitAnswer } from './engine/retry';
import type { DiscordContent, SlackContent } from './templates';

/**
 * `@shware/workflow/webhooks` — messages posted to a team channel through an incoming webhook:
 * Discord (`discord-api-types` bodies) and Slack (Block Kit). Plain fetch, no SDKs. A template
 * names its webhook through the Worker's environment (`webhook: (env) => env.WEBHOOK_DISCORD_…`), so the
 * renderer hands the sender both the URL and the message.
 *
 * A request the channel refuses for good — the webhook deleted, the channel archived, a message
 * Discord or Slack rejects (4xx) — settles the copy undelivered instead of retrying into it, so a
 * team-channel post never holds up the customer messages after it. Rate limits (429), timeouts
 * (408) and server errors throw, and the step retries. A post that got no answer at all throws
 * an `UnansweredSendError`: it may have been posted, and is not posted again.
 */

/** A 4xx that retrying cannot fix. */
const permanent = (status: number) =>
  status >= 400 && status < 500 && status !== 408 && status !== 429;

export interface WebhookMessage<C> {
  url: string;
  content: C;
}

export interface WebhookSenderOptions<C> {
  render: (
    template: string,
    props: OutboundMessage['props']
  ) => Promise<WebhookMessage<C>> | WebhookMessage<C>;
  /** Fetch implementation (defaults to the global one). */
  fetch?: typeof fetch;
}

async function post(
  doFetch: typeof fetch,
  url: string,
  body: unknown
): Promise<{ status: number; text: string }> {
  // Neither Discord nor Slack de-duplicates a webhook post: one they never answered is not
  // posted again (see deliver)
  const response = await awaitAnswer('webhook post', () =>
    doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
  // The status is the answer; a refusal whose body cannot be read is still a refusal
  return {
    status: response.status,
    text: response.ok ? '' : await response.text().catch(() => ''),
  };
}

function requireChannel(message: OutboundMessage, channel: 'discord' | 'slack') {
  if (message.channel !== channel) {
    throw new Error(`${channel} webhook sender: unsupported channel '${message.channel}'`);
  }
}

export class DiscordWebhookSender implements MessageSender {
  constructor(private readonly options: WebhookSenderOptions<DiscordContent>) {}

  async send(message: OutboundMessage): Promise<void | SendResult> {
    requireChannel(message, 'discord');
    const { url, content } = await this.options.render(message.template, message.props);
    const { status, text } = await post(this.options.fetch ?? fetch, url, content);
    if (status >= 200 && status < 300) return;
    // 10015 Unknown Webhook: deleted, or its channel is gone — it will never deliver again
    if (status === 404 || status === 401) {
      console.warn(`[discord] webhook gone for template ${message.template}: ${status} ${text}`);
      return { delivered: false, reason: 'UnknownWebhook' };
    }
    if (permanent(status)) {
      console.warn(`[discord] refused ${message.template}: ${status} ${text}`);
      return { delivered: false, reason: `HTTP ${status}` };
    }
    throw new Error(`[discord] ${status}: ${text}`);
  }
}

/** Slack's answers for a webhook that will never deliver again. */
const SLACK_GONE = new Set([
  'no_service',
  'channel_not_found',
  'channel_is_archived',
  'action_prohibited',
]);

export class SlackWebhookSender implements MessageSender {
  constructor(private readonly options: WebhookSenderOptions<SlackContent>) {}

  async send(message: OutboundMessage): Promise<void | SendResult> {
    requireChannel(message, 'slack');
    const { url, content } = await this.options.render(message.template, message.props);
    const { status, text } = await post(this.options.fetch ?? fetch, url, content);
    if (status >= 200 && status < 300) return;
    const reason = text.trim();
    if (SLACK_GONE.has(reason)) {
      console.warn(`[slack] webhook gone for template ${message.template}: ${reason}`);
      return { delivered: false, reason };
    }
    if (permanent(status)) {
      console.warn(`[slack] refused ${message.template}: ${status} ${reason}`);
      return { delivered: false, reason: reason || `HTTP ${status}` };
    }
    throw new Error(`[slack] ${status}: ${reason}`);
  }
}
