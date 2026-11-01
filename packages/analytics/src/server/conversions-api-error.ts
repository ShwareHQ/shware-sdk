/**
 * A conversions API that answered with an error status. The senders throw it, after the retries
 * of a transient failure have run out, and leave what to do about it to the caller —
 * `setupConversions` sends to every other destination still, then rejects with all of them. A
 * network failure rejects with the fetch error itself. Neither carries the access token.
 */
export class ConversionsApiError extends Error {
  override readonly name = 'ConversionsApiError';

  constructor(
    readonly platform: 'meta' | 'reddit' | 'openai' | 'linkedin' | 'microsoft' | 'google',
    readonly status: number,
    /** The response body, as the platform explains the rejection. */
    readonly body: string
  ) {
    super(`Failed to send ${platform} conversions, status: ${status}, body: ${body}`);
  }
}
