export interface RetryOptions {
  /** The number of times to retry before failing, default: 3 */
  retries?: number;

  /** The delay factor in milliseconds, default: 500 */
  delayFactor?: number;

  /** The maximum delay in milliseconds, default: 30_000 (30s) */
  maxDelay?: number;

  /**
   * A callback to further control if a request should be retried. It runs for every response,
   * successful ones included, and may be async so that the body can be inspected. It receives a
   * clone of the response, the body of the response returned to the caller is left unread.
   * default: 408 (Request Timeout) or 429 (Too Many Requests) or 5xx (Server Error).
   */
  retryCondition?: (response: Response) => boolean | Promise<boolean>;
}

function defaultRetryCondition(response: Response): boolean {
  return response.status === 408 || response.status === 429 || response.status >= 500;
}

function parseRetryAfter(response: Response | null): number | null {
  if (!response) return null;
  const header = response.headers.get('retry-after');
  if (!header) return null;

  // if the retry after header is a number, convert it to milliseconds
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);

  // if the retry after header is a date, get the number of milliseconds until that date
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());

  return null;
}

export async function fetch(
  input: RequestInfo,
  {
    retries = 3,
    delayFactor = 500,
    maxDelay = 30_000,
    retryCondition,
    ...init
  }: RequestInit & RetryOptions = {}
): Promise<Response> {
  let retryCount = 0;
  let lastError: unknown = null;
  let lastResponse: Response | null = null;

  while (retryCount <= retries) {
    let response: Response | null = null;

    try {
      response = await globalThis.fetch(input, init);
      lastResponse = response;
    } catch (error) {
      lastError = error;
      if (retryCount === retries) throw error;
    }

    if (response) {
      if (retryCount === retries) return response;

      // the default condition only looks at the status, so it is handed the response directly and
      // pays for no clone. errors thrown by a custom condition are the caller's, not ours: they
      // propagate instead of being mistaken for a network failure
      const retry = retryCondition
        ? await retryCondition(response.clone())
        : defaultRetryCondition(response);
      if (!retry) return response;
    }

    const retryAfter = parseRetryAfter(response);
    const delay = delayFactor * 2 ** retryCount;
    const jitter = delay * 0.25 * (Math.random() * 2 - 1); // 25% jitter

    const timeout = Math.min(retryAfter ?? delay + jitter, maxDelay);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, timeout);
    });

    retryCount++;
  }

  if (lastResponse) return lastResponse;
  if (lastError instanceof Error) throw lastError;
  throw new Error('Fetch failed', { cause: lastError });
}
