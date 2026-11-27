import { Buffer } from 'node:buffer';
import type { MessageSender, OutboundMessage, SendResult } from './engine';
import { PermanentError, isRetryableStatus } from './engine/retry';
import { base64url, pemToDer } from './jwt';
import type { PushRenderer } from './push';

/**
 * `@shware/workflow/apns` — iOS push delivery straight to the Apple Push
 * Notification service, token-based (an APNs auth key, the `.p8` file from the
 * developer portal). No Firebase in between: the app registers the APNs device
 * token in its own device table, and the host's DeviceDirectory hands it to the
 * engine, which sends one message per device.
 * No dependencies: the provider JWT is ES256-signed with WebCrypto.
 *
 * APNs speaks HTTP/2 only. A deployed Worker's `fetch` negotiates it, but
 * workerd under `wrangler dev` does not (the connection is dropped), so a local
 * host points `origin` at the Node relay in `@shware/workflow/apns-relay`.
 */

/** The APNs auth key — the `.p8` file from the developer portal, and the ids that name it. */
export interface ApnsProviderTokenOptions {
  /** The key's 10-character id, shown next to it in the developer portal. */
  keyId: string;
  /** The Apple Developer team id. */
  teamId: string;
  /** The `.p8` file's contents: PEM, `-----BEGIN PRIVATE KEY-----` (PKCS #8, P-256). */
  privateKey: string;
}

export interface ApnsPushOptions {
  /** The provider token the requests are signed with — shared by every sender on the same key. */
  credentials: ApnsProviderToken;
  /** The app's bundle id — APNs's `apns-topic`. */
  topic: string;
  /**
   * Which APNs environment the device tokens come from: `sandbox` for builds
   * signed with `aps-environment: development` (Xcode, the simulator),
   * `production` for App Store and TestFlight builds. A token from one is
   * `BadDeviceToken` on the other.
   */
  environment: 'sandbox' | 'production';
  render: PushRenderer;
  /**
   * POST here instead of Apple's host — the dev relay, which forwards over
   * HTTP/2. The real host still travels along (`apns-relay-upstream`), so the
   * relay needs no configuration of its own.
   */
  origin?: string;
  /** Fetch implementation (defaults to the global one). */
  fetch?: typeof fetch;
}

export const APNS_HOSTS = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
} as const;

/**
 * How an APNs answer is classified, after Apple's response table
 * (https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns):
 *
 * - dead token: HTTP 410 `Unregistered` (the app was removed, or the token is inactive for the
 *   topic) and 400 `ExpiredToken`. The device will never deliver again, so the copy settles
 *   undelivered and the host forgets the token.
 * - undelivered, device kept: 400 `BadDeviceToken` and 400 `DeviceTokenNotForTopic`. Apple gives
 *   the first for a malformed token but just as well for a token of the other environment (a
 *   sandbox build pushed through the production host), and the second for a token of another
 *   app (another bundle id: a development build registered against this backend). Either is
 *   about this one device — unless the deployment's own environment or topic is wrong, when
 *   every device answers so. The copy settles with the reason, so the report shows it; nothing
 *   is deleted on a guess, and the user's other devices and the rest of the journey go on.
 * - configuration: the topic, certificate or provider key is wrong. Every device on this app
 *   would answer the same, so it is a `PermanentError` and the devices are kept — they are fine,
 *   the deployment is not.
 * - transient: 429 (`TooManyRequests`, `TooManyProviderTokenUpdates`), 5xx (`InternalServerError`,
 *   `ServiceUnavailable`, `Shutdown`) and 403 `ExpiredProviderToken`, which a fresh token fixes.
 * - everything else (400 `BadMessageId`, `BadPriority`, `PayloadEmpty`, 413 `PayloadTooLarge`,
 *   404 `BadPath`, 405 `MethodNotAllowed`, …) is this request itself: a `PermanentError`.
 */
export const DEAD_TOKEN_REASONS: ReadonlySet<string> = new Set(['Unregistered', 'ExpiredToken']);

/** This one token is refused, and may be fine elsewhere: the copy settles and the device is kept. */
const DEVICE_REASONS: ReadonlySet<string> = new Set(['BadDeviceToken', 'DeviceTokenNotForTopic']);

/** The app's topic, certificate or provider key is wrong: the request is refused for every device. */
const CONFIGURATION_REASONS: ReadonlySet<string> = new Set([
  'TopicDisallowed',
  'BadTopic',
  'MissingTopic',
  'BadCertificate',
  'BadCertificateEnvironment',
  'Forbidden',
  'InvalidProviderToken',
  'MissingProviderToken',
]);

/**
 * The copy's identity on the wire: a canonical UUID derived from the idempotency key (SHA-256, the
 * first 16 bytes laid out as an RFC 9562 v8 UUID). The same on every attempt, so a resend of the
 * same copy carries the same `apns-id` and — as `apns-collapse-id`, which is limited to 64 bytes —
 * collapses onto the first notification. The whole key is hashed: cut to 64 bytes it would lose
 * the node id at its end, and two nodes of one instance would collapse into one notification.
 */
export async function apnsIdFromKey(idempotencyKey: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(idempotencyKey))
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80; // version 8: custom, deterministic
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Apple: reuse a provider token for at least 20 minutes, never past 60. */
const TOKEN_TTL_MS = 50 * 60_000;

/**
 * The provider JWT for one APNs auth key, signed once and reused for `TOKEN_TTL_MS`: Apple
 * answers a sender that re-signs on every push with 429 `TooManyProviderTokenUpdates`. Concurrent
 * callers on a fresh or aged token share the one signing in flight, and a signing that failed is
 * not kept, so the next call tries again. One instance serves every sender built on the key — a
 * host keeps it across runs, and builds the senders per run.
 */
export class ApnsProviderToken {
  private signed: { value: string; issuedAt: number } | undefined;
  private signing: Promise<string> | undefined;

  constructor(private readonly options: ApnsProviderTokenOptions) {}

  /** The current token, signed now if there is none or it has aged out. */
  async token(now = Date.now()): Promise<string> {
    if (this.signed !== undefined && now - this.signed.issuedAt < TOKEN_TTL_MS) {
      return this.signed.value;
    }
    this.signing ??= signApnsJwt(this.options, now)
      .then((value) => {
        this.signed = { value, issuedAt: now };
        return value;
      })
      .finally(() => {
        this.signing = undefined;
      });
    return this.signing;
  }

  /** Forget the token: APNs refused it (`ExpiredProviderToken`), so the next call signs a new one. */
  invalidate(): void {
    this.signed = undefined;
  }
}

export class ApnsPushSender implements MessageSender {
  constructor(private readonly options: ApnsPushOptions) {}

  async send(message: OutboundMessage): Promise<void | SendResult> {
    if (message.channel !== 'push') {
      throw new Error(`ApnsPushSender: unsupported channel '${message.channel}'`);
    }
    if (message.recipient === undefined) {
      throw new Error(`ApnsPushSender: no push token for user '${message.userId}'`);
    }
    const { title, body, image, url } = await this.options.render(message.template, message.props);
    // A notification service extension runs only for a mutable push: it attaches the image and
    // reports the device delivery (`delivered_url`)
    const mutable = image !== undefined || message.tracking?.data?.delivered_url !== undefined;
    const upstream = APNS_HOSTS[this.options.environment];
    const origin = this.options.origin ?? upstream;
    const doFetch = this.options.fetch ?? fetch;

    const copyId = await apnsIdFromKey(message.idempotencyKey);
    const response = await doFetch(`${origin}/3/device/${message.recipient}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${await this.options.credentials.token()}`,
        'apns-topic': this.options.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        // A resend of the same copy (an at-least-once retry after APNs accepted the first attempt)
        // carries the same id and collapses onto the first notification instead of showing twice
        'apns-id': copyId,
        'apns-collapse-id': copyId,
        'content-type': 'application/json',
        ...(this.options.origin === undefined ? {} : { 'apns-relay-upstream': upstream }),
      },
      body: JSON.stringify({
        aps: {
          alert: { title, body },
          sound: 'default',
          ...(mutable ? { 'mutable-content': 1 } : {}),
        },
        // The template key travels so the app can route a tap; the idempotency
        // key lets the app de-duplicate a redelivered push.
        template: message.template,
        idempotencyKey: message.idempotencyKey,
        ...(image === undefined ? {} : { image }),
        ...(url === undefined ? {} : { url }),
        ...message.tracking?.data,
      }),
    });
    if (response.ok) return;

    const text = await response.text();
    const { status } = response;
    // A 410 without a body is still "unregistered": settle it under that reason
    const reason = apnsReason(text) || (status === 410 ? 'Unregistered' : '');
    if (status === 410 || DEAD_TOKEN_REASONS.has(reason)) {
      // A dead token is a fact about the recipient, not a transient failure:
      // report it and move on, so the step does not retry into the same wall.
      console.warn(`[apns] token gone for user ${message.userId}: ${reason}`);
      return { delivered: false, reason };
    }
    if (DEVICE_REASONS.has(reason)) {
      // The token, its environment or its app: settled so the report says which device, nothing
      // deleted, and one device's refusal does not end the journey for the others
      console.warn(`[apns] refused for user ${message.userId}: ${status} ${reason}`);
      return { delivered: false, reason };
    }
    if (reason === 'ExpiredProviderToken') {
      // The token aged out (clock skew, a long-lived isolate): sign a new one on the retry
      this.options.credentials.invalidate();
      throw new Error(
        `APNs send failed: ${status} ${reason} (provider token renewed for the retry)`
      );
    }
    if (CONFIGURATION_REASONS.has(reason)) {
      throw new PermanentError(
        `APNs refused the request for topic '${this.options.topic}' (${this.options.environment}): ${status} ${reason}`,
        { reason }
      );
    }
    if (isRetryableStatus(status)) {
      throw new Error(`APNs send failed: ${status} ${reason || text}`);
    }
    throw new PermanentError(`APNs refused the request: ${status} ${reason || text}`, {
      reason: reason || `Refused${status}`,
    });
  }
}

/** APNs error bodies are `{ "reason": "…" }`. */
export function apnsReason(body: string): string {
  try {
    const parsed = JSON.parse(body) as { reason?: string };
    return parsed.reason ?? '';
  } catch {
    return '';
  }
}

/** ES256-sign the APNs provider token: header `kid`, claims `iss` (team) and `iat`. */
export async function signApnsJwt(
  key: ApnsProviderTokenOptions,
  nowMs = Date.now()
): Promise<string> {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: key.keyId }));
  const claims = base64url(JSON.stringify({ iss: key.teamId, iat: Math.floor(nowMs / 1000) }));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(key.privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  // WebCrypto's ECDSA signature is the raw r‖s pair, which is exactly JWS's ES256 encoding.
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(`${header}.${claims}`)
  );
  return `${header}.${claims}.${base64url(new Uint8Array(signature))}`;
}

/** The `.p8` as it is usually shipped in a secret: base64 of the file. */
export function apnsKeyFromBase64(value: string): string {
  let pem: string;
  try {
    pem = Buffer.from(value, 'base64').toString();
  } catch (error) {
    // A secret that is not base64 is the same on every attempt: not worth a retry
    throw new PermanentError('APNs key is not base64 (expected the .p8 file, base64-encoded)', {
      reason: 'bad_credentials',
      cause: error,
    });
  }
  if (!pem.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new PermanentError('APNs key is not a PKCS #8 PEM (.p8) file', {
      reason: 'bad_credentials',
    });
  }
  return pem;
}
