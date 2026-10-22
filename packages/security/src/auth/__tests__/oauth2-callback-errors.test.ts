import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuth2Client } from '../../oauth2/client';
import { OAuth2Error } from '../../oauth2/error';
import { google } from '../../oauth2/provider/index';
import type { OAuth2Token, UserInfo } from '../../oauth2/types';
import { MapSession } from '../../session/map-session';
import type { KVRepository, SessionRepository } from '../../session/types';
import { Auth } from '../index';
import type { AuthorizedHandler } from '../types';

function memorySessions(): SessionRepository<MapSession> {
  const store = new Map<string, MapSession>();
  return {
    createSession: () => new MapSession(),
    save: async (session) => {
      store.set(session.getId(), new MapSession(session));
    },
    findById: async (id) => {
      const found = store.get(id);
      return found ? new MapSession(found) : null;
    },
    deleteById: async (id) => {
      store.delete(id);
    },
    findByIndexNameAndIndexValue: async () => new Map(),
    findByPrincipalName: async () => new Map(),
    cleanupExpiredSessions: async () => {},
  };
}

const kv: KVRepository = {
  setItem: async () => {},
  getItem: async () => null,
  removeItem: async () => {},
  increment: async () => 1,
};

const token: OAuth2Token = {
  access_token: 'access',
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: '',
  scope: '',
  id_token: '',
};
const userInfo: UserInfo = { data: {}, claims: { sub: 'user-1' } };
const CLIENT = '1234-web.apps.googleusercontent.com';
const ERROR_URI = 'https://app.test/?status=error';

function createAuth() {
  return new Auth({
    sessionRepository: memorySessions(),
    kvRepository: kv,
    oauth2: {
      client: {
        baseUri: 'https://api.test',
        errorUri: ERROR_URI,
        successUri: 'https://app.test/',
        providers: { google: { provider: google, web: { clientId: CLIENT } } },
      },
    },
  });
}

async function start(auth: Auth) {
  const response = await auth.oauth2Authorization(
    new Request('https://api.test/oauth2/authorization/google')
  );
  const location = new URL(response.headers.get('location') ?? '');
  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return { cookie, state: location.searchParams.get('state') ?? '' };
}

function callback(cookie: string, params: Record<string, string>) {
  const search = new URLSearchParams(params).toString();
  return new Request(`https://api.test/login/oauth2/code/google?${search}`, {
    headers: { cookie },
  });
}

function errorRedirect(response: Response) {
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get('location') ?? '');
  expect(`${location.origin}${location.pathname}`).toBe('https://app.test/');
  expect(location.searchParams.get('status')).toBe('error');
  return {
    error: location.searchParams.get('error'),
    description: location.searchParams.get('error_description'),
  };
}

const handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));
let exchange: MockInstance<OAuth2Client['exchangeAuthorizationCode']>;

beforeEach(() => {
  handler.mockClear();
  vi.spyOn(OAuth2Client.prototype, 'createAuthorizationUri').mockImplementation(
    async ({ state }) => new URL(`https://provider.test/authorize?state=${state}`)
  );
  exchange = vi.spyOn(OAuth2Client.prototype, 'exchangeAuthorizationCode').mockResolvedValue({
    clientId: CLIENT,
    token,
  });
  vi.spyOn(OAuth2Client.prototype, 'getUserInfo').mockResolvedValue(userInfo);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('oauth2 callback errors', () => {
  it('forwards a provider error and its description to errorUri', async () => {
    const auth = createAuth();
    const { cookie, state } = await start(auth);

    const response = await auth.loginOAuth2Code(
      callback(cookie, {
        error: 'access_denied',
        error_description: 'The user denied the request',
        state,
      }),
      handler
    );

    expect(errorRedirect(response)).toEqual({
      error: 'access_denied',
      description: 'The user denied the request',
    });
    expect(exchange).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('forwards a provider error that comes back without state', async () => {
    const auth = createAuth();
    const { cookie } = await start(auth);

    const response = await auth.loginOAuth2Code(
      callback(cookie, { error: 'invalid_scope' }),
      handler
    );

    expect(errorRedirect(response)).toEqual({ error: 'invalid_scope', description: null });
  });

  it('reports a state mismatch over the provider error', async () => {
    const auth = createAuth();
    const { cookie } = await start(auth);

    const response = await auth.loginOAuth2Code(
      callback(cookie, { error: 'access_denied', state: 'forged' }),
      handler
    );

    expect(errorRedirect(response).error).toBe('invalid_request');
    expect(errorRedirect(response).description).toBe('redirect state mismatch');
  });

  it('maps an unknown provider error to server_error and truncates the description', async () => {
    const auth = createAuth();
    const { cookie, state } = await start(auth);

    const response = await auth.loginOAuth2Code(
      callback(cookie, { error: '<script>', error_description: 'x'.repeat(1000), state }),
      handler
    );

    const { error, description } = errorRedirect(response);
    expect(error).toBe('server_error');
    expect(description).toHaveLength(256);
  });

  it('redirects with the type of an OAuth2Error thrown by the code exchange', async () => {
    exchange.mockRejectedValue(new OAuth2Error(400, 'invalid_grant', 'code expired'));
    const auth = createAuth();
    const { cookie, state } = await start(auth);

    const response = await auth.loginOAuth2Code(callback(cookie, { code: 'c', state }), handler);

    expect(errorRedirect(response)).toEqual({
      error: 'invalid_grant',
      description: 'code expired',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('logs any other failure and redirects with server_error', async () => {
    const failure = new Error('database is down');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const auth = createAuth();
    const { cookie, state } = await start(auth);

    const response = await auth.loginOAuth2Code(
      callback(cookie, { code: 'c', state }),
      vi.fn<AuthorizedHandler>(async () => {
        throw failure;
      })
    );

    expect(errorRedirect(response)).toEqual({ error: 'server_error', description: null });
    expect(log).toHaveBeenCalledWith(expect.any(String), failure);
  });

  it('keeps the success redirect unchanged', async () => {
    const auth = createAuth();
    const { cookie, state } = await start(auth);

    const response = await auth.loginOAuth2Code(callback(cookie, { code: 'c', state }), handler);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://app.test/?status=success&provider=google'
    );
    expect(response.headers.get('set-cookie')).toContain(cookie);
    expect(handler).toHaveBeenCalledOnce();
  });
});
