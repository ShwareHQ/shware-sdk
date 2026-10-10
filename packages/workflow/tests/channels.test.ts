import { webcrypto } from 'node:crypto';
import { createElement } from 'react';
import { beforeAll, describe, expect, test } from 'vitest';
import type { EmailBindingLike } from '../src/cloudflare/bindings';
import { channelsFromConfig, journeyMode, runtimeFromConfig } from '../src/cloudflare/channels';
import { apnsEnvironment, emailAddresses, formatEmailAddress } from '../src/config';
import type { OutboundMessage } from '../src/engine/ports';
import { D1JourneyStore } from '../src/store/d1';
import { FakeD1, FakeJourney, FakeKV } from './fake-cloudflare';

/**
 * channelsFromConfig: the outlets a workflow.config.ts describes, assembled
 * against the environment — email through the binding, iOS to APNs with the
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

const emails = {
  welcome: { default: () => createElement('p', null, 'hi'), subject: 'Welcome {{ user.name }}' },
};
const pushes = { nudge: { title: 'Hi {name}', body: 'come back' } };

function setup(platform: 'ios' | 'android' = 'ios') {
  const db = new FakeD1();
  const store = new D1JourneyStore(db, new FakeKV());
  db.profiles.set('u1', JSON.stringify({ name: 'Ada', push_platform: platform }));
  const sent: { to: unknown; from: unknown; subject: string; idempotencyKey: string }[] = [];
  const binding: EmailBindingLike = {
    async send(message) {
      sent.push({
        to: message.to,
        from: message.from,
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
    return new Response(null, { status: 200 });
  };
  const env = {
    JOURNEY: new FakeJourney(),
    EMAIL: binding,
    ENVIRONMENT: 'development',
    APNS_PRIVATE_KEY_BASE64: p8Base64,
    APNS_RELAY_ORIGIN: 'http://localhost:8341',
  };
  return { store, env, sent, fetched, fetchImpl };
}

const message = (channel: 'email' | 'push', recipient: string): OutboundMessage => ({
  channel,
  template: channel === 'email' ? 'welcome' : 'nudge',
  props: { name: 'Ada' },
  userId: 'u1',
  recipient,
  idempotencyKey: 'inst:1',
});

describe('channelsFromConfig', () => {
  test('email goes through the binding with the configured envelope and profile subjects', async () => {
    const { store, env, sent } = setup();
    const sender = channelsFromConfig(
      { emails: { from: { email: 'hi@acme.test', name: 'Acme' }, replyTo: 'help@acme.test' } },
      env,
      store,
      { emails, pushes }
    );
    await sender.send(message('email', 'ada@example.com'));
    expect(sent).toEqual([
      {
        to: 'ada@example.com',
        from: { email: 'hi@acme.test', name: 'Acme' },
        subject: 'Welcome Ada',
        idempotencyKey: 'inst:1',
      },
    ]);
  });

  test('an iOS push goes to APNs through the dev relay, in the sandbox for development', async () => {
    const { store, env, fetched, fetchImpl } = setup('ios');
    const sender = channelsFromConfig(
      { apns: { topic: 'io.acme.app', keyId: 'KEY1234567', teamId: 'TEAM123456' } },
      env,
      store,
      { emails, pushes },
      fetchImpl
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
    const { store, env, fetched, fetchImpl } = setup('android');
    const serviceAccount = Buffer.from(
      JSON.stringify({
        project_id: 'acme',
        client_email: 'sa@acme.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----\n',
      })
    ).toString('base64');
    const sender = channelsFromConfig(
      { fcm: { androidChannelId: 'default' } },
      { ...env, GOOGLE_APPLICATION_CREDENTIALS_BASE64: serviceAccount },
      store,
      { emails, pushes },
      fetchImpl
    );
    // The fake key cannot sign, so the token exchange is where this stops — past routing and setup.
    await expect(sender.send(message('push', 'fcmtoken'))).rejects.toThrow(Error);
    expect(fetched).toEqual([]);
  });

  test('a channel the config leaves out fails the step with the reason', async () => {
    const { store, env } = setup();
    const sender = channelsFromConfig({ emails: { from: 'hi@acme.test' } }, env, store, { emails });
    await expect(sender.send(message('push', 'tok'))).rejects.toThrow(/no push registry/);
    const noEmail = channelsFromConfig(
      { apns: { topic: 't', keyId: 'k', teamId: 't' } },
      env,
      store,
      {
        pushes,
      }
    );
    await expect(noEmail.send(message('email', 'a@b.c'))).rejects.toThrow(/no email registry/);
    const noPlatform = channelsFromConfig({}, env, store, { pushes });
    await expect(noPlatform.send(message('push', 'tok'))).rejects.toThrow(/neither apns nor fcm/);
  });

  test('a configured channel without its secret fails at assembly, naming the variable', () => {
    const { store, env } = setup();
    expect(() =>
      channelsFromConfig(
        { apns: { topic: 't', keyId: 'k', teamId: 't' } },
        { ...env, APNS_PRIVATE_KEY_BASE64: undefined },
        store,
        { pushes }
      )
    ).toThrow(/APNS_PRIVATE_KEY_BASE64 is not set/);
  });
});

describe('config helpers', () => {
  test('runtime and mode come from ENVIRONMENT, production when unset', () => {
    const config = { runtime: { development: { timeScale: 3600, logMessages: true } } };
    expect(journeyMode({ JOURNEY: new FakeJourney() })).toBe('production');
    expect(runtimeFromConfig(config, { JOURNEY: new FakeJourney() })).toEqual({
      timeScale: 1,
      logMessages: false,
    });
    expect(
      runtimeFromConfig(config, { JOURNEY: new FakeJourney(), ENVIRONMENT: 'development' })
    ).toEqual({ timeScale: 3600, logMessages: true });
  });

  test('the APNs environment defaults to sandbox outside production and can be configured', () => {
    const apns = { topic: 't', keyId: 'k', teamId: 't' };
    expect(apnsEnvironment(apns, 'development')).toBe('sandbox');
    expect(apnsEnvironment(apns, 'production')).toBe('production');
    expect(apnsEnvironment({ ...apns, environment: { staging: 'production' } }, 'staging')).toBe(
      'production'
    );
  });

  test('the address book is derived from from / replyTo unless listed', () => {
    expect(formatEmailAddress({ email: 'a@b.c', name: 'Ab' })).toBe('Ab <a@b.c>');
    expect(emailAddresses({ from: { email: 'a@b.c', name: 'Ab' }, replyTo: 'r@b.c' })).toEqual([
      'Ab <a@b.c>',
      'r@b.c',
    ]);
    expect(emailAddresses({ from: 'a@b.c', addresses: ['x@y.z'] })).toEqual(['x@y.z']);
    expect(emailAddresses(undefined)).toEqual([]);
  });
});
