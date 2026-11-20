import { invariant } from '@shware/utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { OAuth2Error } from '../../error';
import type { RevokeTokenParams } from '../../types';
import { createAppleProvider } from '../apple';

const params: RevokeTokenParams = {
  token: 'r.refresh-token',
  clientId: 'com.example.app',
  clientSecret: 'client-secret-jwt',
};

/** Stubs `fetch` with one response; returns the mock to inspect the request. */
function stubFetch(response: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function revoke(overrides: Partial<RevokeTokenParams> = {}) {
  const provider = createAppleProvider();
  invariant(provider.revokeToken, 'apple supports revokeToken');
  return provider.revokeToken({ ...params, ...overrides });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apple revokeToken', () => {
  test('posts the form Apple documents to /auth/revoke', async () => {
    const fetch = stubFetch(new Response(null, { status: 200 }));
    await revoke({ tokenTypeHint: 'refresh_token' });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://appleid.apple.com/auth/revoke');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe(
      'application/x-www-form-urlencoded'
    );
    expect(Object.fromEntries(new URLSearchParams(init?.body as URLSearchParams))).toEqual({
      client_id: 'com.example.app',
      client_secret: 'client-secret-jwt',
      token: 'r.refresh-token',
      token_type_hint: 'refresh_token',
    });
  });

  test('leaves token_type_hint out when none is given', async () => {
    const fetch = stubFetch(new Response(null, { status: 200 }));
    await revoke();
    const body = new URLSearchParams(fetch.mock.calls[0]?.[1]?.body as URLSearchParams);
    expect(body.has('token_type_hint')).toBe(false);
  });

  test("resolves on Apple's 200, which also answers a token that was already invalid", async () => {
    stubFetch(new Response(null, { status: 200 }));
    await expect(revoke()).resolves.toBeUndefined();
  });

  test("throws Apple's error, e.g. invalid_client for a token of another client", async () => {
    stubFetch(Response.json({ error: 'invalid_client' }, { status: 400 }));
    const error = await revoke().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OAuth2Error);
    expect(error).toMatchObject({ status: 400, error: 'invalid_client' });
  });

  test('a body that is not JSON is a server_error on 5xx, invalid_request on 4xx', async () => {
    stubFetch(new Response('<html>Bad Gateway</html>', { status: 502 }));
    await expect(revoke()).rejects.toMatchObject({ status: 502, error: 'server_error' });

    stubFetch(new Response('nope', { status: 400 }));
    await expect(revoke()).rejects.toMatchObject({ status: 400, error: 'invalid_request' });
  });
});
