import type { MessageSender, OutboundMessage } from './engine/ports';
import { base64url, pemToDer } from './jwt';
import type { PushRenderer } from './push';

/**
 * `@shware/workflow/apns` — iOS push delivery straight to the Apple Push
 * Notification service, token-based (an APNs auth key, the `.p8` file from the
 * developer portal). No Firebase in between: the app registers the APNs device
 * token itself and the producer identifies it as the profile's `push_token`.
 * No dependencies: the provider JWT is ES256-signed with WebCrypto.
 *
 * APNs speaks HTTP/2 only. A deployed Worker's `fetch` negotiates it, but
 * workerd under `wrangler dev` does not (the connection is dropped), so a local
 * host points `origin` at the Node relay in `@shware/workflow/apns-relay`.
 */

export interface ApnsPushOptions {
  /** The key's 10-character id, shown next to it in the developer portal. */
  keyId: string;
  /** The Apple Developer team id. */
  teamId: string;
  /** The `.p8` file's contents: PEM, `-----BEGIN PRIVATE KEY-----` (PKCS #8, P-256). */
  privateKey: string;
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
  /** Called for a token APNs reports as gone (`Unregistered`, `BadDeviceToken`); the producer should drop that subscription. */
  onUnregistered?: (message: OutboundMessage) => Promise<void> | void;
}

export const APNS_HOSTS = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
} as const;

/** Reasons APNs gives for a token that will never deliver again — not worth a retry. */
const DEAD_TOKEN_REASONS = new Set([
  'Unregistered',
  'BadDeviceToken',
  'DeviceTokenNotForTopic',
  'ExpiredToken',
]);

/** Apple: reuse a provider token for at least 20 minutes, never past 60. */
const TOKEN_TTL_MS = 50 * 60_000;

export class ApnsPushSender implements MessageSender {
  private token: { value: string; issuedAt: number } | undefined;

  constructor(private readonly options: ApnsPushOptions) {}

  async send(message: OutboundMessage): Promise<void> {
    if (message.channel !== 'push') {
      throw new Error(`ApnsPushSender: unsupported channel '${message.channel}'`);
    }
    if (message.recipient === undefined) {
      throw new Error(`ApnsPushSender: no push token for user '${message.userId}'`);
    }
    const { title, body, image } = await this.options.render(message.template, message.props);
    const upstream = APNS_HOSTS[this.options.environment];
    const origin = this.options.origin ?? upstream;
    const doFetch = this.options.fetch ?? fetch;

    const response = await doFetch(`${origin}/3/device/${message.recipient}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${await this.providerToken()}`,
        'apns-topic': this.options.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
        ...(this.options.origin === undefined ? {} : { 'apns-relay-upstream': upstream }),
      },
      body: JSON.stringify({
        aps: {
          alert: { title, body },
          sound: 'default',
          // A notification service extension is what attaches the image; the flag lets it run.
          ...(image === undefined ? {} : { 'mutable-content': 1 }),
        },
        // The template key travels so the app can route a tap; the idempotency
        // key lets the app de-duplicate a redelivered push.
        template: message.template,
        idempotencyKey: message.idempotencyKey,
        ...(image === undefined ? {} : { image }),
      }),
    });
    if (response.ok) return;

    const text = await response.text();
    const reason = apnsReason(text);
    if (response.status === 410 || DEAD_TOKEN_REASONS.has(reason)) {
      // A dead token is a fact about the recipient, not a transient failure:
      // report it and move on, so the step does not retry into the same wall.
      console.warn(`[apns] token gone for user ${message.userId}: ${reason || response.status}`);
      await this.options.onUnregistered?.(message);
      return;
    }
    throw new Error(`APNs send failed: ${response.status} ${text}`);
  }

  private async providerToken(): Promise<string> {
    const now = Date.now();
    if (this.token !== undefined && now - this.token.issuedAt < TOKEN_TTL_MS) {
      return this.token.value;
    }
    const value = await signApnsJwt(this.options, now);
    this.token = { value, issuedAt: now };
    return value;
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
  key: Pick<ApnsPushOptions, 'keyId' | 'teamId' | 'privateKey'>,
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
  const pem = atob(value);
  if (!pem.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error('APNs key is not a PKCS #8 PEM (.p8) file');
  }
  return pem;
}
