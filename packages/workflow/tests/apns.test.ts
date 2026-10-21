import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, test } from 'vitest';
import {
  ApnsPushSender,
  apnsCollapseId,
  apnsIdFromKey,
  apnsKeyFromBase64,
  apnsReason,
  signApnsJwt,
} from '../src/apns';
import { PermanentError, isRetryable } from '../src/engine/retry';

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
    expect(() => apnsKeyFromBase64(Buffer.from('nope').toString('base64'))).toThrow(PermanentError);
    expect(() => apnsKeyFromBase64('%%%')).toThrow(PermanentError);
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
  workflow: 'w',
  instanceId: 'inst',
  nodeId: '0',
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

  test('a push the device should report is mutable, so the service extension runs', async () => {
    const { calls, fetchFn } = fakeFetch(200, undefined);
    const delivered_url = 'https://wf.example.com/t/d/m1';
    await sender(fetchFn).send({
      ...message,
      tracking: { data: { message_id: 'm1', delivered_url } },
    });
    expect(JSON.parse(calls[0].body)).toMatchObject({
      aps: { 'mutable-content': 1 },
      message_id: 'm1',
      delivered_url,
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
    await expect(
      sender(fetchFn, { onUnregistered: (m) => void gone.push(m.userId) }).send(message)
    ).resolves.toEqual({ delivered: false, reason: 'Unregistered' });
    expect(gone).toEqual(['u1']);
  });

  test('a resend carries the same apns-id and apns-collapse-id, derived from the idempotency key', async () => {
    const { calls, fetchFn } = fakeFetch(200, undefined);
    await sender(fetchFn).send(message);
    await sender(fetchFn).send(message);
    await sender(fetchFn).send({ ...message, idempotencyKey: 'inst:4' });
    const ids = calls.map((c) => c.headers.get('apns-id'));
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(ids[0]).toBe(await apnsIdFromKey('inst:3'));
    expect(calls[0].headers.get('apns-collapse-id')).toBe('inst:3');
    // The collapse id is cut to 64 bytes, at a character boundary
    const long = `inst:${'é'.repeat(40)}`;
    const cut = apnsCollapseId(long);
    expect(Buffer.byteLength(cut)).toBeLessThanOrEqual(64);
    expect(cut).toBe(`inst:${'é'.repeat(29)}`);
    expect(apnsCollapseId('short')).toBe('short');
  });

  /**
   * How each APNs answer ends the copy: a dead token settles it and forgets the device, a
   * configuration or request problem fails it for good, throttling and outages retry.
   */
  describe('classification', () => {
    type Outcome = 'settled-dead-token' | 'settled-undelivered' | 'PermanentError' | 'retryable';
    const table: [status: number, reason: string | undefined, outcome: Outcome][] = [
      [410, 'Unregistered', 'settled-dead-token'],
      [410, undefined, 'settled-dead-token'],
      [400, 'BadDeviceToken', 'settled-undelivered'],
      [400, 'ExpiredToken', 'settled-dead-token'],
      [400, 'DeviceTokenNotForTopic', 'PermanentError'],
      [400, 'TopicDisallowed', 'PermanentError'],
      [400, 'BadTopic', 'PermanentError'],
      [400, 'MissingTopic', 'PermanentError'],
      [403, 'BadCertificate', 'PermanentError'],
      [403, 'BadCertificateEnvironment', 'PermanentError'],
      [403, 'Forbidden', 'PermanentError'],
      [403, 'InvalidProviderToken', 'PermanentError'],
      [403, 'MissingProviderToken', 'PermanentError'],
      [400, 'BadMessageId', 'PermanentError'],
      [400, 'BadPriority', 'PermanentError'],
      [400, 'PayloadEmpty', 'PermanentError'],
      [400, 'IdleTimeout', 'PermanentError'],
      [413, 'PayloadTooLarge', 'PermanentError'],
      [404, 'BadPath', 'PermanentError'],
      [403, 'ExpiredProviderToken', 'retryable'],
      [429, 'TooManyRequests', 'retryable'],
      [429, 'TooManyProviderTokenUpdates', 'retryable'],
      [500, 'InternalServerError', 'retryable'],
      [503, 'ServiceUnavailable', 'retryable'],
      [503, 'Shutdown', 'retryable'],
    ];
    /** What the send did, in the table's terms: how it ended, and whether the device was forgotten. */
    const observe = async (status: number, reason: string | undefined) => {
      const { fetchFn } = fakeFetch(status, reason === undefined ? undefined : { reason });
      const gone: string[] = [];
      const s = sender(fetchFn, { onUnregistered: (m) => void gone.push(m.userId) });
      const result = await s.send(message).then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error })
      );
      const { error } = result;
      const outcome: Outcome | undefined =
        error === undefined
          ? gone.length > 0
            ? 'settled-dead-token'
            : 'settled-undelivered'
          : error instanceof PermanentError
            ? 'PermanentError'
            : 'retryable';
      return {
        outcome,
        settled: result.value,
        forgotten: gone,
        retryable: error === undefined ? undefined : isRetryable(error),
        namesStatus: error instanceof Error ? error.message.includes(String(status)) : undefined,
      };
    };
    test.each(table)('%i %s → %s', async (status, reason, outcome) => {
      const dead = outcome === 'settled-dead-token';
      const settled = dead || outcome === 'settled-undelivered';
      expect(await observe(status, reason)).toEqual({
        outcome,
        settled: settled ? { delivered: false, reason: reason ?? 'Unregistered' } : undefined,
        forgotten: dead ? ['u1'] : [],
        retryable: settled ? undefined : outcome === 'retryable',
        namesStatus: settled ? undefined : true,
      });
    });

    test('ExpiredProviderToken drops the cached provider token, so the retry signs a new one', async () => {
      let status = 403;
      const calls: string[] = [];
      const fetchFn: typeof fetch = async (_url, init) => {
        calls.push(new Headers(init?.headers).get('authorization') ?? '');
        return new Response(
          status === 403 ? JSON.stringify({ reason: 'ExpiredProviderToken' }) : null,
          { status }
        );
      };
      const s = sender(fetchFn);
      await s.send({ ...message, idempotencyKey: 'inst:1' }).catch(() => undefined);
      await expect(s.send(message)).rejects.toThrow(/ExpiredProviderToken/);
      status = 200;
      await s.send(message);
      // The first failure keeps nothing: the second attempt already carries a fresh token
      expect(calls[0]).not.toBe(calls[1]);
      // A token refused for another reason (InvalidProviderToken) is kept as is: see the table
    });
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
