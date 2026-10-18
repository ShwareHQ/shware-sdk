import { describe, expect, test } from 'vitest';
import type { OutboundMessage } from '../src/engine/ports';
import { base64url } from '../src/jwt';
import {
  WebPushSender,
  encryptPayload,
  fromBase64url,
  generateVapidKeys,
  vapidAuthorization,
} from '../src/webpush';

/**
 * Web Push: the payload a browser can decrypt (RFC 8291, checked by decrypting it as the browser
 * would), a VAPID header the push service can verify (RFC 8292), and how the sender reads the
 * push service's answers.
 */

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

  test('the VAPID header carries a token the push service can verify', async () => {
    const vapid = { ...(await generateVapidKeys()), subject: 'mailto:ops@example.com' };
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid, 0);
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    if (!match) throw new Error('Expected a VAPID authorization header');
    const [, token, k] = match;
    expect(k).toBe(vapid.publicKey);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    const h = parts.at(0);
    const c = parts.at(1);
    const s = parts.at(2);
    if (!h || !c || !s) throw new Error('Expected a complete signed JWT');
    const claims = JSON.parse(atob(c.replace(/-/g, '+').replace(/_/g, '/')));
    expect(claims).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: 12 * 3600,
      sub: 'mailto:ops@example.com',
    });
    const publicKey = await crypto.subtle.importKey(
      'raw',
      fromBase64url(vapid.publicKey),
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

  test('the sender posts the encrypted push with the content and the tracking data', async () => {
    const ua = await browser();
    const subscription = JSON.stringify({
      endpoint: 'https://push.example.com/send/abc',
      keys: { p256dh: base64url(ua.p256dh), auth: base64url(ua.auth) },
    });
    const requests: { url: string; init: RequestInit }[] = [];
    const sender = new WebPushSender({
      vapid: { ...(await generateVapidKeys()), subject: 'mailto:ops@example.com' },
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

  test('a subscription the push service reports gone is dropped, not retried', async () => {
    const ua = await browser();
    const subscription = JSON.stringify({
      endpoint: 'https://push.example.com/send/gone',
      keys: { p256dh: base64url(ua.p256dh), auth: base64url(ua.auth) },
    });
    const removed: string[] = [];
    const sender = new WebPushSender({
      vapid: { ...(await generateVapidKeys()), subject: 'mailto:ops@example.com' },
      render: async () => ({ title: 'Tip', body: 'Try it' }),
      fetch: async () => new Response(null, { status: 410 }),
      onUnregistered: (m) => {
        removed.push(m.recipient ?? '');
      },
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
    // The gone subscription, then each unusable one, removed as it was met
    expect(removed[0]).toBe(subscription);
    expect(removed).toHaveLength(4);
    await expect(
      new WebPushSender({
        vapid: { ...(await generateVapidKeys()), subject: 'mailto:ops@example.com' },
        render: async () => ({ title: 'Tip', body: 'Try it' }),
        fetch: async () => new Response('slow down', { status: 429 }),
      }).send(message(subscription))
    ).rejects.toThrow('429');
  });
});
