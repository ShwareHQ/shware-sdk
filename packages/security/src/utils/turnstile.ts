import { permissionDenied, unavailable } from '../auth/respond';

/** Cloudflare's siteverify endpoint, the default `siteverifyUrl`. */
export const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** How long siteverify gets to answer before the verification counts as unavailable. */
const TIMEOUT_MS = 5000;

export interface VerifyTurnstileTokenOptions {
  /** The widget's secret key (Cloudflare dashboard → Turnstile → the widget → Secret key). */
  secret: string;
  /** The token the widget handed the client (`cf-turnstile-response`, or `turnstileToken`). */
  token: string;
  /**
   * The visitor's IP address, sent as `remoteip` so Cloudflare can check the token was solved from
   * the same address. Behind Cloudflare that is the `CF-Connecting-IP` header, which the edge sets
   * and overwrites; omit it (or pass `undefined`) when the address is not known.
   */
  remoteIp?: string | null;
  /**
   * The hostname(s) the widget may have been solved on. When given, a token whose siteverify
   * `hostname` is not one of them fails verification (a token solved on another site that uses
   * the same widget). Unchecked by default.
   */
  hostname?: string | readonly string[];
  /**
   * The `action` the widget was rendered with (`data-action`). When given, a token carrying another
   * action fails verification (a token solved for one form replayed against another). Unchecked
   * by default.
   */
  action?: string;
  /**
   * The siteverify endpoint; default Cloudflare's (`TURNSTILE_SITEVERIFY_URL`). Point it at your
   * configured Turnstile origin, or at a stub in tests.
   */
  siteverifyUrl?: string | URL;
}

interface SiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
  hostname?: string;
  action?: string;
}

/**
 * Verifies a Cloudflare Turnstile token with siteverify, resolving when the challenge was passed.
 * It throws one of two errors, which `errorResponse` turns into the google.rpc body every `Auth`
 * route answers with:
 *
 * - `403 PERMISSION_DENIED`, reason `TURNSTILE_VERIFICATION_FAILED`: the challenge was not passed.
 *   siteverify answered `success: false` (an invalid, expired or already spent token), or the
 *   `hostname` / `action` it reports is not the one expected. The client gets a fresh token and
 *   tries again.
 * - `503 UNAVAILABLE`, reason `TURNSTILE_UNAVAILABLE`: siteverify could not be asked. It answered
 *   a non-2xx status or a body without a boolean `success`, did not answer within 5 seconds, or
 *   the request failed. Not the visitor's fault; retry later.
 *
 * Both are logged (`console.warn` with siteverify's error codes, `console.error` with the cause);
 * the response carries neither.
 */
export async function verifyTurnstileToken({
  secret,
  token,
  remoteIp,
  hostname,
  action,
  siteverifyUrl = TURNSTILE_SITEVERIFY_URL,
}: VerifyTurnstileTokenOptions): Promise<void> {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);

  let data: SiteverifyResponse;
  try {
    const response = await fetch(siteverifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`siteverify answered ${response.status}`);
    const json = (await response.json()) as Partial<SiteverifyResponse> | null;
    if (typeof json?.success !== 'boolean') {
      throw new TypeError('siteverify answered without a boolean `success`');
    }
    data = json as SiteverifyResponse;
  } catch (error) {
    console.error('Turnstile siteverify unavailable', error);
    throw unavailable(
      'TURNSTILE_UNAVAILABLE',
      'Security verification is unavailable, please try again'
    );
  }

  const failure = failureOf(data, hostname, action);
  if (!failure) return;
  console.warn('Turnstile verification failed', failure);
  throw permissionDenied('TURNSTILE_VERIFICATION_FAILED', 'Turnstile verification failed');
}

/** Why a token siteverify answered for did not pass, as log lines, or `null` when it did. */
function failureOf(
  data: SiteverifyResponse,
  hostname: string | readonly string[] | undefined,
  action: string | undefined
): string[] | null {
  if (!data.success) return data['error-codes'] ?? [];
  const hostnames = typeof hostname === 'string' ? [hostname] : hostname;
  if (hostnames && !hostnames.includes(data.hostname ?? '')) {
    return [`hostname-mismatch: ${data.hostname ?? '(none)'}`];
  }
  if (action !== undefined && data.action !== action) {
    return [`action-mismatch: ${data.action ?? '(none)'}`];
  }
  return null;
}
