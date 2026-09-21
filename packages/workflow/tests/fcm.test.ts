import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, test } from 'vitest';
import { FcmPushSender, type FcmServiceAccount, fcmErrorCode, signJwt } from '../src/fcm';

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

function fakeFetch(fcmStatus: number, fcmBody: unknown) {
  const calls: { url: string; body: string; auth: string | null }[] = [];
  const fetchFn: typeof fetch = async (url, init) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    const headers = new Headers(init?.headers);
    calls.push({ url: href, body: init?.body as string, auth: headers.get('authorization') });
    if (href.endsWith('/token')) {
      return new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3600 }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify(fcmBody), { status: fcmStatus });
  };
  return { calls, fetchFn };
}

const message = {
  channel: 'push' as const,
  template: 'comeback',
  props: { name: 'Ada' },
  userId: 'u1',
  recipient: 'fcm-token-1',
  idempotencyKey: 'inst:0',
};

describe('FcmPushSender', () => {
  test('mints one access token, then posts the rendered notification to FCM v1', async () => {
    const { calls, fetchFn } = fakeFetch(200, { name: 'projects/demo/messages/1' });
    const sender = new FcmPushSender({
      serviceAccount: account,
      render: async (key, props) => ({ title: `${key} ${String(props.name)}`, body: 'b' }),
      android: { channel_id: 'default' },
      fetch: fetchFn,
    });

    await sender.send(message);
    await sender.send({ ...message, idempotencyKey: 'inst:1' });

    expect(calls.filter((c) => c.url.endsWith('/token'))).toHaveLength(1);
    const sends = calls.filter((c) => c.url.includes('/messages:send'));
    expect(sends).toHaveLength(2);
    expect(sends[0]?.url).toBe('https://fcm.googleapis.com/v1/projects/demo/messages:send');
    expect(sends[0]?.auth).toBe('Bearer at-1');
    expect(JSON.parse(sends[0]?.body ?? '')).toEqual({
      message: {
        token: 'fcm-token-1',
        notification: { title: 'comeback Ada', body: 'b' },
        data: { template: 'comeback', idempotencyKey: 'inst:0' },
        android: { notification: { channel_id: 'default' } },
        apns: { payload: { aps: { sound: 'default' } } },
      },
    });
  });

  test('a dead token is reported, not retried; other failures throw', async () => {
    const dead = fakeFetch(404, {
      error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] },
    });
    const gone: string[] = [];
    const sender = new FcmPushSender({
      serviceAccount: account,
      render: async () => ({ title: 't', body: 'b' }),
      fetch: dead.fetchFn,
      onUnregistered: (m) => {
        gone.push(m.userId);
      },
    });
    await expect(sender.send(message)).resolves.toBeUndefined();
    expect(gone).toEqual(['u1']);

    const flaky = fakeFetch(503, { error: { status: 'UNAVAILABLE' } });
    const retrying = new FcmPushSender({
      serviceAccount: account,
      render: async () => ({ title: 't', body: 'b' }),
      fetch: flaky.fetchFn,
    });
    await expect(retrying.send(message)).rejects.toThrow('FCM send failed: 503');
    expect(fcmErrorCode('not json')).toBe('');
  });

  test('rejects other channels and missing tokens', async () => {
    const sender = new FcmPushSender({
      serviceAccount: account,
      render: async () => ({ title: 't', body: 'b' }),
    });
    await expect(sender.send({ ...message, channel: 'email' })).rejects.toThrow(
      "unsupported channel 'email'"
    );
    await expect(sender.send({ ...message, recipient: undefined })).rejects.toThrow(
      'no push token'
    );
  });
});
