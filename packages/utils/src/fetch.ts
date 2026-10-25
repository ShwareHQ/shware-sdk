export interface RetryOptions {
  /**
   * The number of times to retry before failing. Default: 3 for the idempotent methods (GET, HEAD,
   * PUT, DELETE, OPTIONS), 0 for the others (POST, PATCH), as RFC 9110 §9.2.2 allows a client to
   * repeat only a request it knows to be idempotent — a POST retried after a lost answer may run
   * twice. Pass it explicitly for a POST whose server deduplicates it (a client-generated id, an
   * `Idempotency-Key`). A request whose body is a `ReadableStream` is never retried: the stream
   * cannot be read again.
   */
  retries?: number;

  /** The delay factor in milliseconds, default: 500 */
  delayFactor?: number;

  /** The maximum delay in milliseconds, default: 30_000 (30s) */
  maxDelay?: number;

  /**
   * A callback to further control if a request should be retried. It runs for every response,
   * successful ones included, and may be async so that the body can be inspected. It receives a
   * clone of the response, the body of the response returned to the caller is left unread.
   * default: 408 (Request Timeout), 429 (Too Many Requests), 500, 502, 503 or 504 — the server
   * errors that a later attempt may get past; 501 (Not Implemented), 505 and 511 will not change.
   */
  retryCondition?: (response: Response) => boolean | Promise<boolean>;
}

const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function defaultRetryCondition(response: Response): boolean {
  return RETRY_STATUSES.has(response.status);
}

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);

function defaultRetries(input: RequestInfo, init: RequestInit): number {
  const method = init.method ?? (input instanceof Request ? input.method : 'GET');
  return IDEMPOTENT_METHODS.has(method.toUpperCase()) ? 3 : 0;
}

function hasStreamBody(input: RequestInfo, init: RequestInit): boolean {
  const body = init.body ?? (input instanceof Request ? input.body : null);
  return typeof ReadableStream !== 'undefined' && body instanceof ReadableStream;
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
    retries: requestedRetries,
    delayFactor = 500,
    maxDelay = 30_000,
    retryCondition,
    ...init
  }: RequestInit & RetryOptions = {}
): Promise<Response> {
  const retries = hasStreamBody(input, init)
    ? 0
    : (requestedRetries ?? defaultRetries(input, init));
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
