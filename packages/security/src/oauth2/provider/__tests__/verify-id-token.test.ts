import { createRemoteJWKSet, jwtVerify } from 'jose';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { verifyIdToken } from '../common';

vi.mock(import('jose'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createRemoteJWKSet: vi.fn<typeof actual.createRemoteJWKSet>(() =>
      vi.fn<ReturnType<typeof actual.createRemoteJWKSet>>()
    ),
    // jwtVerify is overloaded, so the mock is typed loosely and cast.
    jwtVerify: vi.fn<() => Promise<unknown>>(async () => ({ payload: { sub: 'user-1' } })) as never,
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('verifyIdToken', () => {
  test('reuses one remote key set per JWKS endpoint', async () => {
    const google = { jwkSetUri: 'https://jwks.test/google', issuer: 'g', audience: 'app' };
    const apple = { jwkSetUri: 'https://jwks.test/apple', issuer: 'a', audience: 'app' };

    await verifyIdToken('t1', google);
    await verifyIdToken('t2', google);
    await verifyIdToken('t3', apple);

    expect(createRemoteJWKSet).toHaveBeenCalledTimes(2);
    const [first, second, third] = vi.mocked(jwtVerify).mock.calls.map(([, keys]) => keys);
    expect(first).toBe(second);
    expect(third).not.toBe(first);
  });
});
