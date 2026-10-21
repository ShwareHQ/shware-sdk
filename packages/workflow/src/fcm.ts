import type { MessageSender, OutboundMessage, SendResult } from './engine';
import { PermanentError, isRetryableStatus } from './engine/retry';
import { base64url, pemToDer } from './jwt';
import type { PushRenderer } from './push';

/**
 * `@shware/workflow/fcm` — push delivery through Firebase Cloud Messaging's
 * HTTP v1 API, from a service account. No dependencies: the OAuth2 access
 * token is minted by signing a JWT with WebCrypto (Workers, Node 20+, Deno,
 * Bun), so this runs wherever the engine runs.
 *
 * The recipient is an FCM registration token the app registered for the user
 * (`registerDevice`); the engine sends one message per device.
 */

/** The fields of a Google service-account JSON this sender needs. */
export interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  /** PEM, `-----BEGIN PRIVATE KEY-----` (PKCS #8). */
  private_key: string;
  token_uri?: string;
}

export interface FcmAccessTokenOptions {
  serviceAccount: FcmServiceAccount;
  /** Fetch implementation for the token exchange (defaults to the global one). */
  fetch?: typeof fetch;
}

export interface FcmPushOptions {
  /** The access token the requests carry — shared by every sender on the same service account. */
  credentials: FcmAccessToken;
  render: PushRenderer;
  /** Android-specific delivery options, e.g. `{ channel_id: 'default' }` (FCM v1 `android.notification`). */
  android?: Record<string, unknown>;
  /** APNs-specific payload options merged into `aps`, e.g. `{ sound: 'default' }`. */
  apns?: Record<string, unknown>;
  /** Fetch implementation (defaults to the global one). */
  fetch?: typeof fetch;
}

/**
 * How an FCM v1 answer is classified, after the API's error codes
 * (https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode):
 *
 * - dead token: 404 `UNREGISTERED` (the app was uninstalled, or the token expired) — also a 404
 *   whose only code is the gRPC status `NOT_FOUND`. The copy settles undelivered and the host
 *   forgets the token.
 * - undelivered, device kept: 400 `INVALID_ARGUMENT`. FCM gives it for a malformed token but
 *   just as well for a payload problem (a message too big, a bad data key, a bad TTL), which
 *   would hit every device of the template at once; the copy settles with the reason, so the
 *   report shows it, and nothing is deleted on a guess.
 * - configuration: 403 `SENDER_ID_MISMATCH` (the token belongs to another Firebase project) and
 *   401 `THIRD_PARTY_AUTH_ERROR` (the APNs or web push credentials in the Firebase project):
 *   `PermanentError`, devices kept.
 * - transient: 401 `UNAUTHENTICATED` (the cached access token is dropped first), 429
 *   `QUOTA_EXCEEDED`, 503 `UNAVAILABLE`, 500 `INTERNAL` and any other 429 / 5xx.
 * - everything else (another 4xx) is this request itself: a `PermanentError`.
 */
export const DEAD_TOKEN_REASONS: ReadonlySet<string> = new Set(['UNREGISTERED', 'NOT_FOUND']);

const CONFIGURATION_CODES: ReadonlySet<string> = new Set([
  'SENDER_ID_MISMATCH',
  'THIRD_PARTY_AUTH_ERROR',
]);
const TRANSIENT_CODES: ReadonlySet<string> = new Set(['QUOTA_EXCEEDED', 'UNAVAILABLE', 'INTERNAL']);

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/**
 * The OAuth2 access token for one service account, exchanged once and reused until a minute
 * before it expires. Concurrent callers without a usable token share the one exchange in flight,
 * and an exchange that failed is not kept, so the next call tries again. One instance serves every
 * sender built on the account — a host keeps it across runs, and builds the senders per run.
 */
export class FcmAccessToken {
  /** The Firebase project the account belongs to — the `messages:send` URL names it. */
  readonly projectId: string;
  private minted: { value: string; expiresAt: number } | undefined;
  private minting: Promise<string> | undefined;

  constructor(private readonly options: FcmAccessTokenOptions) {
    this.projectId = options.serviceAccount.project_id;
  }

  /** The current token, exchanged now if there is none or it is about to expire. */
  async token(now = Date.now()): Promise<string> {
    if (this.minted !== undefined && this.minted.expiresAt - 60_000 > now) {
      return this.minted.value;
    }
    this.minting ??= this.exchange(now)
      .then((minted) => {
        this.minted = minted;
        return minted.value;
      })
      .finally(() => {
        this.minting = undefined;
      });
    return this.minting;
  }

  /** Forget the token: FCM refused it (401), so the next call exchanges a new one. */
  invalidate(): void {
    this.minted = undefined;
  }

  private async exchange(now: number): Promise<{ value: string; expiresAt: number }> {
    const { serviceAccount } = this.options;
    const tokenUri = serviceAccount.token_uri ?? 'https://oauth2.googleapis.com/token';
    const assertion = await signJwt(serviceAccount, tokenUri, SCOPE, now);
    const doFetch = this.options.fetch ?? fetch;
    const response = await doFetch(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!response.ok) {
      const detail = `${response.status} ${await response.text()}`;
      // A 4xx from the token endpoint (`invalid_grant`: the key was revoked, `invalid_client`)
      // is the service account itself; only a throttled or failing endpoint is worth a retry
      if (isRetryableStatus(response.status)) {
        throw new Error(`FCM token exchange failed: ${detail}`);
      }
      throw new PermanentError(
        `FCM token exchange refused for '${serviceAccount.client_email}': ${detail}`
      );
    }
    const json = (await response.json()) as { access_token: string; expires_in: number };
    return { value: json.access_token, expiresAt: now + json.expires_in * 1000 };
  }
}

export class FcmPushSender implements MessageSender {
  constructor(private readonly options: FcmPushOptions) {}

  async send(message: OutboundMessage): Promise<void | SendResult> {
    if (message.channel !== 'push') {
      throw new Error(`FcmPushSender: unsupported channel '${message.channel}'`);
    }
    if (message.recipient === undefined) {
      throw new Error(`FcmPushSender: no push token for user '${message.userId}'`);
    }
    const { title, body, image, url } = await this.options.render(message.template, message.props);
    const { credentials, android, apns } = this.options;
    const doFetch = this.options.fetch ?? fetch;

    const response = await doFetch(
      `https://fcm.googleapis.com/v1/projects/${credentials.projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await credentials.token()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: message.recipient,
            notification: { title, body, ...(image === undefined ? {} : { image }) },
            // The template key travels as data so the app can route a tap; the
            // idempotency key lets the app de-duplicate a redelivered push.
            data: {
              template: message.template,
              idempotencyKey: message.idempotencyKey,
              ...(url === undefined ? {} : { url }),
              ...message.tracking?.data,
            },
            ...(android === undefined ? {} : { android: { notification: android } }),
            apns: { payload: { aps: { sound: 'default', ...apns } } },
          },
        }),
      }
    );
    if (response.ok) return;

    const text = await response.text();
    const { status } = response;
    const code = fcmErrorCode(text);
    if (code === 'UNREGISTERED' || (status === 404 && DEAD_TOKEN_REASONS.has(code))) {
      // A dead token is a fact about the recipient, not a transient failure:
      // report it and move on, so the step does not retry into the same wall.
      console.warn(`[fcm] token gone for user ${message.userId}: ${code}`);
      return { delivered: false, reason: code };
    }
    if (code === 'INVALID_ARGUMENT') {
      // The token or our payload: settled so the report says which device, nothing deleted
      console.warn(`[fcm] refused for user ${message.userId}: ${status} ${text}`);
      return { delivered: false, reason: code };
    }
    if (CONFIGURATION_CODES.has(code)) {
      throw new PermanentError(
        `FCM refused the request for project '${credentials.projectId}': ${status} ${code}`
      );
    }
    if (status === 401 || code === 'UNAUTHENTICATED') {
      // The access token was revoked before it expired: mint a new one on the retry
      credentials.invalidate();
      throw new Error(
        `FCM send failed: ${status} ${code || text} (access token renewed for the retry)`
      );
    }
    if (TRANSIENT_CODES.has(code) || isRetryableStatus(status)) {
      throw new Error(`FCM send failed: ${status} ${code || text}`);
    }
    throw new PermanentError(`FCM refused the request: ${status} ${code || text}`);
  }
}

/** FCM v1 error bodies carry the code at `error.status` and, for messaging, in `error.details[].errorCode`. */
export function fcmErrorCode(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { status?: string; details?: { errorCode?: string }[] };
    };
    const detail = parsed.error?.details?.find((d) => d.errorCode !== undefined)?.errorCode;
    return detail ?? parsed.error?.status ?? '';
  } catch {
    return '';
  }
}

/** RS256-sign the OAuth2 JWT assertion for a service account. */
export async function signJwt(
  account: FcmServiceAccount,
  audience: string,
  scope: string,
  nowMs = Date.now()
): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({ iss: account.client_email, scope, aud: audience, iat, exp: iat + 3600 })
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${claims}`)
  );
  return `${header}.${claims}.${base64url(new Uint8Array(signature))}`;
}

/** Parse the service-account JSON as it is usually shipped: base64 of the file, in one secret. */
export function serviceAccountFromBase64(value: string): FcmServiceAccount {
  let json: Partial<FcmServiceAccount>;
  try {
    json = JSON.parse(atob(value)) as Partial<FcmServiceAccount>;
  } catch (error) {
    // A secret that is not base64 JSON is the same on every attempt: not worth a retry
    throw new PermanentError('service account is not base64-encoded JSON', { cause: error });
  }
  if (!json.project_id || !json.client_email || !json.private_key) {
    throw new PermanentError(
      'service account JSON is missing project_id, client_email or private_key'
    );
  }
  return json as FcmServiceAccount;
}
