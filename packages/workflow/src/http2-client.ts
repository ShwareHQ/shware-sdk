import { type ClientHttp2Session, connect } from 'node:http2';

/**
 * A Node HTTP/2 client: one session per origin, reused while it lives. APNs speaks HTTP/2 only
 * and Node's `fetch` does not negotiate it, so a Node host (a Lambda, the development relay)
 * pushes through this instead. Node-only — a Worker's own `fetch` already speaks HTTP/2.
 *
 * Why it exists, and when the Lambda side can go (as of 2026-10):
 * - Node 24 (Lambda's `nodejs24.x`, the newest GA runtime) bundles undici 7, whose `fetch`
 *   leaves HTTP/2 off (`allowH2: false`). A POST to APNs fails there with "Response does not
 *   match the HTTP/1.1 protocol". The only switch is an undici `Agent({ allowH2: true })`
 *   dispatcher, which needs the npm `undici` package (and, set globally, would change every
 *   `fetch` in the host's process) — this client needs no dependency and touches nothing global.
 * - undici 8 negotiates HTTP/2 by default (nodejs/undici#4828), and Node 26 bundles it. Lambda's
 *   `nodejs26.x` is in public preview only, outside the SLA; it goes GA once Node 26 reaches
 *   Active LTS.
 * - Once the function runs on a GA runtime whose built-in `fetch` speaks HTTP/2 (check that
 *   durable functions support it, and that a POST to api.push.apple.com answers JSON rather
 *   than a protocol error), drop `apnsFetch: http2Fetch()` from `journeyLambda` (aws/index.ts):
 *   APNs then uses the platform `fetch` like the other channels. The development relay
 *   (`apns-relay.ts`, for workerd, which cannot make HTTP/2 subrequests) keeps using this pool.
 */

export interface Http2Sessions {
  session(origin: string): ClientHttp2Session;
  /** Drop a session that stopped answering, so the next request reconnects. */
  discard(origin: string): void;
  close(): void;
}

export function http2Sessions(): Http2Sessions {
  const sessions = new Map<string, ClientHttp2Session>();
  return {
    session(origin) {
      const existing = sessions.get(origin);
      if (existing !== undefined && !existing.closed && !existing.destroyed) return existing;
      const created = connect(origin);
      const forget = () => {
        if (sessions.get(origin) === created) sessions.delete(origin);
      };
      created.on('error', forget);
      created.on('close', forget);
      created.on('goaway', forget);
      sessions.set(origin, created);
      return created;
    },
    discard(origin) {
      sessions.get(origin)?.destroy();
      sessions.delete(origin);
    },
    close() {
      for (const open of sessions.values()) open.close();
      sessions.clear();
    },
  };
}

/**
 * `fetch` over HTTP/2, for the senders that take one (`ApnsPushSender({ fetch })`). Only what a
 * JSON API call needs: a method, string headers, a string or byte body, the status, headers and
 * body back.
 */
export function http2Fetch(
  pool: Http2Sessions = http2Sessions(),
  options: {
    /**
     * How long a request may go without activity: a session a frozen Lambda left half-dead
     * answers nothing and closes nothing, so without a limit the request hangs until the
     * function's timeout. 10 seconds by default.
     */
    timeoutMs?: number;
  } = {}
): typeof fetch {
  const timeoutMs = options.timeoutMs ?? 10_000;
  return async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = request.body === null ? undefined : Buffer.from(await request.arrayBuffer());
    const headers: Record<string, string> = {
      ':method': request.method,
      ':path': `${url.pathname}${url.search}`,
    };
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });
    return new Promise<Response>((resolve, reject) => {
      let stream;
      try {
        stream = pool.session(url.origin).request(headers);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      let status = 502;
      const responseHeaders = new Headers();
      const chunks: Buffer[] = [];
      stream.on('response', (received) => {
        status = received[':status'] ?? 502;
        for (const [name, value] of Object.entries(received)) {
          if (name.startsWith(':') || value === undefined) continue;
          responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
      });
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        const bytes = Buffer.concat(chunks);
        resolve(
          new Response(status === 204 || status === 304 || bytes.length === 0 ? null : bytes, {
            status,
            headers: responseHeaders,
          })
        );
      });
      stream.on('error', reject);
      stream.setTimeout(timeoutMs, () => {
        stream.close();
        pool.discard(url.origin);
        reject(new Error(`HTTP/2 request to ${url.origin} timed out after ${timeoutMs} ms`));
      });
      stream.end(body);
    });
  };
}
