import { Buffer } from 'node:buffer';
import type { MessageSender, OutboundMessage, SendResult } from './engine';
import { PermanentError, isRetryableStatus } from './engine/retry';
import { base64url } from './jwt';
import type { PushRenderer } from './push';

/**
 * `@shware/workflow/webpush` — browser push through the standard Web Push protocol: VAPID
 * (RFC 8292) identifies the sender, the payload is encrypted for the subscription (RFC 8291,
 * `aes128gcm`, RFC 8188). One sender reaches Chrome, Edge, Firefox and Safari 16+ — each
 * browser's push service accepts the same request, over HTTP/1.1 — with nothing but WebCrypto.
 *
 * The recipient is a browser's `PushSubscription` as JSON (`JSON.stringify(subscription)`),
 * registered like an app token (`registerDevice({ userId, token, platform: 'web' })`). The
 * service worker receives `{ title, body, image?, url?, template, …tracking data }` as the push
 * event's JSON.
 */

/** A VAPID key pair: the uncompressed P-256 public key and the private scalar, base64url. */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export interface VapidSignerOptions extends VapidKeys {
  /** Who to contact about this sender: `mailto:` or an `https:` URL (RFC 8292). */
  subject: string;
}

export interface WebPushOptions {
  /** The VAPID signer the requests are authorized with — shared by every sender on the same key pair. */
  credentials: VapidSigner;
  render: PushRenderer;
  /** Seconds the push service keeps an undelivered message; a day by default. */
  ttl?: number;
  /** Push service hosts accepted besides the browsers' own (`PUSH_SERVICE_HOSTS`): the config's `webPush.pushServices`. */
  pushServices?: readonly string[] | undefined;
  /** Fetch implementation (defaults to the global one). */
  fetch?: typeof fetch;
}

/**
 * How a push service's answer is classified (RFC 8030 §7 and §8.1, with the browsers' services
 * answering as documented there):
 *
 * - dead subscription: 404 and 410 — the browser unsubscribed or the subscription expired
 *   (RFC 8030 §7.3: 410 Gone for an expired subscription) — and a subscription the sender
 *   cannot parse (`InvalidSubscription`). The copy settles undelivered and the host forgets it.
 * - an https endpoint that is no known push service's (`UnlistedPushService`, see
 *   `isPushServiceEndpoint`): settled undelivered without a request, and the device is kept.
 * - transient: 429 Too Many Requests (§8.4) and 5xx.
 * - undelivered, device kept: any other 4xx — 400 (a bad header or body), 401 / 403 (the VAPID
 *   key pair or subject, §8.2 of RFC 8292: also what a subscription made under another key
 *   answers, after a key was rotated), 413 (the payload, RFC 8030 §7.2). A push service names
 *   no finer reason, so one subscription's refusal cannot be told from the sender's; the copy
 *   settles as `Refused<status>` and is logged as an error, and the user's other devices and
 *   the rest of the journey go on.
 */
export const DEAD_TOKEN_REASONS: ReadonlySet<string> = new Set([
  'Gone',
  'NotFound',
  'InvalidSubscription',
]);

interface Subscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * The push services browsers hand out subscription endpoints on. The hosts are those of
 * Pushpad's `known-push-services` list, which it derives from the endpoints of some 200M real
 * subscriptions, checked against Chromium's `push_messaging_constants.cc` and Apple's and
 * Microsoft's own guidance. `*.` covers every subdomain.
 *
 * - `fcm.googleapis.com`: Chrome and the Chromium browsers that use Google's service (Opera,
 *   Brave and others; the list above holds no host of their own). `android.googleapis.com` is its GCM predecessor and
 *   `jmt17.google.com` the staging service of Chromium's source; both still turn up in stored
 *   subscriptions, and both are Google's own.
 * - `updates.push.services.mozilla.com`: Firefox (autopush). The two `mozaws.net` hosts are its
 *   stage and dev deployments.
 * - `*.notify.windows.com`: Edge, on a regional WNS host (`sg2p.notify.windows.com`). Microsoft
 *   tells senders to push to no channel outside this domain.
 * - `*.push.apple.com`: Safari (`web.push.apple.com`). Apple's guidance is to allow every
 *   subdomain.
 *
 * A service not listed here (KaiOS's, a self-hosted one) is named in `webPush.pushServices`.
 */
export const PUSH_SERVICE_HOSTS: readonly string[] = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'jmt17.google.com',
  '*.push.services.mozilla.com',
  'updates-autopush.stage.mozaws.net',
  'updates-autopush.dev.mozaws.net',
  '*.notify.windows.com',
  '*.push.apple.com',
];

const matchesHost = (hostname: string, pattern: string): boolean => {
  const wanted = pattern.trim().toLowerCase();
  if (wanted === '') return false;
  return wanted.startsWith('*.') ? hostname.endsWith(wanted.slice(1)) : hostname === wanted;
};

/**
 * Whether `endpoint` is a URL a push is sent to: https, on the default port, without
 * credentials, and on a known push service's host (`PUSH_SERVICE_HOSTS`, plus `extra` — the
 * config's `webPush.pushServices`). The endpoint is whatever the registering client says it is,
 * and the sender POSTs to it from inside the host's network: without the list, a subscription
 * naming `https://localhost`, an address literal or an internal service's name would have the
 * host send requests there. A list of names, not a refusal of private addresses: a name
 * resolves where its owner says, and the sender never sees the address.
 */
export function isPushServiceEndpoint(endpoint: unknown, extra: readonly string[] = []): boolean {
  if (typeof endpoint !== 'string') return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') {
    return false;
  }
  // A fully qualified name (`fcm.googleapis.com.`) is the same host
  const hostname = url.hostname.replace(/\.$/, '');
  return [...PUSH_SERVICE_HOSTS, ...extra].some((pattern) => matchesHost(hostname, pattern));
}

/**
 * The endpoint of a browser subscription as it is registered (`JSON.stringify(subscription)`),
 * or undefined when the token is not one.
 */
export function subscriptionEndpoint(token: string): string | undefined {
  try {
    const value = JSON.parse(token) as Partial<Subscription> | null;
    return typeof value?.endpoint === 'string' ? value.endpoint : undefined;
  } catch {
    return undefined;
  }
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

/** The record size the header announces: RFC 8291 §4 fixes it at 4096 and one record per push. */
const RECORD_SIZE = 4096;
/**
 * The largest plaintext one record carries. A push message body is at most 4096 octets (RFC 8030
 * §7.2); the aes128gcm header takes 86 of them (16 salt + 4 rs + 1 idlen + 65 key), the record its
 * 16-octet tag and the 1-octet delimiter — 3993 octets of plaintext (RFC 8291 §4). Anything past
 * that is either an invalid record or a 413 from the push service.
 */
export const MAX_PLAINTEXT_BYTES = 3993;
/** Bytes WebCrypto accepts (backed by a plain ArrayBuffer). */
type Bytes = Uint8Array<ArrayBuffer>;
const encoder = new TextEncoder();
const utf8 = (text: string): Bytes => encoder.encode(text);

export function fromBase64url(text: string): Bytes {
  return new Uint8Array(Buffer.from(text, 'base64url'));
}

const concat = (...parts: Uint8Array[]): Bytes => new Uint8Array(Buffer.concat(parts));

/** HKDF-SHA256 (RFC 5869), as WebCrypto provides it. */
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8)
  );
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

/**
 * How long a VAPID token is good for. RFC 8292 §2 allows at most 24 hours, counted on the push
 * service's clock: at exactly 24 a host whose clock runs a little fast signs an `exp` the
 * service sees as more than a day away and refuses. 18 hours leaves six for a fast clock, and
 * six past the 12 the token is reused for a slow one.
 */
const VAPID_EXP_S = 18 * 3600;
/** How long a signed token is reused: half its life, so it is never sent near expiry. */
const VAPID_TTL_MS = 12 * 3600_000;

/**
 * The VAPID `Authorization` header (RFC 8292 §3) for one key pair. The private key is imported
 * once; the JWT is signed per push service (its `aud` is the service's origin) and reused for
 * `VAPID_TTL_MS`. Concurrent callers for one origin share the one signing in flight, and a signing
 * that failed is not kept. One instance serves every sender built on the pair — a host keeps it
 * across runs, and builds the senders per run.
 */
export class VapidSigner {
  private key: Promise<CryptoKey> | undefined;
  private readonly signed = new Map<string, { value: string; issuedAt: number }>();
  private readonly signing = new Map<string, Promise<string>>();

  constructor(private readonly options: VapidSignerOptions) {}

  /** The header value for the push service at `audience` — its origin, or any URL on it. */
  async authorization(audience: string, now = Date.now()): Promise<string> {
    const origin = new URL(audience).origin;
    const current = this.signed.get(origin);
    if (current !== undefined && now - current.issuedAt < VAPID_TTL_MS) return current.value;
    let pending = this.signing.get(origin);
    if (pending === undefined) {
      pending = this.sign(origin, now)
        .then((value) => {
          this.signed.set(origin, { value, issuedAt: now });
          return value;
        })
        .finally(() => {
          this.signing.delete(origin);
        });
      this.signing.set(origin, pending);
    }
    return pending;
  }

  private privateKey(): Promise<CryptoKey> {
    if (this.key === undefined) {
      const publicKey = fromBase64url(this.options.publicKey);
      this.key = crypto.subtle
        .importKey(
          'jwk',
          {
            kty: 'EC',
            crv: 'P-256',
            d: this.options.privateKey,
            x: base64url(publicKey.slice(1, 33)),
            y: base64url(publicKey.slice(33, 65)),
            ext: true,
          },
          { name: 'ECDSA', namedCurve: 'P-256' },
          false,
          ['sign']
        )
        .catch((error: unknown) => {
          this.key = undefined;
          throw error;
        });
    }
    return this.key;
  }

  private async sign(origin: string, now: number): Promise<string> {
    const key = await this.privateKey();
    const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const claims = base64url(
      JSON.stringify({
        aud: origin,
        exp: Math.floor(now / 1000) + VAPID_EXP_S,
        sub: this.options.subject,
      })
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${header}.${claims}`))
    );
    return `vapid t=${header}.${claims}.${base64url(signature)}, k=${this.options.publicKey}`;
  }
}

/**
 * A browser subscription as a sender can use it: an endpoint on a push service
 * (`isPushServiceEndpoint`), a 65-byte uncompressed P-256 key and a 16-byte auth secret. Anything
 * else — not JSON, missing keys, a key of the wrong size, an endpoint that is not https or not a
 * push service's — is undefined.
 */
function parseSubscription(
  token: string,
  pushServices: readonly string[] | undefined
): { endpoint: string; p256dh: Bytes; auth: Bytes } | undefined {
  try {
    const value = JSON.parse(token) as Partial<Subscription>;
    if (typeof value.endpoint !== 'string') return undefined;
    if (!isPushServiceEndpoint(value.endpoint, pushServices)) return undefined;
    const p256dh = fromBase64url(value.keys?.p256dh ?? '');
    const auth = fromBase64url(value.keys?.auth ?? '');
    if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return undefined;
    return { endpoint: value.endpoint, p256dh, auth };
  } catch {
    return undefined;
  }
}

/** The endpoint's host for a log line — never the URL, whose path is the subscription's capability. */
function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'not a URL';
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
    const subscription = parseSubscription(message.recipient, this.options.pushServices);
    if (subscription === undefined) {
      // An https endpoint off the push services' hosts is never fetched, and the copy settles
      // undelivered — but the device is kept (the reason is not a dead token's): it may be a
      // real push service this list does not know, and naming it in `webPush.pushServices`
      // has to bring its devices back rather than find them deleted
      const endpoint = subscriptionEndpoint(message.recipient);
      if (
        endpoint?.startsWith('https://') === true &&
        !isPushServiceEndpoint(endpoint, this.options.pushServices)
      ) {
        console.warn(
          `[webpush] subscription for user ${message.userId} not sent to: its endpoint is not a known push service's (${hostOf(endpoint)}); see webPush.pushServices`
        );
        return { delivered: false, reason: 'UnlistedPushService' };
      }
      // Not a usable subscription: nothing will ever deliver to it, so do not retry into it
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
    if (payload.length > MAX_PLAINTEXT_BYTES) {
      // The same template renders the same size on every attempt: settle it before encrypting
      throw new PermanentError(
        `[webpush] payload for template '${message.template}' is ${payload.length} bytes; a push message carries at most ${MAX_PLAINTEXT_BYTES}`,
        { reason: 'PayloadTooLarge' }
      );
    }
    const body = await encryptPayload(payload, subscription.p256dh, subscription.auth);
    const doFetch = this.options.fetch ?? fetch;
    const response = await doFetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        authorization: await this.options.credentials.authorization(subscription.endpoint),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(this.options.ttl ?? 86_400),
        urgency: 'normal',
        // A resend of the same copy replaces the first one while it is still queued (RFC 8030
        // §5.4), so an at-least-once retry does not show the notification twice
        topic: await webPushTopic(message.idempotencyKey),
      },
      body,
    });
    if (response.ok) return;
    const { status } = response;
    if (status === 404 || status === 410) {
      // The browser unsubscribed or the subscription expired: it will never deliver again
      console.warn(`[webpush] subscription gone for user ${message.userId}: ${status}`);
      return { delivered: false, reason: status === 410 ? 'Gone' : 'NotFound' };
    }
    const text = await response.text();
    if (isRetryableStatus(status)) throw new Error(`[webpush] ${status}: ${text}`);
    // Not a refusal at all (a redirect the fetch did not follow): nothing a device can explain
    if (status < 400) {
      throw new PermanentError(`[webpush] unexpected answer from the push service: ${status}`, {
        reason: `http_${status}`,
      });
    }
    // This subscription, or this sender: the answer does not say. Settled with the device kept,
    // and loud — if it is the VAPID key, every subscription answers so
    console.error(
      `[webpush] push service refused the request for user ${message.userId}: ${status} ${text}`
    );
    return { delivered: false, reason: `Refused${status}` };
  }
}

/**
 * The `Topic` header for one copy: RFC 8030 §5.4 allows at most 32 characters of the URL-safe
 * base64 alphabet, so the idempotency key goes through SHA-256 and is cut to size.
 */
export async function webPushTopic(idempotencyKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(idempotencyKey));
  return base64url(new Uint8Array(digest)).slice(0, 32);
}
