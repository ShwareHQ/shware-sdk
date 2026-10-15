import type { MessageSender, OutboundMessage, SendResult } from './engine';
import { base64url } from './jwt';
import type { PushRenderer } from './push';

/**
 * `@shware/workflow/webpush` — browser push through the standard Web Push protocol: VAPID
 * (RFC 8292) identifies the sender, the payload is encrypted for the subscription (RFC 8291,
 * `aes128gcm`, RFC 8188). One sender reaches Chrome, Edge, Firefox and Safari 16+ — each
 * browser's push service accepts the same request, over HTTP/1.1 — with nothing but WebCrypto.
 *
 * The recipient is a browser's `PushSubscription` as JSON (`JSON.stringify(subscription)`),
 * registered like an app token (`registerDevice(userId, { token, platform: 'web' })`). The
 * service worker receives `{ title, body, image?, url?, template, …tracking data }` as the push
 * event's JSON.
 */

/** A VAPID key pair: the uncompressed P-256 public key and the private scalar, base64url. */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export interface WebPushOptions {
  vapid: VapidKeys & {
    /** Who to contact about this sender: `mailto:` or an `https:` URL (RFC 8292). */
    subject: string;
  };
  render: PushRenderer;
  /** Seconds the push service keeps an undelivered message; a day by default. */
  ttl?: number;
  /** Fetch implementation (defaults to the global one). */
  fetch?: typeof fetch;
  /** Called for a subscription the push service reports as gone (404 / 410). */
  onUnregistered?: (message: OutboundMessage) => Promise<void> | void;
}

interface Subscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** A fresh VAPID key pair (once per project; the private key is a secret). */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: base64url(raw), privateKey: jwk.d ?? '' };
}

/** Records are one per message here: the payload stays far below the 4096-byte record size. */
const RECORD_SIZE = 4096;
/** Bytes WebCrypto accepts (backed by a plain ArrayBuffer). */
type Bytes = Uint8Array<ArrayBuffer>;
const encoder = new TextEncoder();
const utf8 = (text: string): Bytes => encoder.encode(text);

export function fromBase64url(text: string): Bytes {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const imported = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, data));
}

/** HKDF-SHA256 with a single output block (every length here is ≤ 32 bytes). */
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

/**
 * The `aes128gcm` body for one subscription (RFC 8291 §3.4): salt, record size, the sender's
 * ephemeral public key, then the payload sealed under a key both sides derive from ECDH and the
 * subscription's auth secret.
 */
export async function encryptPayload(
  payload: Bytes,
  p256dh: Bytes,
  authSecret: Bytes,
  salt: Bytes = crypto.getRandomValues(new Uint8Array(16))
): Promise<Bytes> {
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const receiver = await crypto.subtle.importKey(
    'raw',
    p256dh,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: receiver }, ephemeral.privateKey, 256)
  );
  const ikm = await hkdf(
    authSecret,
    shared,
    concat(utf8('WebPush: info\0'), p256dh, senderPublic),
    32
  );
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // The single, last record: the payload and the 0x02 delimiter, no padding
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      concat(payload, new Uint8Array([2]))
    )
  );
  const header = new Uint8Array(16 + 4 + 1);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = senderPublic.length;
  return concat(header, senderPublic, sealed);
}

/** The VAPID `Authorization` header for one push service (RFC 8292 §3). */
export async function vapidAuthorization(
  endpoint: string,
  vapid: WebPushOptions['vapid'],
  now = Date.now()
): Promise<string> {
  const publicKey = fromBase64url(vapid.publicKey);
  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: vapid.privateKey,
      x: base64url(publicKey.slice(1, 33)),
      y: base64url(publicKey.slice(33, 65)),
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = base64url(
    JSON.stringify({
      aud: new URL(endpoint).origin,
      exp: Math.floor(now / 1000) + 12 * 3600,
      sub: vapid.subject,
    })
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${header}.${claims}`))
  );
  return `vapid t=${header}.${claims}.${base64url(signature)}, k=${vapid.publicKey}`;
}

/**
 * A browser subscription as a sender can use it: an https endpoint, a 65-byte uncompressed P-256
 * key and a 16-byte auth secret. Anything else — not JSON, missing keys, a key of the wrong size,
 * an endpoint that is not https — is undefined.
 */
function parseSubscription(
  token: string
): { endpoint: string; p256dh: Bytes; auth: Bytes } | undefined {
  try {
    const value = JSON.parse(token) as Partial<Subscription>;
    if (typeof value.endpoint !== 'string' || new URL(value.endpoint).protocol !== 'https:') {
      return undefined;
    }
    const p256dh = fromBase64url(value.keys?.p256dh ?? '');
    const auth = fromBase64url(value.keys?.auth ?? '');
    if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return undefined;
    return { endpoint: value.endpoint, p256dh, auth };
  } catch {
    return undefined;
  }
}

export class WebPushSender implements MessageSender {
  constructor(private readonly options: WebPushOptions) {}

  async send(message: OutboundMessage): Promise<void | SendResult> {
    if (message.channel !== 'push') {
      throw new Error(`WebPushSender: unsupported channel '${message.channel}'`);
    }
    if (message.recipient === undefined) {
      throw new Error(`WebPushSender: no subscription for user '${message.userId}'`);
    }
    const subscription = parseSubscription(message.recipient);
    if (subscription === undefined) {
      // Not a usable subscription: nothing will ever deliver to it, so do not retry into it
      await this.options.onUnregistered?.(message);
      return { delivered: false, reason: 'InvalidSubscription' };
    }
    const content = await this.options.render(message.template, message.props);
    const payload = utf8(
      JSON.stringify({
        ...content,
        template: message.template,
        idempotencyKey: message.idempotencyKey,
        ...message.tracking?.data,
      })
    );
    const body = await encryptPayload(payload, subscription.p256dh, subscription.auth);
    const doFetch = this.options.fetch ?? fetch;
    const response = await doFetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        authorization: await vapidAuthorization(subscription.endpoint, this.options.vapid),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(this.options.ttl ?? 86_400),
        urgency: 'normal',
      },
      body,
    });
    if (response.ok) return;
    if (response.status === 404 || response.status === 410) {
      // The browser unsubscribed or the subscription expired: it will never deliver again
      console.warn(`[webpush] subscription gone for user ${message.userId}: ${response.status}`);
      await this.options.onUnregistered?.(message);
      return { delivered: false, reason: response.status === 410 ? 'Gone' : 'NotFound' };
    }
    throw new Error(`[webpush] ${response.status}: ${await response.text()}`);
  }
}
