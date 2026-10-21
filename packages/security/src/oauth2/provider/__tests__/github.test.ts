import { afterEach, describe, expect, test, vi } from 'vitest';
import { OAuth2Error } from '../../error';
import { createGithubProvider } from '../github';

const client = { clientId: 'gh-client', clientSecret: 'gh-secret' };
const redirectUri = 'https://api.example.com/login/oauth2/code/github';

/** Stubs `fetch` with the given responses in order; returns the mock to inspect the requests. */
function stubFetch(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function headersOf(fetch: ReturnType<typeof stubFetch>, call: number) {
  const [, init] = fetch.mock.calls[call] ?? [];
  return new Headers(init?.headers);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('github exchangeAuthorizationCode', () => {
  test('sends a User-Agent to the token endpoint', async () => {
    const fetch = stubFetch(
      Response.json({ access_token: 'at', token_type: 'bearer', scope: 'user:email' })
    );
    const token = await createGithubProvider().exchangeAuthorizationCode({
      ...client,
      code: 'c0de',
      redirectUri,
    });

    expect(token.access_token).toBe('at');
    expect(headersOf(fetch, 0).get('User-Agent')).toBe('@shware/security');
  });

  test('refuses an error body answered with HTTP 200', async () => {
    stubFetch(
      Response.json({
        error: 'bad_verification_code',
        error_description: 'The code passed is incorrect or expired.',
        error_uri: 'https://docs.github.com/apps/troubleshooting',
      })
    );
    const exchange = createGithubProvider().exchangeAuthorizationCode({
      ...client,
      code: 'c0de',
      redirectUri,
    });

    const error = await exchange.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OAuth2Error);
    expect(error).toMatchObject({ status: 400, error: 'bad_verification_code' });
    expect((error as OAuth2Error).message).toBe('The code passed is incorrect or expired.');
  });
});

describe('github getUserInfo', () => {
  test('sends a User-Agent to the user and emails APIs', async () => {
    const fetch = stubFetch(
      Response.json({ id: '1', login: 'octocat', name: 'The Octocat', email: null }),
      Response.json([{ email: 'octo@example.com', primary: true, verified: true }])
    );
    const { claims } = await createGithubProvider().getUserInfo(
      { access_token: 'at', token_type: 'bearer' },
      { clientId: client.clientId }
    );

    expect(claims.email).toBe('octo@example.com');
    expect(claims.email_verified).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(headersOf(fetch, 0).get('User-Agent')).toBe('@shware/security');
    expect(headersOf(fetch, 1).get('User-Agent')).toBe('@shware/security');
  });

  test('surfaces the status and body of a failed user request', async () => {
    stubFetch(
      new Response('Request forbidden by administrative rules.', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' },
      })
    );
    const userInfo = createGithubProvider().getUserInfo(
      { access_token: 'at', token_type: 'bearer' },
      { clientId: client.clientId }
    );

    const error = await userInfo.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OAuth2Error);
    expect(error).toMatchObject({ status: 403, error: 'invalid_request' });
    expect((error as OAuth2Error).message).toContain('HTTP 403');
    expect((error as OAuth2Error).message).toContain('Request forbidden by administrative rules.');
  });
});
