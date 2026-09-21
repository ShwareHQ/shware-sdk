import type { DeployResult, IdentifyResult, IngestResult } from './cloudflare/router';
import type { ProfileProps } from './store/index';

/**
 * `@shware/workflow/client` — the producer side of the ingest API, for the
 * service that knows what users do (an api server, a webhook handler). Plain
 * fetch, no dependencies; errors carry the status and body so a caller can
 * log them without failing the request that triggered the report.
 */

export interface JourneyClientOptions {
  /** The journey Worker's origin, e.g. `https://workflow.example.com`. */
  origin: string;
  /** Its API_TOKEN, sent as a bearer; omit against an open local instance. */
  token?: string;
  /** Fetch implementation (defaults to the global one). */
  fetch?: typeof fetch;
}

export class JourneyClientError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly body: string
  ) {
    super(`journey ${path} failed: ${status} ${body}`);
    this.name = 'JourneyClientError';
  }
}

export class JourneyClient {
  constructor(private readonly options: JourneyClientOptions) {}

  /** Merge profile properties (`null` clears one). Every property a journey reads must be identified before the event that starts it. */
  identify(userId: string, props: ProfileProps): Promise<IdentifyResult> {
    return this.post<IdentifyResult>('/identify', { userId, props });
  }

  /** Record an event; the Worker starts every journey whose trigger matches it and wakes waits on it. */
  track(
    userId: string,
    event: string,
    payload: Record<string, unknown> = {},
    ts?: number
  ): Promise<IngestResult> {
    return this.post<IngestResult>('/events', {
      userId,
      event,
      payload,
      ...(ts === undefined ? {} : { ts }),
    });
  }

  /** Deploy a compiled bundle (BundleIR). */
  deploy(bundle: unknown): Promise<DeployResult> {
    return this.post<DeployResult>('/deploy', bundle);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.options.token !== undefined) headers.authorization = `Bearer ${this.options.token}`;
    const doFetch = this.options.fetch ?? fetch;
    const response = await doFetch(`${this.options.origin.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new JourneyClientError(path, response.status, await response.text());
    return (await response.json()) as T;
  }
}
