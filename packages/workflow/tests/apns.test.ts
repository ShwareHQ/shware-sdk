import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, test } from 'vitest';
import { ApnsPushSender, apnsKeyFromBase64, apnsReason, signApnsJwt } from '../src/apns';

/** A throwaway P-256 key in PKCS #8 PEM, the shape of a `.p8` file. */
let privateKey: string;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  publicKey = pair.publicKey;
  const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)).toString(
    'base64'
  );
  privateKey = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----\n`;
});

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

describe('signApnsJwt', () => {
  test('produces an ES256 provider token that verifies with the public key', async () => {
    const jwt = await signApnsJwt(
      { keyId: 'ABC123DEFG', teamId: 'TEAM123456', privateKey },
      1_000_000_000_000
    );
    const [header, claims, signature] = jwt.split('.') as [string, string, string];
    expect(decode(header)).toEqual({ alg: 'ES256', kid: 'ABC123DEFG' });
    expect(decode(claims)).toEqual({ iss: 'TEAM123456', iat: 1_000_000_000 });
    const ok = await webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      Buffer.from(signature, 'base64url'),
      Buffer.from(`${header}.${claims}`)
    );
    expect(ok).toBe(true);
  });
});

describe('apnsKeyFromBase64', () => {
  test('decodes the .p8 and rejects anything that is not one', () => {
    expect(apnsKeyFromBase64(Buffer.from(privateKey).toString('base64'))).toBe(privateKey);
    expect(() => apnsKeyFromBase64(Buffer.from('nope').toString('base64'))).toThrow(/PKCS #8/);
  });
});

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; body: string; headers: Headers }[] = [];
  const fetchFn: typeof fetch = async (url, init) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    calls.push({ url: href, body: init?.body as string, headers: new Headers(init?.headers) });
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  };
  return { calls, fetchFn };
}

const message = {
  channel: 'push' as const,
  template: 'comeback',
  props: { name: 'Ada' },
  userId: 'u1',
  recipient: 'a1b2c3',
  idempotencyKey: 'inst:3',
};

const render = async (template: string, props: Record<string, unknown>) => ({
  title: `Hi ${String(props.name)}`,
  body: `${template} body`,
});

function sender(
  fetchFn: typeof fetch,
  extra: Partial<ConstructorParameters<typeof ApnsPushSender>[0]> = {}
) {
  return new ApnsPushSender({
    keyId: 'ABC123DEFG',
    teamId: 'TEAM123456',
    privateKey,
    topic: 'io.example.app',
    environment: 'sandbox',
    render,
    fetch: fetchFn,
    ...extra,
  });
}

describe('ApnsPushSender', () => {
  test('posts the alert to the sandbox host with the provider token and topic', async () => {
    const { calls, fetchFn } = fakeFetch(200, undefined);
    await sender(fetchFn).send(message);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toBe('https://api.sandbox.push.apple.com/3/device/a1b2c3');
    expect(call.headers.get('authorization')).toMatch(/^bearer ey/);
    expect(call.headers.get('apns-topic')).toBe('io.example.app');
    expect(call.headers.get('apns-push-type')).toBe('alert');
    expect(call.headers.get('apns-relay-upstream')).toBeNull();
    expect(JSON.parse(call.body)).toEqual({
      aps: { alert: { title: 'Hi Ada', body: 'comeback body' }, sound: 'default' },
      template: 'comeback',
      idempotencyKey: 'inst:3',
    });
  });

  test('an origin override goes to the relay and names the real upstream', async () => {
    const { calls, fetchFn } = fakeFetch(200, undefined);
    await sender(fetchFn, { origin: 'http://localhost:9999', environment: 'production' }).send(
      message
    );
    expect(calls[0].url).toBe('http://localhost:9999/3/device/a1b2c3');
    expect(calls[0].headers.get('apns-relay-upstream')).toBe('https://api.push.apple.com');
  });

  test('reuses the provider token across sends', async () => {
    const { calls, fetchFn } = fakeFetch(200, undefined);
    const s = sender(fetchFn);
    await s.send(message);
    await s.send(message);
    expect(calls[0].headers.get('authorization')).toBe(calls[1].headers.get('authorization'));
  });

  test('a dead token is reported through onUnregistered, not retried', async () => {
    const { fetchFn } = fakeFetch(410, { reason: 'Unregistered' });
    const gone: string[] = [];
    await sender(fetchFn, { onUnregistered: (m) => void gone.push(m.userId) }).send(message);
    expect(gone).toEqual(['u1']);
  });

  test('any other failure throws so the step retries', async () => {
    const { fetchFn } = fakeFetch(403, { reason: 'InvalidProviderToken' });
    await expect(sender(fetchFn).send(message)).rejects.toThrow(/403.*InvalidProviderToken/);
  });

  test('refuses a message without a token or on another channel', async () => {
    const { fetchFn } = fakeFetch(200, undefined);
    await expect(sender(fetchFn).send({ ...message, recipient: undefined })).rejects.toThrow(
      /no push token/
    );
    await expect(sender(fetchFn).send({ ...message, channel: 'email' })).rejects.toThrow(
      /unsupported channel/
    );
  });
});

describe('apnsReason', () => {
  test('reads the reason and tolerates a non-JSON body', () => {
    expect(apnsReason('{"reason":"BadDeviceToken"}')).toBe('BadDeviceToken');
    expect(apnsReason('')).toBe('');
  });
});
