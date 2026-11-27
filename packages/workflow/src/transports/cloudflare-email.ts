import { mimeAddress } from '../email';
import type { EmailMessage, EmailTransport } from '../email-sender';
import { awaitAnswer, isRetryableStatus } from '../engine/retry';
import type { EmailAddress } from '../template-rules';

/**
 * `@shware/workflow/transports/cloudflare-email` — Cloudflare Email Service, through the
 * Worker's `send_email` binding or, from anywhere else (a Lambda), its REST API. Both take the
 * same finished email; only the call and the way each reports a failure differ.
 */

/**
 * Cloudflare Email Service's send_email binding (structural subset).
 *
 * `idempotencyKey` is part of the call for the host's own use (a log line, a header, a
 * fallback transport that can take one): Cloudflare's `send_email` binding itself accepts no
 * idempotency key or client message id and does not de-duplicate — `send()` takes only the
 * addresses, subject, body, headers and attachments, and returns a server-generated messageId.
 * A repeat is prevented upstream: the engine claims a copy before the send and does not send a
 * claimed copy again (see `OutboundMessage.redelivery`).
 */
export interface EmailBindingLike {
  send(message: {
    from: EmailAddress;
    to: EmailAddress;
    replyTo?: EmailAddress;
    subject: string;
    html: string;
    /** List-Unsubscribe and List-Unsubscribe-Post, when the email has an unsubscribe link. */
    headers?: Readonly<Record<string, string>>;
    /** `${instanceId}:${nodeId}`: stable across replays and retries. Cloudflare ignores it; carried for the host's logs or a transport that can use it. */
    idempotencyKey: string;
  }): Promise<unknown>;
}

export type CloudflareEmailTransportOptions =
  | {
      /** The Worker's `send_email` binding. */
      binding: EmailBindingLike;
      accountId?: never;
      apiToken?: never;
    }
  | {
      binding?: never;
      accountId: string;
      /** An API token allowed to send email for the account. */
      apiToken: string;
      /** Defaults to `https://api.cloudflare.com/client/v4`. */
      endpoint?: string;
      fetch?: typeof fetch;
    };

/** The REST API refused the email: `errors` are Cloudflare's `{ code, message }` pairs. */
export class CloudflareEmailError extends Error {
  override readonly name = 'CloudflareEmailError';
  /** A refused request (bad token, invalid schema) fails the same way every time. */
  readonly retryable: boolean;
  /** What a refused email settles under in the delivery report: Cloudflare's first error code, else the status. */
  readonly reason: string;
  constructor(
    readonly status: number,
    readonly errors: readonly { code?: number; message?: string }[]
  ) {
    const said = errors.map((e) => `${e.code ?? '?'} ${e.message ?? ''}`.trim()).join('; ');
    super(`Cloudflare Email send failed (${status})${said === '' ? '' : `: ${said}`}`);
    // A 200 with `success: false` says nothing about retrying: treat it as transient
    this.retryable = status < 400 || isRetryableStatus(status);
    const code = errors[0]?.code;
    this.reason = code === undefined ? `http_${status}` : `cloudflare_${code}`;
  }
}

export function cloudflareEmailTransport(options: CloudflareEmailTransportOptions): EmailTransport {
  if (options.binding !== undefined) {
    const { binding } = options;
    return {
      async send(message) {
        // The key goes along, but Cloudflare does not de-duplicate on it: `send()` takes no
        // idempotency key or client message id (its result carries a server-generated
        // messageId). A repeat is prevented upstream, by the engine's claim (see deliver)
        const result: unknown = await binding.send(message);
        const id = (result as { messageId?: unknown } | null | undefined)?.messageId;
        return typeof id === 'string' ? { providerMessageId: id } : {};
      },
    };
  }
  // Checked at runtime too: a JS caller can pass neither
  const given = options as { accountId?: unknown; apiToken?: unknown };
  if (typeof given.accountId !== 'string' || typeof given.apiToken !== 'string') {
    throw new TypeError('cloudflareEmailTransport needs { binding } or { accountId, apiToken }');
  }
  const { accountId, apiToken } = options;
  const endpoint = (options.endpoint ?? 'https://api.cloudflare.com/client/v4').replace(/\/$/, '');
  const fetchImpl = options.fetch ?? fetch;
  return {
    async send(message: EmailMessage) {
      const response = await awaitAnswer('Cloudflare Email send', () =>
        fetchImpl(`${endpoint}/accounts/${encodeURIComponent(accountId)}/email/sending/send`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: mimeAddress(message.from),
            to: message.to,
            ...(message.replyTo === undefined ? {} : { reply_to: mimeAddress(message.replyTo) }),
            subject: message.subject,
            html: message.html,
            ...(message.headers === undefined ? {} : { headers: message.headers }),
          }),
        })
      );
      let body: { success?: unknown; errors?: unknown; result?: { message_id?: unknown } } | null;
      try {
        body = (await response.json()) as typeof body;
      } catch {
        body = null;
      }
      // A 2xx whose body cannot be read took the email: only its id is lost. Calling that a
      // failure would send it again, and nothing de-duplicates (see below)
      if (response.ok && body === null) return {};
      body ??= {};
      if (!response.ok || body.success !== true) {
        throw new CloudflareEmailError(
          response.status,
          Array.isArray(body.errors) ? (body.errors as { code?: number; message?: string }[]) : []
        );
      }
      // No server-side de-duplication exists for the REST API either (like SES): a copy the
      // provider accepted is never sent again by the engine, whatever happened to the report
      const id = body.result?.message_id;
      return typeof id === 'string' ? { providerMessageId: id } : {};
    },
  };
}
