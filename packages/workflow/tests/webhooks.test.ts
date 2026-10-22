import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { EnvValidationError, journeyWorker } from '../src/cloudflare/worker';
import { defineConfig } from '../src/config';
import type { OutboundMessage } from '../src/engine/ports';
import { PermanentError } from '../src/engine/retry';
import { channelsFromConfig } from '../src/host/channels';
import {
  discordTemplate,
  registryValidator,
  renderDiscordContent,
  renderSlackContent,
  slackTemplate,
} from '../src/index';
import { DiscordWebhookSender, SlackWebhookSender } from '../src/webhooks';
import { FakeJourney } from './fake-cloudflare';

/**
 * Discord and Slack: templates posting to a team channel through a webhook whose URL the
 * Worker's validated environment holds.
 */

const env = z.object({
  WEBHOOK_DISCORD_SALES: z.url(),
  WEBHOOK_SLACK_SALES: z.url(),
});
type Env = z.output<typeof env>;

const props = z.strictObject({ name: z.string(), plan: z.string() });

const churn = discordTemplate({
  id: 'churn',
  title: 'Churn risk',
  props,
  preview: { name: 'Ada', plan: 'Pro' },
  webhook: (e: Env) => e.WEBHOOK_DISCORD_SALES,
  content: ({ name, plan }) => ({
    content: `${name} may churn`,
    embeds: [{ title: plan, color: 0xef4444 }],
  }),
});

const signup = slackTemplate({
  id: 'signup',
  title: 'New signup',
  props,
  preview: { name: 'Ada', plan: 'Pro' },
  webhook: (e: Env) => e.WEBHOOK_SLACK_SALES,
  content: ({ name, plan }) => ({
    text: `${name} signed up for ${plan}`,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*${name}* · ${plan}` } }],
  }),
});

// Registered under JavaScript names of their own: messages name them by id
const registry = { discord: { churnAlert: churn }, slack: { newSignup: signup } };

const message = (channel: 'discord' | 'slack', template: string): OutboundMessage => ({
  workflow: 'w',
  instanceId: 'i1',
  nodeId: 'n1',
  channel,
  template,
  props: { name: 'Ada', plan: 'Pro' },
  userId: 'u1',
  idempotencyKey: 'i1:n1',
});

function recording(status = 204, body = '') {
  const calls: { url: string; body: unknown }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: url as string, body: JSON.parse(init?.body as string) });
    return new Response(body || null, { status });
  };
  return { calls, fetchImpl };
}

describe('webhook templates', () => {
  test('the registry is read by id; the property names are not keys', () => {
    const validator = registryValidator(registry);
    const valid = { name: 'Ada', plan: 'Pro' };
    expect(validator.validate({ channel: 'discord', template: 'churn', props: valid })).toEqual(
      valid
    );
    expect(() =>
      validator.validate({ channel: 'discord', template: 'churnAlert', props: valid })
    ).toThrow("discord template 'churnAlert' is not registered");
  });

  test('content is rendered from parsed props and checked', () => {
    expect(renderDiscordContent(churn, { name: 'Ada', plan: 'Pro' })).toEqual({
      content: 'Ada may churn',
      embeds: [{ title: 'Pro', color: 0xef4444 }],
    });
    expect(renderSlackContent(signup, { name: 'Ada', plan: 'Pro' }).text).toBe(
      'Ada signed up for Pro'
    );
    const empty = discordTemplate({
      id: 'empty',
      title: 'Empty',
      props,
      preview: { name: 'A', plan: 'B' },
      webhook: () => 'https://discord.com/api/webhooks/1/x',
      content: () => ({}),
    });
    expect(() => renderDiscordContent(empty, { name: 'A', plan: 'B' })).toThrow(
      /needs content, an embed/
    );
    expect(() =>
      registryValidator(registry).validate({ channel: 'slack', template: 'signup', props: {} })
    ).toThrow(/rejected its props/);
  });
});

describe('webhook senders', () => {
  test('channels post the rendered message to the URL the environment names', async () => {
    const { calls, fetchImpl } = recording(204);
    const sender = channelsFromConfig(
      { templates: registry },
      {
        WEBHOOK_DISCORD_SALES: 'https://discord.com/api/webhooks/1/abc',
        WEBHOOK_SLACK_SALES: 'https://hooks.slack.com/services/T/B/x',
      } as never,
      { fetch: fetchImpl }
    );
    await sender.send(message('discord', 'churn'));
    await sender.send(message('slack', 'signup'));
    expect(calls.map((c) => c.url)).toEqual([
      'https://discord.com/api/webhooks/1/abc',
      'https://hooks.slack.com/services/T/B/x',
    ]);
    expect(calls[0]?.body).toMatchObject({ content: 'Ada may churn' });
    expect(calls[1]?.body).toMatchObject({ text: 'Ada signed up for Pro' });
  });

  test('an unset webhook fails the step, naming the template', async () => {
    const sender = channelsFromConfig({ templates: registry }, {} as never);
    await expect(sender.send(message('discord', 'churn'))).rejects.toThrow(
      "discord template 'churn': its webhook URL is not set"
    );
    // The environment is the same on every attempt: not retried
    await expect(sender.send(message('discord', 'churn'))).rejects.toThrow(PermanentError);
  });

  test('a webhook that is gone settles undelivered; a rate limit throws to retry', async () => {
    const render = () => ({ url: 'https://example.com/hook', content: { content: 'x' } });
    expect(
      await new DiscordWebhookSender({
        render,
        fetch: recording(404, '{"code":10015}').fetchImpl,
      }).send(message('discord', 'churn'))
    ).toEqual({ delivered: false, reason: 'UnknownWebhook' });
    await expect(
      new DiscordWebhookSender({ render, fetch: recording(429, '{}').fetchImpl }).send(
        message('discord', 'churn')
      )
    ).rejects.toThrow('429');
    // A message Discord refuses (a 400) is settled, not retried: it holds up nothing after it
    expect(
      await new DiscordWebhookSender({
        render,
        fetch: recording(400, '{"code":50035}').fetchImpl,
      }).send(message('discord', 'churn'))
    ).toEqual({ delivered: false, reason: 'HTTP 400' });
    const slackRender = () => ({ url: 'https://example.com/hook', content: { text: 'x' } });
    expect(
      await new SlackWebhookSender({
        render: slackRender,
        fetch: recording(410, 'channel_is_archived').fetchImpl,
      }).send(message('slack', 'signup'))
    ).toEqual({ delivered: false, reason: 'channel_is_archived' });
  });
});

describe('environment schema', () => {
  test('an invalid environment fails the Worker at its first request, listing every problem', async () => {
    const worker = journeyWorker({
      config: defineConfig({ workflows: [], templates: registry }),
      env,
      // The request fails on the env, before the store is opened
      store: () => {
        throw new Error('never opened');
      },
    });
    const response = await worker.fetch(new Request('http://worker/health'), {
      JOURNEY: new FakeJourney(),
      WEBHOOK_DISCORD_SALES: 'not a url',
    } as never);
    expect(response.status).toBe(500);
    const { error } = (await response.json()) as { error: string };
    expect(error).toContain('WEBHOOK_DISCORD_SALES');
    expect(error).toContain('WEBHOOK_SLACK_SALES');
    expect(error).not.toContain('not a url');
    expect(new EnvValidationError(['A: x']).message).toContain('A: x');
  });
});
