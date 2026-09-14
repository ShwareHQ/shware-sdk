import { invariant } from '@shware/utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { OAuth2Error } from '../../error';
import type { NativeCredential } from '../../types';
import type * as Common from '../common';
import { createGoogleProvider } from '../google';

vi.mock('../common', async (importOriginal) => ({
  ...(await importOriginal<typeof Common>()),
  verifyIdToken: vi
    .fn<() => Promise<{ sub: string; email: string }>>()
    .mockResolvedValue({ sub: '10001', email: 'a@example.com' }),
}));

const project = '1009324676376';
const webClient = `${project}-web.apps.googleusercontent.com`;
const iosClient = `${project}-ios.apps.googleusercontent.com`;
const registration = {
  clientId: webClient,
  clientSecret: 'web-secret',
  redirectUri: 'https://api.example.com/login/oauth2/code/google',
};

function login(credentials: NativeCredential) {
  const provider = createGoogleProvider();
  invariant(provider.loginOAuth2Native, 'google supports native login');
  return provider.loginOAuth2Native({ ...registration, credentials });
}

/** Stubs Google's token endpoint; returns a reader for the form body of the exchange request. */
function stubTokenEndpoint() {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(
      Response.json({ access_token: 'at', id_token: 'idt', token_type: 'Bearer', expires_in: 3600 })
    );
  vi.stubGlobal('fetch', fetch);
  return () => {
    const [, init] = fetch.mock.calls[0] ?? [];
    return new URLSearchParams(init?.body as URLSearchParams);
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('google loginOAuth2Native', () => {
  test("exchanges the code for the app's own client, without the web client's secret", async () => {
    const body = stubTokenEndpoint();
    const { userInfo } = await login({
      code: 'c0de',
      client_id: iosClient,
      redirect_uri: `com.googleusercontent.apps.${project}-ios://`,
    });

    expect(userInfo.claims.sub).toBe('10001');
    expect(body().get('client_id')).toBe(iosClient);
    expect(body().get('redirect_uri')).toBe(`com.googleusercontent.apps.${project}-ios://`);
    expect(body().has('client_secret')).toBe(false);
  });

  test('falls back to the registration, secret included, when the app names no client', async () => {
    const body = stubTokenEndpoint();
    await login({ code: 'c0de' });

    expect(body().get('client_id')).toBe(webClient);
    expect(body().get('client_secret')).toBe('web-secret');
    expect(body().get('redirect_uri')).toBe(registration.redirectUri);
  });

  test('refuses a client from another Google Cloud project', async () => {
    stubTokenEndpoint();
    await expect(
      login({ code: 'c0de', client_id: '999-evil.apps.googleusercontent.com' })
    ).rejects.toMatchObject({
      status: 400,
      error: 'invalid_client',
    } satisfies Partial<OAuth2Error>);
    expect(fetch).not.toHaveBeenCalled();
  });
});
