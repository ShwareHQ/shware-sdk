import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { PermanentError, isRetryable } from '../src/engine/retry';
import {
  DEAD_TOKEN_REASONS,
  FcmAccessToken,
  FcmPushSender,
  type FcmServiceAccount,
  fcmErrorCode,
  serviceAccountFromBase64,
  signJwt,
} from '../src/fcm';

/** A throwaway RSA key pair in PKCS #8 PEM, like a real service-account file carries. */
let account: FcmServiceAccount;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await webcrypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );
  publicKey = pair.publicKey;
  const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)).toString(
    'base64'
  );
  account = {
    project_id: 'demo',
    client_email: 'sa@demo.iam.gserviceaccount.com',
    private_key: `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----\n`,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

describe('signJwt', () => {
  test('produces an RS256 JWT for the service account that verifies with its public key', async () => {
    const jwt = await signJwt(
      account,
      'https://oauth2.googleapis.com/token',
      'scope',
      1_000_000_000_000
    );
    const [header, claims, signature] = jwt.split('.') as [string, string, string];
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decode(claims)).toEqual({
      iss: account.client_email,
      scope: 'scope',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_000_000_000,
      exp: 1_000_003_600,
    });
    const ok = await webcrypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      Buffer.from(signature, 'base64url'),
      Buffer.from(`${header}.${claims}`)
    );
    expect(ok).toBe(true);
  });
});

/**
 * A fetch standing in for both Google endpoints: the token exchange mints `at-1`, `at-2`, … (or
 * answers `token.status`), and FCM answers `fcmStatus` with `fcmBody`.
 */
function fakeFetch(fcmStatus: number, fcmBody: unknown, token: { status?: number } = {}) {
  const calls: { url: string; body: string; auth: string | null }[] = [];
  let minted = 0;
  const fetchFn: typeof fetch = async (url, init) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    const headers = new Headers(init?.headers);
    calls.push({ url: href, body: init?.body as string, auth: headers.get('authorization') });
    if (href.endsWith('/token')) {
      if (token.status !== undefined && token.status !== 200) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: token.status });
      }
      minted += 1;
      return new Response(JSON.stringify({ access_token: `at-${minted}`, expires_in: 3600 }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify(fcmBody), { status: fcmStatus });
  };
  const exchanges = () => calls.filter((c) => c.url.endsWith('/token'));
  const sends = () => calls.filter((c) => c.url.includes('/messages:send'));
  return { calls, fetchFn, exchanges, sends };
}

/** An FCM v1 error body: the gRPC status, and the messaging error code when there is one. */
const fcmError = (status: string, errorCode?: string) => ({
  error: {
    code: 0,
    status,
    message: 'x',
    ...(errorCode === undefined ? {} : { details: [{ errorCode }] }),
  },
});

const message = {
  workflow: 'w',
  instanceId: 'inst',
  nodeId: '0',
  channel: 'push' as const,
  template: 'comeback',
  props: { name: 'Ada' },
  userId: 'u1',
  recipient: 'fcm-token-1',
  idempotencyKey: 'inst:0',
};

const render = async (key: string, props: Record<string, unknown>) => ({
  title: `${key} ${String(props.name)}`,
  body: 'b',
});

/**
 * The access token: one exchange for the account, reused by every sender built on it until it is
 * about to expire or FCM refuses it.
 */
describe('FcmAccessToken', () => {
  test('exchanges once and hands the same token to every caller until a minute before expiry', async () => {
    const { fetchFn, exchanges } = fakeFetch(200, {});
    const credentials = new FcmAccessToken({ serviceAccount: account, fetch: fetchFn });
    expect(credentials.projectId).toBe('demo');
    expect(await credentials.token(0)).toBe('at-1');
    expect(await credentials.token(3600_000 - 60_001)).toBe('at-1');
    expect(exchanges()).toHaveLength(1);
  });

  test('exchanges again once the token is within a minute of expiring', async () => {
    vi.useFakeTimers({ now: 1_000_000_000_000 });
    const { fetchFn, exchanges } = fakeFetch(200, {});
    const credentials = new FcmAccessToken({ serviceAccount: account, fetch: fetchFn });
    expect(await credentials.token()).toBe('at-1');
    vi.advanceTimersByTime(3600_000 - 60_000);
    expect(await credentials.token()).toBe('at-2');
    expect(exchanges()).toHaveLength(2);
  });

  test('invalidate() forces a new exchange on the next call', async () => {
    const { fetchFn } = fakeFetch(200, {});
    const credentials = new FcmAccessToken({ serviceAccount: account, fetch: fetchFn });
    expect(await credentials.token(0)).toBe('at-1');
    credentials.invalidate();
    expect(await credentials.token(0)).toBe('at-2');
  });

  test('concurrent first calls share one exchange', async () => {
    const { fetchFn, exchanges } = fakeFetch(200, {});
    const credentials = new FcmAccessToken({ serviceAccount: account, fetch: fetchFn });
    const tokens = await Promise.all([
      credentials.token(0),
      credentials.token(0),
      credentials.token(0),
    ]);
    expect(tokens).toEqual(['at-1', 'at-1', 'at-1']);
    expect(exchanges()).toHaveLength(1);
  });

  test('a failed exchange is not kept: the next call tries again', async () => {
    const status = { status: 503 };
    const { fetchFn, exchanges } = fakeFetch(200, {}, status);
    const credentials = new FcmAccessToken({ serviceAccount: account, fetch: fetchFn });
    const error = await credentials.token(0).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(PermanentError);
    expect(isRetryable(error)).toBe(true);
    status.status = 200;
    expect(await credentials.token(0)).toBe('at-1');
    expect(exchanges()).toHaveLength(2);
  });

  test('an exchange the endpoint refuses is permanent; a failing endpoint is retried', async () => {
    const refused = new FcmAccessToken({
      serviceAccount: account,
      fetch: fakeFetch(200, {}, { status: 400 }).fetchFn,
    });
    await expect(refused.token()).rejects.toThrow(PermanentError);
    const down = new FcmAccessToken({
      serviceAccount: account,
      fetch: fakeFetch(200, {}, { status: 503 }).fetchFn,
    });
    const error = await down.token().catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(PermanentError);
    expect(isRetryable(error)).toBe(true);
  });
});

function sender(
  fetchFn: typeof fetch,
  extra: Partial<ConstructorParameters<typeof FcmPushSender>[0]> = {}
) {
  return new FcmPushSender({
    credentials: new FcmAccessToken({ serviceAccount: account, fetch: fetchFn }),
    render,
    fetch: fetchFn,
    ...extra,
  });
}

describe('FcmPushSender', () => {
  test('mints one access token, then posts the rendered notification to FCM v1', async () => {
    const { fetchFn, exchanges, sends } = fakeFetch(200, { name: 'projects/demo/messages/1' });
    const s = sender(fetchFn, { android: { channel_id: 'default' } });

    await s.send(message);
    await s.send({ ...message, idempotencyKey: 'inst:1' });

    expect(exchanges()).toHaveLength(1);
    expect(sends()).toHaveLength(2);
    expect(sends()[0]?.url).toBe('https://fcm.googleapis.com/v1/projects/demo/messages:send');
    expect(sends()[0]?.auth).toBe('Bearer at-1');
    expect(JSON.parse(sends()[0]?.body ?? '')).toEqual({
      message: {
        token: 'fcm-token-1',
        notification: { title: 'comeback Ada', body: 'b' },
        data: { template: 'comeback', idempotencyKey: 'inst:0' },
        android: { notification: { channel_id: 'default' } },
        apns: { payload: { aps: { sound: 'default' } } },
      },
    });
  });

  test('two senders on one credential carry the same access token', async () => {
    const { fetchFn, exchanges, sends } = fakeFetch(200, {});
    const credentials = new FcmAccessToken({ serviceAccount: account, fetch: fetchFn });
    await sender(fetchFn, { credentials }).send(message);
    await sender(fetchFn, { credentials, android: { channel_id: 'other' } }).send(message);
    expect(exchanges()).toHaveLength(1);
    expect(sends().map((c) => c.auth)).toEqual(['Bearer at-1', 'Bearer at-1']);
  });

  test('a dead token is reported, not retried; other failures throw', async () => {
    const dead = fakeFetch(404, fcmError('NOT_FOUND', 'UNREGISTERED'));
    await expect(sender(dead.fetchFn).send(message)).resolves.toEqual({
      delivered: false,
      reason: 'UNREGISTERED',
    });
    const flaky = fakeFetch(503, fcmError('UNAVAILABLE'));
    await expect(sender(flaky.fetchFn).send(message)).rejects.toThrow('FCM send failed: 503');
    expect(fcmErrorCode('not json')).toBe('');
  });

  /**
   * How each FCM answer ends the copy: a dead token settles it under a `DEAD_TOKEN_REASONS`
   * reason (the host forgets the device), a refused argument settles it with the device kept (it
   * may be the payload, not the token), a configuration problem fails it for good, throttling and
   * outages retry.
   */
  describe('classification', () => {
    type Outcome = 'settled-dead-token' | 'settled-undelivered' | 'PermanentError' | 'retryable';
    const table: [status: number, body: unknown, reason: string, outcome: Outcome][] = [
      [404, fcmError('NOT_FOUND', 'UNREGISTERED'), 'UNREGISTERED', 'settled-dead-token'],
      [404, fcmError('NOT_FOUND'), 'NOT_FOUND', 'settled-dead-token'],
      [
        400,
        fcmError('INVALID_ARGUMENT', 'INVALID_ARGUMENT'),
        'INVALID_ARGUMENT',
        'settled-undelivered',
      ],
      [400, fcmError('INVALID_ARGUMENT'), 'INVALID_ARGUMENT', 'settled-undelivered'],
      [
        403,
        fcmError('PERMISSION_DENIED', 'SENDER_ID_MISMATCH'),
        'SENDER_ID_MISMATCH',
        'PermanentError',
      ],
      [
        401,
        fcmError('UNAUTHENTICATED', 'THIRD_PARTY_AUTH_ERROR'),
        'THIRD_PARTY_AUTH_ERROR',
        'PermanentError',
      ],
      [403, fcmError('PERMISSION_DENIED'), 'PERMISSION_DENIED', 'PermanentError'],
      [400, 'not json', '', 'PermanentError'],
      [401, fcmError('UNAUTHENTICATED'), 'UNAUTHENTICATED', 'retryable'],
      [429, fcmError('RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED'), 'QUOTA_EXCEEDED', 'retryable'],
      [503, fcmError('UNAVAILABLE', 'UNAVAILABLE'), 'UNAVAILABLE', 'retryable'],
      [500, fcmError('INTERNAL', 'INTERNAL'), 'INTERNAL', 'retryable'],
      [429, 'slow down', '', 'retryable'],
      [502, 'bad gateway', '', 'retryable'],
    ];
    /** What the send did, in the table's terms: how it ended, and whether the device is dead. */
    const observe = async (status: number, body: unknown) => {
      const { fetchFn } = fakeFetch(status, body);
      const result = await sender(fetchFn)
        .send(message)
        .then(
          (value) => ({ value, error: undefined }),
          (error: unknown) => ({ value: undefined, error })
        );
      const { error } = result;
      const outcome: Outcome | undefined =
        error === undefined
          ? DEAD_TOKEN_REASONS.has(result.value?.reason ?? '')
            ? 'settled-dead-token'
            : 'settled-undelivered'
          : error instanceof PermanentError
            ? 'PermanentError'
            : 'retryable';
      return {
        outcome,
        settled: result.value,
        retryable: error === undefined ? undefined : isRetryable(error),
        namesStatus: error instanceof Error ? error.message.includes(String(status)) : undefined,
      };
    };
    test.each(table)('%i %j → %s', async (status, body, reason, outcome) => {
      const settled = outcome === 'settled-dead-token' || outcome === 'settled-undelivered';
      expect(await observe(status, body)).toEqual({
        outcome,
        settled: settled ? { delivered: false, reason } : undefined,
        retryable: settled ? undefined : outcome === 'retryable',
        namesStatus: settled ? undefined : true,
      });
    });

    test('a 401 invalidates the credential, so the retry carries a new access token', async () => {
      let status = 401;
      const { fetchFn, sends } = fakeFetch(200, {});
      const credentials = new FcmAccessToken({ serviceAccount: account, fetch: fetchFn });
      const s = sender(
        async (url, init) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
          if (href.endsWith('/token')) return fetchFn(url, init);
          await fetchFn(url, init);
          return new Response(JSON.stringify(fcmError('UNAUTHENTICATED')), { status });
        },
        { credentials }
      );
      await expect(s.send(message)).rejects.toThrow(/401/);
      status = 200;
      await s.send(message);
      expect(sends().map((c) => c.auth)).toEqual(['Bearer at-1', 'Bearer at-2']);
    });
  });

  test('a service account secret that is not base64 JSON, or is incomplete, is permanent', () => {
    expect(() => serviceAccountFromBase64('%%%')).toThrow(PermanentError);
    expect(() => serviceAccountFromBase64(btoa('{oops'))).toThrow(PermanentError);
    expect(() => serviceAccountFromBase64(btoa('{"project_id":"p"}'))).toThrow(PermanentError);
    expect(serviceAccountFromBase64(btoa(JSON.stringify(account)))).toEqual(account);
  });

  test('rejects other channels and missing tokens', async () => {
    const s = new FcmPushSender({
      credentials: new FcmAccessToken({ serviceAccount: account }),
      render,
    });
    await expect(s.send({ ...message, channel: 'email' })).rejects.toThrow(
      "unsupported channel 'email'"
    );
    await expect(s.send({ ...message, recipient: undefined })).rejects.toThrow('no push token');
  });
});
