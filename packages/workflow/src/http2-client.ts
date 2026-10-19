import { type ClientHttp2Session, connect } from 'node:http2';

/**
 * A Node HTTP/2 client: one session per origin, reused while it lives. APNs speaks HTTP/2 only
 * and Node's `fetch` does not negotiate it, so a Node host (a Lambda, the development relay)
 * pushes through this instead. Node-only — a Worker's own `fetch` already speaks HTTP/2.
 */

export interface Http2Sessions {
  session(origin: string): ClientHttp2Session;
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
export function http2Fetch(pool: Http2Sessions = http2Sessions()): typeof fetch {
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
      stream.end(body);
    });
  };
}
