import { mimeAddress } from '../email';
import type { EmailMessage, EmailTransport } from '../email-sender';
import { isRetryableStatus } from '../engine/retry';
import { signRequest } from './sigv4';

/**
 * `@shware/workflow/transports/ses` — email through Amazon SES (the v2 `SendEmail` API) over
 * plain `fetch` with a SigV4 signature, so the same transport runs in a Lambda and in a Worker.
 * Nothing here loads the AWS SDK or a Node-only credential chain.
 */

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** Present for temporary credentials (a role's): signed with the request. */
  sessionToken?: string | undefined;
}

/** Called on every send, so rotated temporary credentials are picked up rather than frozen. */
export type AwsCredentialProvider = () => AwsCredentials | Promise<AwsCredentials>;

export interface SesEmailTransportOptions {
  region: string;
  /**
   * Fixed credentials, or a provider read on every send. Defaults to the process environment's
   * `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`, read at send time —
   * a Lambda's execution role. A Worker passes them explicitly from its validated env.
   */
  credentials?: AwsCredentials | AwsCredentialProvider;
  /** An SES configuration set (event publishing, a dedicated IP pool). */
  configurationSetName?: string;
  /** Defaults to `https://email.<region>.amazonaws.com`. */
  endpoint?: string;
  fetch?: typeof fetch;
}

/** An SES error response: `type` is SES's error code (`MessageRejected`, `TooManyRequestsException`, ...). */
export class SesSendError extends Error {
  override readonly name = 'SesSendError';
  /** A rejected request (an unverified sender, a bad address) fails the same way every time. */
  readonly retryable: boolean;
  constructor(
    readonly status: number,
    readonly type: string | undefined,
    message: string
  ) {
    super(`SES SendEmail failed (${status}${type === undefined ? '' : ` ${type}`}): ${message}`);
    this.retryable = isRetryableStatus(status);
  }
}

function environmentCredentials(): AwsCredentials {
  // Read through globalThis: a Worker has no `process`, and must pass credentials instead
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const accessKeyId = env?.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env?.AWS_SECRET_ACCESS_KEY;
  if (accessKeyId === undefined || secretAccessKey === undefined) {
    throw new Error(
      'sesEmailTransport: no credentials — pass `credentials`, or run where AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are set (a Lambda execution role)'
    );
  }
  return { accessKeyId, secretAccessKey, sessionToken: env?.AWS_SESSION_TOKEN };
}

export function sesEmailTransport(options: SesEmailTransportOptions): EmailTransport {
  const endpoint = (options.endpoint ?? `https://email.${options.region}.amazonaws.com`).replace(
    /\/$/,
    ''
  );
  const credentials = async (): Promise<AwsCredentials> => {
    const configured = options.credentials;
    if (configured === undefined) return environmentCredentials();
    return typeof configured === 'function' ? configured() : configured;
  };
  const fetchImpl = options.fetch ?? fetch;

  return {
    async send(message: EmailMessage) {
      const body = JSON.stringify({
        FromEmailAddress: mimeAddress(message.from),
        Destination: { ToAddresses: [message.to] },
        ...(message.replyTo === undefined
          ? {}
          : { ReplyToAddresses: [mimeAddress(message.replyTo)] }),
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: { Html: { Data: message.html, Charset: 'UTF-8' } },
            ...(message.headers === undefined
              ? {}
              : {
                  Headers: Object.entries(message.headers).map(([Name, Value]) => ({
                    Name,
                    Value,
                  })),
                }),
          },
        },
        ...(options.configurationSetName === undefined
          ? {}
          : { ConfigurationSetName: options.configurationSetName }),
      });
      const url = `${endpoint}/v2/email/outbound-emails`;
      const headers = await signRequest({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json' },
        body,
        credentials: await credentials(),
        region: options.region,
        service: 'ses',
      });
      // No retries here: the durable step owns them, and counts them — SES cannot de-duplicate,
      // so every extra attempt of an accepted send is another chance to deliver twice
      const response = await fetchImpl(url, { method: 'POST', headers, body });
      const text = await response.text();
      if (!response.ok) {
        let detail = text;
        try {
          const parsed = JSON.parse(text) as { message?: unknown; Message?: unknown };
          const said = parsed.message ?? parsed.Message;
          if (typeof said === 'string') detail = said;
        } catch {
          // Not JSON: the raw body says what went wrong
        }
        const type = response.headers.get('x-amzn-errortype')?.split(':')[0];
        throw new SesSendError(response.status, type, detail);
      }
      let messageId: unknown;
      try {
        messageId = (JSON.parse(text) as { MessageId?: unknown }).MessageId;
      } catch {
        messageId = undefined;
      }
      return typeof messageId === 'string' ? { providerMessageId: messageId } : {};
    },
  };
}
