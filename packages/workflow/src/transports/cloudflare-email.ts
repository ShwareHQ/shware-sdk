import type { EmailBindingLike } from '../cloudflare/bindings';
import { formatEmailAddress } from '../email';
import type { EmailMessage, EmailTransport } from '../email-sender';

/**
 * `@shware/workflow/transports/cloudflare-email` — Cloudflare Email Service, through the
 * Worker's `send_email` binding or, from anywhere else (a Lambda), its REST API. Both take the
 * same finished email; only the call and the way each reports a failure differ.
 */

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
  constructor(
    readonly status: number,
    readonly errors: readonly { code?: number; message?: string }[]
  ) {
    const said = errors.map((e) => `${e.code ?? '?'} ${e.message ?? ''}`.trim()).join('; ');
    super(`Cloudflare Email send failed (${status})${said === '' ? '' : `: ${said}`}`);
  }
}

export function cloudflareEmailTransport(options: CloudflareEmailTransportOptions): EmailTransport {
  if (options.binding !== undefined) {
    const { binding } = options;
    return {
      async send(message) {
        // The binding takes the key and drops the duplicate a retry or replay produces
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
      const response = await fetchImpl(
        `${endpoint}/accounts/${encodeURIComponent(accountId)}/email/sending/send`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: formatEmailAddress(message.from),
            to: message.to,
            ...(message.replyTo === undefined
              ? {}
              : { reply_to: formatEmailAddress(message.replyTo) }),
            subject: message.subject,
            html: message.html,
          }),
        }
      );
      let body: { success?: unknown; errors?: unknown; result?: { message_id?: unknown } } = {};
      try {
        body = (await response.json()) as typeof body;
      } catch {
        body = {};
      }
      if (!response.ok || body.success !== true) {
        throw new CloudflareEmailError(
          response.status,
          Array.isArray(body.errors) ? (body.errors as { code?: number; message?: string }[]) : []
        );
      }
      // No server-side de-duplication is documented for the REST API: a retry after an accepted
      // send can deliver twice (at least once, like SES)
      const id = body.result?.message_id;
      return typeof id === 'string' ? { providerMessageId: id } : {};
    },
  };
}
