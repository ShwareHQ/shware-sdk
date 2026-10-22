import { webcrypto } from 'node:crypto';
import { createElement } from 'react';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { z } from 'zod';
import type { EmailBindingLike } from '../src/cloudflare/bindings';
import type { OutboundMessage } from '../src/engine/ports';
import { PermanentError } from '../src/engine/retry';
import type { FcmServiceAccount } from '../src/fcm';
import { type ChannelsConfig, channelsFromConfig, createProviderCache } from '../src/host/channels';
import { base64url } from '../src/jwt';
import { renderPostgresDdl } from '../src/store/tables';
import { emailTemplate, pushTemplate } from '../src/templates';
import { cloudflareEmailTransport } from '../src/transports/cloudflare-email';
import { generateVapidKeys } from '../src/webpush';
import { FakeJourney } from './fake-cloudflare';
import { type PgliteDatabase, pgliteDatabase } from './pglite';

/**
 * channelsFromConfig: the outlets a workflow.config.ts describes, assembled
 * against the environment — email through the host's transport, iOS to APNs with the
 * configured key, Android through FCM — and clear failures for what is not
 * configured.
 */

let p8Base64: string;
/** A second APNs key: what a rotated secret looks like to the host. */
let rotatedP8Base64: string;
/** A service account with a real (throwaway) RSA key, so the FCM token exchange is reached. */
let serviceAccountBase64: string;
let database: PgliteDatabase;

async function apnsKey(): Promise<string> {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ]);
  const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)).toString(
    'base64'
  );
  return Buffer.from(`-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----\n`).toString(
    'base64'
  );
}

beforeAll(async () => {
  p8Base64 = await apnsKey();
  rotatedP8Base64 = await apnsKey();
  const pair = await webcrypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );
  const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)).toString(
    'base64'
  );
  const account: FcmServiceAccount = {
    project_id: 'acme',
    client_email: 'sa@acme.iam.gserviceaccount.com',
    private_key: `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----\n`,
  };
  serviceAccountBase64 = Buffer.from(JSON.stringify(account)).toString('base64');
  database = await pgliteDatabase();
  // A second store of its own (another schema), for the run that meets another device
  await database.pg.exec(renderPostgresDdl('second'));
}, 30_000);
afterAll(async () => {
  await database.close();
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

  test('a token APNs reports as gone is removed from the store', async () => {
    const { env, fetchImpl } = setup(true);
    const store = database.store;
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

describe('the provider cache', () => {
  const apns = { topic: 'io.acme.app', keyId: 'KEY1234567', teamId: 'TEAM123456' };
  const config = { templates, apns };

  test('one APNs provider token across runs sharing a cache; a new one per cache, secret or key', async () => {
    const { env, fetched, fetchImpl } = setup();
    const providers = createProviderCache();
    // Two runs, each assembling its own channels against its own env object (as a Lambda does)
    await channelsFromConfig(config, { ...env }, { fetch: fetchImpl, providers }).send(
      message('push', 'tok1')
    );
    await channelsFromConfig(config, { ...env }, { fetch: fetchImpl, providers }).send(
      message('push', 'tok2')
    );
    expect(fetched).toHaveLength(2);
    // The same JWT: signed once, reused (Apple refuses a sender that re-signs on every push)
    expect(fetched[0]?.auth).toBe(fetched[1]?.auth);
    const auths = () => fetched.map((f) => f.auth);
    // Another host (another cache) signs its own
    await channelsFromConfig(config, env, {
      fetch: fetchImpl,
      providers: createProviderCache(),
    }).send(message('push', 'tok3'));
    expect(auths()[2]).not.toBe(auths()[0]);
    // A rotated secret is a new credential in the same cache
    await channelsFromConfig(
      config,
      { ...env, APNS_PRIVATE_KEY_BASE64: rotatedP8Base64 },
      { fetch: fetchImpl, providers }
    ).send(message('push', 'tok4'));
    expect(auths()[3]).not.toBe(auths()[0]);
    // So is another key id
    await channelsFromConfig({ ...config, apns: { ...apns, keyId: 'KEY7654321' } }, env, {
      fetch: fetchImpl,
      providers,
    }).send(message('push', 'tok5'));
    expect(auths()[4]).not.toBe(auths()[0]);
    // Another topic or fetch shapes the sender, not the credential: the same key, the same JWT
    await channelsFromConfig({ ...config, apns: { ...apns, topic: 'io.acme.other' } }, env, {
      fetch: fetchImpl,
      providers,
    }).send(message('push', 'tok6'));
    expect(auths()[5]).toBe(auths()[0]);
    const other = setup();
    await channelsFromConfig(config, env, { fetch: other.fetchImpl, providers }).send(
      message('push', 'tok7')
    );
    expect(other.fetched[0]?.auth).toBe(auths()[0]);
    // Without a cache every call signs its own
    await channelsFromConfig(config, env, { fetch: fetchImpl }).send(message('push', 'tok8'));
    expect(auths()[6]).not.toBe(auths()[0]);
  });

  test('two registries on one credential each render their own copy, under one JWT', async () => {
    const bodies: string[] = [];
    const auths: (string | null)[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const payload = JSON.parse(init?.body as string) as { aps: { alert: { body: string } } };
      bodies.push(payload.aps.alert.body);
      auths.push(new Headers(init?.headers).get('authorization'));
      return new Response(null, { status: 200 });
    };
    const registry = (body: string) => ({
      nudge: pushTemplate({
        id: 'nudge',
        title: 'Nudge',
        props: named,
        preview: { name: 'A' },
        content: () => ({ title: 'Hi', body }),
      }),
    });
    const { env } = setup();
    const providers = createProviderCache();
    for (const body of ['A', 'B']) {
      await channelsFromConfig({ templates: { push: registry(body) }, apns }, env, {
        fetch: fetchImpl,
        providers,
      }).send(message('push', 'tok'));
    }
    expect(bodies).toEqual(['A', 'B']);
    expect(auths[1]).toBe(auths[0]);
  });

  test('a shared credential still forgets the dead token in the store of the run that met it', async () => {
    const { env, fetchImpl } = setup(true);
    const providers = createProviderCache();
    const first = database.store;
    const second = database.storeIn('second');
    await first.upsertDevice({ userId: 'u1', token: 'dead1', platform: 'ios', ts: 1 });
    await second.upsertDevice({ userId: 'u1', token: 'dead2', platform: 'ios', ts: 1 });
    // The first run meets a live device: the credential is minted with that run's store around
    const live = setup();
    await channelsFromConfig(config, env, {
      fetch: live.fetchImpl,
      store: first,
      providers,
    }).send(message('push', 'alive'));
    const result = await channelsFromConfig(config, env, {
      fetch: fetchImpl,
      store: second,
      providers,
    }).send(message('push', 'dead2'));
    expect(result).toEqual({ delivered: false, reason: 'Unregistered' });
    expect(await first.listDevices('u1')).toEqual([{ token: 'dead1', platform: 'ios' }]);
    expect(await second.listDevices('u1')).toEqual([]);
  });

  test('one FCM access token across runs sharing a cache: concurrent first sends exchange once, a failed exchange is retried, another fetch is another token', async () => {
    const tokenCalls: number[] = [];
    let tokenStatus = 503;
    const fetchFor = (log: number[]): typeof fetch => {
      return async (url) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        if (href.endsWith('/token')) {
          log.push(tokenStatus);
          if (tokenStatus !== 200) return new Response('down', { status: tokenStatus });
          return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), {
            status: 200,
          });
        }
        return new Response(null, { status: 200 });
      };
    };
    const fetchImpl = fetchFor(tokenCalls);
    const { env } = setup();
    const providers = createProviderCache();
    const run = (fetch = fetchImpl) =>
      channelsFromConfig(
        { templates, fcm: {} },
        { ...env, GOOGLE_APPLICATION_CREDENTIALS_BASE64: serviceAccountBase64 },
        { fetch, providers }
      );
    // The token endpoint is down: the first send fails, retryable, and nothing is kept
    await expect(run().send(message('push', 'a1', 'android'))).rejects.toThrow(/503/);
    expect(tokenCalls).toEqual([503]);
    tokenStatus = 200;
    // Two runs send at once on the fresh credential: one exchange, both carry its token
    await Promise.all([
      run().send(message('push', 'a1', 'android')),
      run().send(message('push', 'a2', 'android')),
    ]);
    expect(tokenCalls).toEqual([503, 200]);
    await run().send(message('push', 'a3', 'android'));
    expect(tokenCalls).toEqual([503, 200]);
    // The exchange goes through the fetch: another fetch implementation is another credential
    const otherCalls: number[] = [];
    await run(fetchFor(otherCalls)).send(message('push', 'a4', 'android'));
    expect(otherCalls).toEqual([200]);
    expect(tokenCalls).toEqual([503, 200]);
  });

  test('one VAPID signer across runs sharing a cache', async () => {
    const vapid = await generateVapidKeys();
    const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ]);
    const subscription = JSON.stringify({
      endpoint: 'https://push.example.com/send/abc',
      keys: {
        p256dh: base64url(new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey))),
        auth: base64url(crypto.getRandomValues(new Uint8Array(16))),
      },
    });
    const auths: (string | null)[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      auths.push(new Headers(init?.headers).get('authorization'));
      return new Response(null, { status: 201 });
    };
    const { env } = setup();
    const providers = createProviderCache();
    const run = (keys = vapid) =>
      channelsFromConfig(
        { templates, webPush: { subject: 'mailto:ops@acme.test' } },
        { ...env, VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey },
        { fetch: fetchImpl, providers }
      );
    const web = (token: string): OutboundMessage => ({
      ...message('push', token),
      device: { token, platform: 'web' },
    });
    await run().send(web(subscription));
    await run().send(web(subscription));
    expect(auths[0]).toMatch(/^vapid t=/);
    expect(auths[1]).toBe(auths[0]);
    // A rotated pair signs its own
    await run(await generateVapidKeys()).send(web(subscription));
    expect(auths[2]).not.toBe(auths[0]);
  });

  test('a credential is built once per key; a build that threw is not kept', () => {
    const providers = createProviderCache();
    let builds = 0;
    expect(() =>
      providers.get('k', () => {
        builds++;
        throw new PermanentError('secret is not base64');
      })
    ).toThrow(PermanentError);
    const credential = { token: 't' };
    const working = () => {
      builds++;
      return credential;
    };
    expect(providers.get('k', working)).toBe(credential);
    expect(providers.get('k', working)).toBe(credential);
    expect(providers.get('other', working)).toBe(credential);
    expect(builds).toBe(3);
  });
});
