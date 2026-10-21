import { afterEach, describe, expect, test, vi } from 'vitest';
import type { OutboundMessage } from '../src/engine/ports';
import { PermanentError, isRetryable } from '../src/engine/retry';
import { base64url } from '../src/jwt';
import {
  DEAD_TOKEN_REASONS,
  MAX_PLAINTEXT_BYTES,
  VapidSigner,
  WebPushSender,
  encryptPayload,
  fromBase64url,
  generateVapidKeys,
  webPushTopic,
} from '../src/webpush';

/**
 * Web Push: the payload a browser can decrypt (RFC 8291, checked by decrypting it as the browser
 * would), a VAPID header the push service can verify (RFC 8292), and how the sender reads the
 * push service's answers.
 */

afterEach(() => {
  vi.useRealTimers();
});

type Bytes = Uint8Array<ArrayBuffer>;
const utf8 = (text: string): Bytes => new TextEncoder().encode(text);
const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
const hkdf = async (salt: Bytes, ikm: Bytes, info: Bytes, length: number) =>
  (await hmac(await hmac(salt, ikm), concat(info, new Uint8Array([1])))).slice(0, length);

/** A browser's subscription keys: its ECDH pair and auth secret. */
async function browser() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const p256dh = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, p256dh, auth };
}

/** The browser's subscription as the app registers it, on `endpoint`. */
const subscriptionOn = (ua: Awaited<ReturnType<typeof browser>>, endpoint: string) =>
  JSON.stringify({ endpoint, keys: { p256dh: base64url(ua.p256dh), auth: base64url(ua.auth) } });

/** What the browser does with an aes128gcm body (RFC 8291 §3.4, receiver side). */
async function decrypt(body: Uint8Array, ua: Awaited<ReturnType<typeof browser>>) {
  const salt = body.slice(0, 16);
  expect(body.length).toBeGreaterThan(20);
  const idlen = body.at(20);
  if (idlen === undefined) throw new Error('Missing sender key length');
  const senderPublic = body.slice(21, 21 + idlen);
  const sealed = body.slice(21 + idlen);
  const sender = await crypto.subtle.importKey(
    'raw',
    senderPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, ua.pair.privateKey, 256)
  );
  const ikm = await hkdf(
    ua.auth,
    shared,
    concat(utf8('WebPush: info\0'), ua.p256dh, senderPublic),
    32
  );
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed)
  );
  expect(plain.at(-1)).toBe(2); // the last record's delimiter
  return new TextDecoder().decode(plain.slice(0, -1));
}

/** A `vapid t=…, k=…` header taken apart: the JWT's claims and signature parts, and the key. */
function parseVapid(header: string) {
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  if (!match) throw new Error('Expected a VAPID authorization header');
  const [, token, k] = match;
  const [h, c, s] = token.split('.');
  if (!h || !c || !s) throw new Error('Expected a complete signed JWT');
  const claims = JSON.parse(atob(c.replace(/-/g, '+').replace(/_/g, '/'))) as Record<
    string,
    unknown
  >;
  return { token, k, h, c, s, claims };
}

const signer = async () =>
  new VapidSigner({ ...(await generateVapidKeys()), subject: 'mailto:ops@example.com' });

const message = (recipient: string): OutboundMessage => ({
  workflow: 'w',
  instanceId: 'i1',
  nodeId: 'n1',
  channel: 'push',
  template: 'tip',
  props: {},
  userId: 'u1',
  recipient,
  device: { token: recipient, platform: 'web' },
  idempotencyKey: 'i1:n1:t',
  tracking: { data: { message_id: 'm1', opened_url: 'https://wf.example.com/t/p/m1' } },
});

describe('web push', () => {
  test('the browser decrypts what the sender sealed', async () => {
    const ua = await browser();
    const body = await encryptPayload(utf8('{"title":"Hi"}'), ua.p256dh, ua.auth);
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(await decrypt(body, ua)).toBe('{"title":"Hi"}');
  });

  /**
   * The VAPID signer: one key import and one JWT per push service, reused by every sender built
   * on the pair for 12 hours of the token's 24-hour life.
   */
  describe('VapidSigner', () => {
    test('the header carries a token the push service can verify', async () => {
      const keys = await generateVapidKeys();
      const vapid = new VapidSigner({ ...keys, subject: 'mailto:ops@example.com' });
      const { k, h, c, s, claims } = parseVapid(
        await vapid.authorization('https://fcm.googleapis.com/fcm/send/abc', 0)
      );
      expect(k).toBe(keys.publicKey);
      expect(claims).toEqual({
        aud: 'https://fcm.googleapis.com',
        exp: 24 * 3600,
        sub: 'mailto:ops@example.com',
      });
      const publicKey = await crypto.subtle.importKey(
        'raw',
        fromBase64url(keys.publicKey),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify']
      );
      const valid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        publicKey,
        fromBase64url(s),
        utf8(`${h}.${c}`)
      );
      expect(valid).toBe(true);
    });

    test('signs once per push service origin and reuses the token for 12 hours', async () => {
      vi.useFakeTimers({ now: 1_000_000_000_000 });
      const vapid = await signer();
      const first = await vapid.authorization('https://push.example.com/send/one');
      // Another endpoint on the same service: the same token, its `aud` is the origin
      expect(await vapid.authorization('https://push.example.com/send/two')).toBe(first);
      // Another service: its own token
      const other = await vapid.authorization(
        'https://updates.push.services.mozilla.com/wpush/v2/x'
      );
      expect(other).not.toBe(first);
      expect(parseVapid(other).claims.aud).toBe('https://updates.push.services.mozilla.com');
      vi.advanceTimersByTime(12 * 3600_000 - 1);
      expect(await vapid.authorization('https://push.example.com/send/one')).toBe(first);
      vi.advanceTimersByTime(1);
      const renewed = await vapid.authorization('https://push.example.com/send/one');
      expect(renewed).not.toBe(first);
      expect(parseVapid(renewed).claims.exp).toBe(1_000_000_000 + 36 * 3600);
    });

    test('concurrent first calls import the key once and sign once', async () => {
      const importKey = vi.spyOn(crypto.subtle, 'importKey');
      const sign = vi.spyOn(crypto.subtle, 'sign');
      const vapid = await signer();
      const headers = await Promise.all([
        vapid.authorization('https://push.example.com/a', 0),
        vapid.authorization('https://push.example.com/b', 0),
        vapid.authorization('https://push.example.com/c', 0),
      ]);
      expect(new Set(headers).size).toBe(1);
      expect(importKey).toHaveBeenCalledTimes(1);
      expect(sign).toHaveBeenCalledTimes(1);
      importKey.mockRestore();
      sign.mockRestore();
    });

    test('a signing that failed is not kept: the next call tries again', async () => {
      const keys = await generateVapidKeys();
      const vapid = new VapidSigner({ ...keys, privateKey: 'nope', subject: 'mailto:x@y.z' });
      await expect(vapid.authorization('https://push.example.com/a')).rejects.toThrow(/./);
      await expect(vapid.authorization('https://push.example.com/a')).rejects.toThrow(/./);
    });
  });

  test('the sender posts the encrypted push with the content and the tracking data', async () => {
    const ua = await browser();
    const subscription = subscriptionOn(ua, 'https://push.example.com/send/abc');
    const requests: { url: string; init: RequestInit }[] = [];
    const sender = new WebPushSender({
      credentials: await signer(),
      render: async () => ({ title: 'Tip', body: 'Try it', url: 'https://app.example.com/x' }),
      fetch: async (url, init) => {
        requests.push({ url: url as string, init: init ?? {} });
        return new Response(null, { status: 201 });
      },
    });
    expect(await sender.send(message(subscription))).toBeUndefined();
    expect(requests).toHaveLength(1);
    const request = requests.at(0);
    if (!request) throw new Error('The push request must be sent');
    expect(request.url).toBe('https://push.example.com/send/abc');
    const headers = new Headers(request.init.headers);
    expect(headers.get('content-encoding')).toBe('aes128gcm');
    expect(headers.get('authorization')).toMatch(/^vapid t=/);
    // RFC 8030 §5.4: at most 32 characters of the URL-safe base64 alphabet, the same on a resend
    const topic = headers.get('topic');
    expect(topic).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(topic).toBe(await webPushTopic('i1:n1:t'));
    expect(await webPushTopic('i1:n1:other')).not.toBe(topic);
    const payload = JSON.parse(await decrypt(request.init.body as Uint8Array, ua));
    expect(payload).toMatchObject({
      title: 'Tip',
      body: 'Try it',
      url: 'https://app.example.com/x',
      template: 'tip',
      message_id: 'm1',
      opened_url: 'https://wf.example.com/t/p/m1',
    });
  });

  test('two senders on one credential carry the same VAPID token', async () => {
    const ua = await browser();
    const subscription = subscriptionOn(ua, 'https://push.example.com/send/abc');
    const auths: (string | null)[] = [];
    const credentials = await signer();
    for (const ttl of [60, 120]) {
      await new WebPushSender({
        credentials,
        render: async () => ({ title: 'Tip', body: 'Try it' }),
        ttl,
        fetch: async (_url, init) => {
          auths.push(new Headers(init?.headers).get('authorization'));
          return new Response(null, { status: 201 });
        },
      }).send(message(subscription));
    }
    expect(auths[0]).toMatch(/^vapid t=/);
    expect(auths[1]).toBe(auths[0]);
  });

  test('a subscription the push service reports gone is dropped, not retried', async () => {
    const ua = await browser();
    const subscription = subscriptionOn(ua, 'https://push.example.com/send/gone');
    const sender = new WebPushSender({
      credentials: await signer(),
      render: async () => ({ title: 'Tip', body: 'Try it' }),
      fetch: async () => new Response(null, { status: 410 }),
    });
    expect(await sender.send(message(subscription))).toEqual({ delivered: false, reason: 'Gone' });
    // Not a usable subscription: settled at once, never retried
    for (const bad of [
      'not json',
      JSON.stringify({ endpoint: 'https://push.example.com/x' }),
      JSON.stringify({
        endpoint: 'http://push.example.com/x',
        keys: JSON.parse(subscription).keys,
      }),
    ]) {
      expect(await sender.send(message(bad))).toEqual({
        delivered: false,
        reason: 'InvalidSubscription',
      });
    }
    await expect(
      new WebPushSender({
        credentials: await signer(),
        render: async () => ({ title: 'Tip', body: 'Try it' }),
        fetch: async () => new Response('slow down', { status: 429 }),
      }).send(message(subscription))
    ).rejects.toThrow('429');
  });

  test('a payload past the single-record limit is permanent, before anything is sent', async () => {
    const ua = await browser();
    const subscription = subscriptionOn(ua, 'https://push.example.com/send/abc');
    let fetched = 0;
    const sender = new WebPushSender({
      credentials: await signer(),
      render: async () => ({ title: 'Tip', body: 'x'.repeat(MAX_PLAINTEXT_BYTES) }),
      fetch: async () => {
        fetched += 1;
        return new Response(null, { status: 201 });
      },
    });
    const error = await sender.send(message(subscription)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PermanentError);
    expect(String(error)).toMatch(/at most 3993/);
    expect(fetched).toBe(0);
  });

  /**
   * How each push service answer ends the copy: a gone subscription settles it under a
   * `DEAD_TOKEN_REASONS` reason (the host forgets the device), a refused request fails it for
   * good, throttling and outages retry.
   */
  describe('classification', () => {
    type Outcome = 'settled-dead-token' | 'PermanentError' | 'retryable';
    const table: [status: number, reason: string, outcome: Outcome][] = [
      [404, 'NotFound', 'settled-dead-token'],
      [410, 'Gone', 'settled-dead-token'],
      [400, '', 'PermanentError'],
      [401, '', 'PermanentError'],
      [403, '', 'PermanentError'],
      [413, '', 'PermanentError'],
      [429, '', 'retryable'],
      [500, '', 'retryable'],
      [503, '', 'retryable'],
    ];
    /** What the send did, in the table's terms: how it ended, and whether the device is dead. */
    const observe = async (status: number) => {
      const ua = await browser();
      const subscription = subscriptionOn(ua, 'https://push.example.com/send/abc');
      const sender = new WebPushSender({
        credentials: await signer(),
        render: async () => ({ title: 'Tip', body: 'Try it' }),
        fetch: async () => new Response('said', { status }),
      });
      const result = await sender.send(message(subscription)).then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error })
      );
      const { error } = result;
      const outcome: Outcome | undefined =
        error === undefined
          ? 'settled-dead-token'
          : error instanceof PermanentError
            ? 'PermanentError'
            : 'retryable';
      return {
        outcome,
        settled: result.value,
        dead: result.value === undefined ? undefined : DEAD_TOKEN_REASONS.has(result.value.reason),
        retryable: error === undefined ? undefined : isRetryable(error),
        namesStatus: error instanceof Error ? error.message.includes(String(status)) : undefined,
      };
    };
    test.each(table)('%i → %s', async (status, reason, outcome) => {
      const dead = outcome === 'settled-dead-token';
      expect(await observe(status)).toEqual({
        outcome,
        settled: dead ? { delivered: false, reason } : undefined,
        dead: dead ? true : undefined,
        retryable: dead ? undefined : outcome === 'retryable',
        namesStatus: dead ? undefined : true,
      });
    });
  });
});
