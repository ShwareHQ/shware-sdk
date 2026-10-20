import { invariant } from '@shware/utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { NativeCredential } from '../../types';
import { verifyIdToken } from '../common';
import { createGoogleProvider } from '../google';

vi.mock(import('../common'), async (importOriginal) => {
  const actual = await importOriginal();
  vi.spyOn(actual, 'verifyIdToken').mockResolvedValue({ sub: '10001', email: 'a@example.com' });
  return actual;
});

const project = '1009324676376';
const webClient = `${project}-web.apps.googleusercontent.com`;
const iosClient = `${project}-ios.apps.googleusercontent.com`;
const redirectUri = 'https://api.example.com/login/oauth2/code/google';

/** The client is the one the OAuth2 client resolved; the provider exchanges as exactly that one. */
function login(client: { clientId: string; clientSecret?: string }, credentials: NativeCredential) {
  const provider = createGoogleProvider();
  invariant(provider.loginOAuth2Native, 'google supports native login');
  return provider.loginOAuth2Native({ ...client, redirectUri, credentials });
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
  test('exchanges the code as the installed-app client, without a secret', async () => {
    const body = stubTokenEndpoint();
    const { userInfo } = await login(
      { clientId: iosClient },
      {
        code: 'c0de',
        client_id: iosClient,
        redirect_uri: `com.googleusercontent.apps.${project}-ios://`,
      }
    );

    expect(userInfo.claims.sub).toBe('10001');
    expect(body().get('client_id')).toBe(iosClient);
    expect(body().get('redirect_uri')).toBe(`com.googleusercontent.apps.${project}-ios://`);
    expect(body().has('client_secret')).toBe(false);
  });

  test("exchanges as the web client with its secret and the client's redirect URI", async () => {
    const body = stubTokenEndpoint();
    await login({ clientId: webClient, clientSecret: 'web-secret' }, { code: 'c0de' });

    expect(body().get('client_id')).toBe(webClient);
    expect(body().get('client_secret')).toBe('web-secret');
    expect(body().get('redirect_uri')).toBe(redirectUri);
  });

  test('verifies the id token for the client it exchanged as', async () => {
    stubTokenEndpoint();
    await login({ clientId: iosClient }, { code: 'c0de', client_id: iosClient });

    expect(verifyIdToken).toHaveBeenCalledWith('idt', {
      jwkSetUri: 'https://www.googleapis.com/oauth2/v3/certs',
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: iosClient,
    });
  });
});
