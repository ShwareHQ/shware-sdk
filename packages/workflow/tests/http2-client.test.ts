import { type Http2Server, createServer } from 'node:http2';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { http2Fetch, http2Sessions } from '../src/http2-client';

/**
 * The Node HTTP/2 fetch APNs goes through on a Lambda: against a real (cleartext) HTTP/2
 * server — method, path, headers and body out; status, headers and body back; one session
 * reused per origin.
 */

let server: Http2Server;
let origin: string;
const sessionsSeen = new Set<unknown>();

beforeAll(async () => {
  server = createServer((request, response) => {
    sessionsSeen.add(request.stream.session);
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      // Never answered: what a session a frozen Lambda left behind looks like
      if (request.url === '/hang') return;
      // Never answered, and the server retires the session: the client opens a new one
      if (request.url === '/hang-goaway') {
        request.stream.session?.goaway();
        return;
      }
      if (request.url === '/empty') {
        response.writeHead(200, { 'apns-id': 'abc' });
        response.end();
        return;
      }
      response.writeHead(request.url === '/gone' ? 410 : 200, {
        'content-type': 'application/json',
        'apns-id': 'id-1',
      });
      response.end(
        JSON.stringify({
          method: request.method,
          path: request.url,
          auth: request.headers.authorization,
          topic: request.headers['apns-topic'],
          body,
        })
      );
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

describe('http2Fetch', () => {
  test('a request goes out over HTTP/2 and its response comes back whole', async () => {
    const pool = http2Sessions();
    const fetch = http2Fetch(pool);
    const response = await fetch(`${origin}/3/device/tok?x=1`, {
      method: 'POST',
      headers: { authorization: 'bearer jwt', 'apns-topic': 'io.acme.app' },
      body: '{"aps":{}}',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('apns-id')).toBe('id-1');
    expect(await response.json()).toEqual({
      method: 'POST',
      path: '/3/device/tok?x=1',
      auth: 'bearer jwt',
      topic: 'io.acme.app',
      body: '{"aps":{}}',
    });
    pool.close();
  });

  test('an error status is a response, not a throw; an empty body is null', async () => {
    const pool = http2Sessions();
    const fetch = http2Fetch(pool);
    const gone = await fetch(`${origin}/gone`, { method: 'POST', body: '{}' });
    expect(gone.status).toBe(410);
    const empty = await fetch(`${origin}/empty`, { method: 'POST', body: '{}' });
    expect(empty.status).toBe(200);
    expect(empty.body).toBeNull();
    pool.close();
  });

  test('requests to one origin share one session', async () => {
    sessionsSeen.clear();
    const pool = http2Sessions();
    const fetch = http2Fetch(pool);
    await Promise.all([1, 2, 3].map((n) => fetch(`${origin}/n${n}`, { method: 'POST', body: '' })));
    expect(sessionsSeen.size).toBe(1);
    pool.close();
  });

  test('a request that gets no answer times out, and the next one reconnects', async () => {
    const pool = http2Sessions();
    const fetch = http2Fetch(pool, { timeoutMs: 200 });
    const before = pool.session(origin);
    await expect(fetch(`${origin}/hang`, { method: 'POST', body: '' })).rejects.toThrow(
      /timed out after 200 ms/
    );
    expect(before.destroyed).toBe(true);
    const response = await fetch(`${origin}/after`, { method: 'POST', body: '' });
    expect(response.status).toBe(200);
    pool.close();
  });

  test('a timed-out request discards only its own session, not the newer one', async () => {
    const pool = http2Sessions();
    const fetch = http2Fetch(pool, { timeoutMs: 300 });
    const old = pool.session(origin);
    const hanging = fetch(`${origin}/hang-goaway`, { method: 'POST', body: '' });
    // After the GOAWAY the pool holds a new session for the origin
    await new Promise<void>((resolve) => {
      old.once('goaway', () => resolve());
    });
    const fresh = pool.session(origin);
    expect(fresh).not.toBe(old);
    await expect(hanging).rejects.toThrow(/timed out/);
    // The old request's timeout left the new session alone
    expect(fresh.destroyed).toBe(false);
    expect(pool.session(origin)).toBe(fresh);
    expect((await fetch(`${origin}/after`, { method: 'POST', body: '' })).status).toBe(200);
    pool.close();
  });

  test('an unreachable origin rejects', async () => {
    const pool = http2Sessions();
    await expect(
      http2Fetch(pool)('http://127.0.0.1:1/x', { method: 'POST', body: '' })
    ).rejects.toThrow(/ECONNREFUSED/);
    pool.close();
  });
});
