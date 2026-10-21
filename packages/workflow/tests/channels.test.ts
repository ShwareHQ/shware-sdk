import { webcrypto } from 'node:crypto';
import { createElement } from 'react';
import { beforeAll, describe, expect, test } from 'vitest';
import { z } from 'zod';
import type { EmailBindingLike } from '../src/cloudflare/bindings';
import type { OutboundMessage } from '../src/engine/ports';
import { PermanentError } from '../src/engine/retry';
import { type ChannelsConfig, channelsFromConfig } from '../src/host/channels';
import { D1JourneyStore } from '../src/store/d1';
import { emailTemplate, pushTemplate } from '../src/templates';
import { cloudflareEmailTransport } from '../src/transports/cloudflare-email';
import { FakeD1, FakeJourney } from './fake-cloudflare';

/**
 * channelsFromConfig: the outlets a workflow.config.ts describes, assembled
 * against the environment — email through the host's transport, iOS to APNs with the
 * configured key, Android through FCM — and clear failures for what is not
 * configured.
 */

let p8Base64: string;
beforeAll(async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ]);
  const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)).toString(
    'base64'
  );
  p8Base64 = Buffer.from(
    `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----\n`
  ).toString('base64');
});

const named = z.strictObject({ name: z.string() });
const emails = {
  welcome: emailTemplate({
    id: 'welcome',
    from: { email: 'hi@acme.test', name: 'Acme' },
    title: 'Welcome',
    props: named,
    subject: 'Welcome aboard',
    preview: { name: 'A' },
    component: ({ name }) => createElement('p', null, `hi ${name}`),
  }),
  digest: emailTemplate({
    id: 'digest',
    from: 'digest@acme.test',
    replyTo: 'help@acme.test',
    title: 'Digest',
    props: named,
    subject: 'Your week',
    preview: { name: 'A' },
    component: ({ name }) => createElement('p', null, `week of ${name}`),
  }),
};
const pushes = {
  nudge: pushTemplate({
    id: 'nudge',
    title: 'Nudge',
    props: named,
    preview: { name: 'A' },
    content: ({ name }) => ({ title: `Hi ${name}`, body: 'come back' }),
  }),
};
const templates = { email: emails, push: pushes };

function setup(gone = false) {
  const sent: {
    to: unknown;
    from: unknown;
    replyTo?: unknown;
    subject: string;
    idempotencyKey: string;
  }[] = [];
  const binding: EmailBindingLike = {
    async send(message) {
      sent.push({
        to: message.to,
        from: message.from,
        ...('replyTo' in message ? { replyTo: message.replyTo } : {}),
        subject: message.subject,
        idempotencyKey: message.idempotencyKey,
      });
    },
  };
  const fetched: { url: string; auth: string | null }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    fetched.push({ url: href, auth: new Headers(init?.headers).get('authorization') });
    if (href.endsWith('/token')) {
      return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), {
        status: 200,
      });
    }
    if (gone) return new Response(JSON.stringify({ reason: 'Unregistered' }), { status: 410 });
    return new Response(null, { status: 200 });
  };
  const env = {
    JOURNEY: new FakeJourney(),
    EMAIL: binding,
    ENVIRONMENT: 'development',
    APNS_PRIVATE_KEY_BASE64: p8Base64,
    APNS_RELAY_ORIGIN: 'http://localhost:8341',
  };
  return { env, sent, fetched, fetchImpl };
}

const message = (
  channel: 'email' | 'push',
  recipient: string,
  platform: 'ios' | 'android' = 'ios'
): OutboundMessage => ({
  workflow: 'w',
  instanceId: 'inst',
  nodeId: '0',
  channel,
  template: channel === 'email' ? 'welcome' : 'nudge',
  props: { name: 'Ada' },
  userId: 'u1',
  recipient,
  ...(channel === 'push' ? { device: { token: recipient, platform } } : {}),
  idempotencyKey: 'inst:1',
});

describe('channelsFromConfig', () => {
  test("email goes through the binding from each template's own sender; the subject as written", async () => {
    const { env, sent } = setup();
    // No `email` config at all: every template names its sender
    const sender = channelsFromConfig({ templates }, env, {
      email: cloudflareEmailTransport({ binding: env.EMAIL }),
    });
    await sender.send(message('email', 'ada@example.com'));
    await sender.send({ ...message('email', 'ada@example.com'), template: 'digest' });
    await sender.send(message('email', 'bob@example.com'));
    expect(sent).toEqual([
      {
        to: 'ada@example.com',
        from: { email: 'hi@acme.test', name: 'Acme' },
        subject: 'Welcome aboard',
        idempotencyKey: 'inst:1',
      },
      {
        to: 'ada@example.com',
        from: 'digest@acme.test',
        replyTo: 'help@acme.test',
        subject: 'Your week',
        idempotencyKey: 'inst:1',
      },
      // Not the previous template's sender, and still no Reply-To
      {
        to: 'bob@example.com',
        from: { email: 'hi@acme.test', name: 'Acme' },
        subject: 'Welcome aboard',
        idempotencyKey: 'inst:1',
      },
    ]);
  });

  test('an iOS push goes to APNs through the dev relay, in the sandbox for development', async () => {
    const { env, fetched, fetchImpl } = setup();
    const sender = channelsFromConfig(
      { templates, apns: { topic: 'io.acme.app', keyId: 'KEY1234567', teamId: 'TEAM123456' } },
      env,
      { fetch: fetchImpl }
    );
    await sender.send(message('push', 'devicetoken'));
    expect(fetched).toEqual([
      {
        url: 'http://localhost:8341/3/device/devicetoken',
        auth: expect.stringMatching(/^bearer /),
      },
    ]);
  });

  test('an Android push goes through FCM with the service account', async () => {
    const { env, fetched, fetchImpl } = setup();
    const serviceAccount = Buffer.from(
      JSON.stringify({
        project_id: 'acme',
        client_email: 'sa@acme.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----\n',
      })
    ).toString('base64');
    const sender = channelsFromConfig(
      { templates, fcm: { androidChannelId: 'default' } },
      { ...env, GOOGLE_APPLICATION_CREDENTIALS_BASE64: serviceAccount },
      { fetch: fetchImpl }
    );
    // The fake key cannot sign, so the token exchange is where this stops — past routing and setup.
    await expect(sender.send(message('push', 'fcmtoken', 'android'))).rejects.toThrow(Error);
    expect(fetched).toEqual([]);
  });

  test('a channel the config leaves out fails the step with the reason, for good', async () => {
    const { env } = setup();
    const noPush: ChannelsConfig = { templates: { email: emails } };
    await expect(channelsFromConfig(noPush, env).send(message('push', 'tok'))).rejects.toThrow(
      /no push templates are registered/
    );
    // The configuration is the same on every attempt: not retried
    await expect(channelsFromConfig(noPush, env).send(message('push', 'tok'))).rejects.toThrow(
      PermanentError
    );
    const noEmail: ChannelsConfig = {
      templates: { push: pushes },
      apns: { topic: 't', keyId: 'k', teamId: 't' },
    };
    await expect(channelsFromConfig(noEmail, env).send(message('email', 'a@b.c'))).rejects.toThrow(
      /no email templates are registered/
    );
    await expect(
      channelsFromConfig({ templates }, env).send(message('email', 'a@b.c'))
    ).rejects.toThrow(/no email transport is configured/);
    await expect(
      channelsFromConfig({ templates }, env).send(message('push', 'tok'))
    ).rejects.toThrow(/none of apns, fcm or webPush/);
  });

  test('a configured channel without its secret fails its first send, naming the variable', async () => {
    const { env, sent } = setup();
    const sender = channelsFromConfig(
      {
        templates,
        apns: { topic: 't', keyId: 'k', teamId: 't' },
      },
      { ...env, APNS_PRIVATE_KEY_BASE64: undefined },
      { email: cloudflareEmailTransport({ binding: env.EMAIL }) }
    );
    // An email-only journey is not held hostage by the missing push key
    await sender.send(message('email', 'ada@acme.test'));
    expect(sent).toHaveLength(1);
    await expect(sender.send(message('push', 'tok'))).rejects.toThrow(
      /APNS_PRIVATE_KEY_BASE64 is not set/
    );
    await expect(sender.send(message('push', 'tok'))).rejects.toThrow(PermanentError);
  });

  test('the provider sender outlives the run: one APNs provider token across runs on one env', async () => {
    const { env, fetched, fetchImpl } = setup();
    const config = {
      templates,
      apns: { topic: 'io.acme.app', keyId: 'KEY1234567', teamId: 'TEAM123456' },
    };
    // Two runs, each assembling its own channels against the same env
    await channelsFromConfig(config, env, { fetch: fetchImpl }).send(message('push', 'tok1'));
    await channelsFromConfig(config, env, { fetch: fetchImpl }).send(message('push', 'tok2'));
    expect(fetched).toHaveLength(2);
    // The same JWT: signed once, reused (Apple refuses a sender that re-signs on every push)
    expect(fetched[0]?.auth).toBe(fetched[1]?.auth);
    // Another env (another deployment, another isolate) signs its own
    const other = setup();
    await channelsFromConfig(config, other.env, { fetch: fetchImpl }).send(message('push', 'tok3'));
    expect(other.fetched[0]?.auth).not.toBe(fetched[0]?.auth);
    // A different config on the same env builds a new sender rather than reusing the old
    await channelsFromConfig({ ...config, apns: { ...config.apns, topic: 'io.acme.other' } }, env, {
      fetch: fetchImpl,
    }).send(message('push', 'tok4'));
    expect(fetched[2]?.auth).not.toBe(fetched[0]?.auth);
  });

  test('a cached sender still forgets the dead token in the store of the run that met it', async () => {
    const { env, fetchImpl } = setup(true);
    const config = {
      templates,
      apns: { topic: 'io.acme.app', keyId: 'KEY1234567', teamId: 'TEAM123456' },
    };
    const first = new D1JourneyStore(new FakeD1());
    const second = new D1JourneyStore(new FakeD1());
    await first.upsertDevice({ userId: 'u1', token: 'dead1', platform: 'ios', ts: 1 });
    await second.upsertDevice({ userId: 'u1', token: 'dead2', platform: 'ios', ts: 1 });
    const result1 = await channelsFromConfig(config, env, { fetch: fetchImpl, store: first }).send(
      message('push', 'dead1')
    );
    const result2 = await channelsFromConfig(config, env, { fetch: fetchImpl, store: second }).send(
      message('push', 'dead2')
    );
    expect(result1).toEqual({ delivered: false, reason: 'Unregistered' });
    expect(result2).toEqual({ delivered: false, reason: 'Unregistered' });
    expect(await first.listDevices('u1')).toEqual([]);
    expect(await second.listDevices('u1')).toEqual([]);
  });

  test('a token APNs reports as gone is removed from the store', async () => {
    const { env, fetchImpl } = setup(true);
    const store = new D1JourneyStore(new FakeD1());
    await store.upsertDevice({ userId: 'u1', token: 'deadtoken', platform: 'ios', ts: 1 });
    const sender = channelsFromConfig(
      { templates, apns: { topic: 'io.acme.app', keyId: 'KEY1234567', teamId: 'TEAM123456' } },
      env,
      { fetch: fetchImpl, store }
    );
    await sender.send(message('push', 'deadtoken'));
    expect(await store.listDevices('u1')).toEqual([]);
  });
});
