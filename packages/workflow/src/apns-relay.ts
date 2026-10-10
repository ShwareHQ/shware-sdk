import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { type ClientHttp2Session, connect } from 'node:http2';

/**
 * `@shware/workflow/apns-relay` — a development-only HTTP/1.1 → HTTP/2 relay
 * for APNs, run under Node next to `wrangler dev`.
 *
 * APNs accepts HTTP/2 only, and workerd (the local Workers runtime) cannot
 * make an HTTP/2 subrequest, so a journey that pushes to an iPhone from a
 * local Worker has nowhere to go. A deployed Worker needs none of this: its
 * `fetch` negotiates HTTP/2 with Apple. The relay forwards each request to the
 * origin named in its `apns-relay-upstream` header (the sender sets it along
 * with `origin`), keeping one HTTP/2 session per upstream.
 *
 * Only Apple's two hosts are relayed by default; `allow` widens that for tests.
 */

export interface ApnsRelayOptions {
  port: number;
  /** Interface to listen on; loopback by default — the relay has no auth of its own. */
  hostname?: string;
  /** Upstream origins that may be relayed; Apple's production and sandbox hosts by default. */
  allow?: readonly string[];
}

export interface ApnsRelay {
  port: number;
  close(): Promise<void>;
}

const DEFAULT_ALLOW = ['https://api.push.apple.com', 'https://api.sandbox.push.apple.com'];

/** Request headers APNs reads; everything else (host, content-length, …) is the relay's own business. */
const FORWARDED = [
  'authorization',
  'apns-topic',
  'apns-push-type',
  'apns-priority',
  'apns-expiration',
  'apns-collapse-id',
  'apns-id',
  'content-type',
];

export function startApnsRelay(options: ApnsRelayOptions): Promise<ApnsRelay> {
  const allow = new Set(options.allow ?? DEFAULT_ALLOW);
  const sessions = new Map<string, ClientHttp2Session>();

  function session(upstream: string): ClientHttp2Session {
    const existing = sessions.get(upstream);
    if (existing !== undefined && !existing.closed && !existing.destroyed) return existing;
    const created = connect(upstream);
    const forget = () => {
      if (sessions.get(upstream) === created) sessions.delete(upstream);
    };
    created.on('error', forget);
    created.on('close', forget);
    sessions.set(upstream, created);
    return created;
  }

  function relay(req: IncomingMessage, res: ServerResponse): void {
    const upstreamHeader = req.headers['apns-relay-upstream'];
    const upstream = Array.isArray(upstreamHeader) ? upstreamHeader[0] : upstreamHeader;
    if (upstream === undefined || !allow.has(upstream)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ reason: 'RelayUpstreamNotAllowed', upstream: upstream ?? null }));
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const headers: Record<string, string> = {
        ':method': req.method ?? 'POST',
        ':path': req.url ?? '/',
      };
      for (const name of FORWARDED) {
        const value = req.headers[name];
        if (typeof value === 'string') headers[name] = value;
      }
      let stream;
      try {
        stream = session(upstream).request(headers);
      } catch (error) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ reason: 'RelayConnectFailed', error: String(error) }));
        return;
      }
      const body: Buffer[] = [];
      stream.on('response', (responseHeaders) => {
        const status = responseHeaders[':status'] ?? 502;
        const apnsId = responseHeaders['apns-id'];
        res.writeHead(status, {
          'content-type': 'application/json',
          ...(typeof apnsId === 'string' ? { 'apns-id': apnsId } : {}),
        });
      });
      stream.on('data', (chunk: Buffer) => body.push(chunk));
      stream.on('end', () => res.end(Buffer.concat(body)));
      stream.on('error', (error) => {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ reason: 'RelayUpstreamError', error: String(error) }));
      });
      stream.end(Buffer.concat(chunks));
    });
  }

  const server = createServer(relay);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.hostname ?? '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      resolve({
        port,
        close: () =>
          new Promise((done) => {
            for (const open of sessions.values()) open.close();
            sessions.clear();
            server.close(() => done());
          }),
      });
    });
  });
}
