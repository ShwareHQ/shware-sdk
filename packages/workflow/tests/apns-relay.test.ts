import { webcrypto } from 'node:crypto';
import { type Http2Server, type ServerHttp2Stream, createServer } from 'node:http2';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ApnsPushSender } from '../src/apns';
import { type ApnsRelay, startApnsRelay } from '../src/apns-relay';

/**
 * A stand-in for APNs: an HTTP/2 (cleartext) server that echoes what it was
 * asked, so the test can see exactly what crossed the relay.
 */
let upstream: Http2Server;
let upstreamOrigin: string;
let relay: ApnsRelay;
const seen: { path: string; headers: Record<string, unknown>; body: string }[] = [];

beforeAll(async () => {
  upstream = createServer();
  upstream.on('stream', (stream: ServerHttp2Stream, headers) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push({ path: String(headers[':path']), headers, body });
      const dead = String(headers[':path']).endsWith('/dead');
      stream.respond({
        ':status': dead ? 410 : 200,
        'apns-id': '00000000-0000-0000-0000-000000000001',
      });
      stream.end(dead ? '{"reason":"Unregistered"}' : '');
    });
  });
  await new Promise<void>((resolve) => {
    upstream.listen(0, '127.0.0.1', resolve);
  });
  const address = upstream.address();
  upstreamOrigin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  relay = await startApnsRelay({ port: 0, allow: [upstreamOrigin] });
});

afterAll(async () => {
  await relay.close();
  await new Promise<void>((resolve) => {
    upstream.close(() => resolve());
  });
});

describe('startApnsRelay', () => {
  test('forwards the APNs request over HTTP/2 and returns the answer', async () => {
    const response = await fetch(`http://127.0.0.1:${relay.port}/3/device/abc`, {
      method: 'POST',
      headers: {
        'apns-relay-upstream': upstreamOrigin,
        'apns-topic': 'io.example.app',
        'apns-push-type': 'alert',
        authorization: 'bearer t',
        'content-type': 'application/json',
        'x-not-forwarded': '1',
      },
      body: '{"aps":{}}',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('apns-id')).toBe('00000000-0000-0000-0000-000000000001');
    expect(seen.at(-1)).toMatchObject({
      path: '/3/device/abc',
      body: '{"aps":{}}',
      headers: { 'apns-topic': 'io.example.app', authorization: 'bearer t' },
    });
    expect(seen.at(-1)?.headers).not.toHaveProperty('x-not-forwarded');
  });

  test('passes an error status and body through', async () => {
    const response = await fetch(`http://127.0.0.1:${relay.port}/3/device/dead`, {
      method: 'POST',
      headers: { 'apns-relay-upstream': upstreamOrigin },
      body: '{}',
    });
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ reason: 'Unregistered' });
  });

  test('refuses an upstream outside the allow list', async () => {
    const response = await fetch(`http://127.0.0.1:${relay.port}/3/device/abc`, {
      method: 'POST',
      headers: { 'apns-relay-upstream': 'https://evil.example' },
      body: '{}',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: 'RelayUpstreamNotAllowed' });
  });

  test('the sender and the relay fit together end to end', async () => {
    const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
    ]);
    const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)).toString(
      'base64'
    );
    // The sender names Apple's host as the upstream; a widened allow list lets the fake stand in.
    await relay.close();
    relay = await startApnsRelay({ port: 0, allow: [upstreamOrigin] });
    const sender = new ApnsPushSender({
      keyId: 'K',
      teamId: 'T',
      privateKey: `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----`,
      topic: 'io.example.app',
      environment: 'sandbox',
      render: async () => ({ title: 't', body: 'b' }),
      origin: `http://127.0.0.1:${relay.port}`,
      // Point the relay header at the fake instead of Apple for the test
      fetch: (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set('apns-relay-upstream', upstreamOrigin);
        return fetch(url, { ...init, headers });
      },
    });
    await sender.send({
      channel: 'push',
      template: 'x',
      props: {},
      userId: 'u',
      recipient: 'tok',
      idempotencyKey: 'i:1',
    });
    expect(seen.at(-1)).toMatchObject({ path: '/3/device/tok' });
    expect(JSON.parse(seen.at(-1)?.body ?? '{}')).toMatchObject({
      aps: { alert: { title: 't', body: 'b' } },
    });
  });
});
