import { decodeProtectedHeader, exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { createAppleClientSecret } from '../apple-client-secret';

const teamId = 'TEAM123456';
const keyId = 'KEY1234567';
let privateKey: string;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  privateKey = await exportPKCS8(pair.privateKey);
  publicKey = pair.publicKey;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createAppleClientSecret', () => {
  test('signs the JWT Apple expects for the given client id', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    const secret = await createAppleClientSecret({ teamId, keyId, privateKey })('io.example.app');

    expect(decodeProtectedHeader(secret)).toEqual({ alg: 'ES256', kid: keyId });
    const { payload } = await jwtVerify(secret, publicKey, {
      issuer: teamId,
      subject: 'io.example.app',
      audience: 'https://appleid.apple.com',
    });
    const now = Math.floor(Date.now() / 1000);
    expect(payload.iat).toBe(now);
    expect(payload.exp).toBe(now + 3600);
  });

  test('caches per client id and re-signs shortly before expiry', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    const clientSecret = createAppleClientSecret({
      teamId,
      keyId,
      privateKey,
      expiresIn: 600,
      renewBefore: 60,
    });

    const app = await clientSecret('io.example.app');
    expect(await clientSecret('io.example.app')).toBe(app);

    // 5 minutes in: the app secret has 300 s left and is still served from the cache.
    vi.advanceTimersByTime(300_000);
    const web = await clientSecret('io.example.web');
    expect(web).not.toBe(app);
    expect(await clientSecret('io.example.app')).toBe(app);

    // 9 minutes in: 60 s left on the app secret, the renewal threshold — re-signed; the web
    // secret, minted later, still has 360 s and is untouched.
    vi.advanceTimersByTime(240_000);
    const renewed = await clientSecret('io.example.app');
    expect(renewed).not.toBe(app);
    const { payload } = await jwtVerify(renewed, publicKey);
    expect(payload.exp).toBe(Math.floor(Date.now() / 1000) + 600);
    expect(await clientSecret('io.example.web')).toBe(web);
  });

  test('rejects a renewal window that swallows the whole lifetime', () => {
    expect(() =>
      createAppleClientSecret({ teamId, keyId, privateKey, expiresIn: 60, renewBefore: 60 })
    ).toThrow('renewBefore must be shorter than expiresIn');
  });

  test('retries the key import after it fails', async () => {
    const clientSecret = createAppleClientSecret({ teamId, keyId, privateKey: 'not a pem' });
    await expect(clientSecret('io.example.app')).rejects.toThrow(/PKCS8|PEM|import|key/i);
    await expect(clientSecret('io.example.app')).rejects.toThrow(/PKCS8|PEM|import|key/i);
  });
});
