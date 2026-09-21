import type { MessageSender, OutboundMessage } from './engine/ports';
import type { PushRenderer } from './push';

/**
 * `@shware/workflow/fcm` — push delivery through Firebase Cloud Messaging's
 * HTTP v1 API, from a service account. No dependencies: the OAuth2 access
 * token is minted by signing a JWT with WebCrypto (Workers, Node 20+, Deno,
 * Bun), so this runs wherever the engine runs.
 *
 * The recipient is the FCM registration token the engine resolved from the
 * user's `push_token` property — the app registers it when the user grants
 * notification permission, the producer identifies it to the journey store.
 */

/** The fields of a Google service-account JSON this sender needs. */
export interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  /** PEM, `-----BEGIN PRIVATE KEY-----` (PKCS #8). */
  private_key: string;
  token_uri?: string;
}

export interface FcmPushOptions {
  serviceAccount: FcmServiceAccount;
  render: PushRenderer;
  /** Android-specific delivery options, e.g. `{ channel_id: 'default' }` (FCM v1 `android.notification`). */
  android?: Record<string, unknown>;
  /** APNs-specific payload options merged into `aps`, e.g. `{ sound: 'default' }`. */
  apns?: Record<string, unknown>;
  /** Fetch implementation (defaults to the global one). */
  fetch?: typeof fetch;
  /** Called for a token FCM reports as gone (`UNREGISTERED`); the producer should drop that subscription. */
  onUnregistered?: (message: OutboundMessage) => Promise<void> | void;
}

/** Errors FCM reports for a token that will never deliver again — not worth a retry. */
const DEAD_TOKEN_CODES = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH']);

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

export class FcmPushSender implements MessageSender {
  private token: { value: string; expiresAt: number } | undefined;

  constructor(private readonly options: FcmPushOptions) {}

  async send(message: OutboundMessage): Promise<void> {
    if (message.channel !== 'push') {
      throw new Error(`FcmPushSender: unsupported channel '${message.channel}'`);
    }
    if (message.recipient === undefined) {
      throw new Error(`FcmPushSender: no push token for user '${message.userId}'`);
    }
    const { title, body, image } = await this.options.render(message.template, message.props);
    const { serviceAccount, android, apns } = this.options;
    const doFetch = this.options.fetch ?? fetch;

    const response = await doFetch(
      `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.accessToken()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: message.recipient,
            notification: { title, body, ...(image === undefined ? {} : { image }) },
            // The template key travels as data so the app can route a tap; the
            // idempotency key lets the app de-duplicate a redelivered push.
            data: { template: message.template, idempotencyKey: message.idempotencyKey },
            ...(android === undefined ? {} : { android: { notification: android } }),
            apns: { payload: { aps: { sound: 'default', ...apns } } },
          },
        }),
      }
    );
    if (response.ok) return;

    const text = await response.text();
    if (DEAD_TOKEN_CODES.has(fcmErrorCode(text))) {
      // A dead token is a fact about the recipient, not a transient failure:
      // report it and move on, so the step does not retry into the same wall.
      console.warn(`[fcm] token gone for user ${message.userId}: ${fcmErrorCode(text)}`);
      await this.options.onUnregistered?.(message);
      return;
    }
    throw new Error(`FCM send failed: ${response.status} ${text}`);
  }

  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.token !== undefined && this.token.expiresAt - 60_000 > now) return this.token.value;

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
      throw new Error(`FCM token exchange failed: ${response.status} ${await response.text()}`);
    }
    const json = (await response.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: now + json.expires_in * 1000 };
    return json.access_token;
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

const base64url = (bytes: Uint8Array | string): string => {
  const raw = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

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

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Parse the service-account JSON as it is usually shipped: base64 of the file, in one secret. */
export function serviceAccountFromBase64(value: string): FcmServiceAccount {
  const json = JSON.parse(atob(value)) as Partial<FcmServiceAccount>;
  if (!json.project_id || !json.client_email || !json.private_key) {
    throw new Error('service account JSON is missing project_id, client_email or private_key');
  }
  return json as FcmServiceAccount;
}
