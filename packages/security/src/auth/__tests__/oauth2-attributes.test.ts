import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuth2Client } from '../../oauth2/client';
import type { OAuth2Token, UserInfo } from '../../oauth2/types';
import { MapSession } from '../../session/map-session';
import type { KVRepository, SessionRepository } from '../../session/types';
import { Auth } from '../index';
import type { AuthorizedHandler } from '../types';

/** Sessions kept in memory, copied on save and load like a real store would serialize them. */
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

function createAuth() {
  return new Auth({
    sessionRepository: memorySessions(),
    kvRepository: kv,
    oauth2: {
      client: {
        baseUri: 'https://api.test',
        errorUri: 'https://app.test/?status=error',
        successUri: 'https://app.test/',
        provider: {},
        registration: {},
      },
    },
  });
}

/** Starts a redirect flow and returns the session cookie and the state the provider would echo. */
async function start(auth: Auth, attributes?: Record<string, string | undefined>) {
  const response = await auth.oauth2Authorization(
    new Request('https://api.test/oauth2/authorization/appleWeb'),
    attributes ? { attributes } : undefined
  );
  const location = new URL(response.headers.get('location') ?? '');
  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return { cookie, state: location.searchParams.get('state') ?? '' };
}

function formPost(cookie: string, state: string, contentType: string) {
  return new Request('https://api.test/login/oauth2/code/appleWeb', {
    method: 'POST',
    headers: { cookie, 'content-type': contentType },
    body: new URLSearchParams({ code: 'code-1', state }).toString(),
  });
}

beforeEach(() => {
  vi.spyOn(OAuth2Client.prototype, 'createAuthorizationUri').mockImplementation(
    async ({ state }) => new URL(`https://provider.test/authorize?state=${state}`)
  );
  vi.spyOn(OAuth2Client.prototype, 'exchangeAuthorizationCode').mockResolvedValue(token);
  vi.spyOn(OAuth2Client.prototype, 'getUserInfo').mockResolvedValue(userInfo);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('oauth2 authorization attributes', () => {
  it('hands the attributes of the started flow to onAuthorized', async () => {
    const auth = createAuth();
    const handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));
    const { cookie, state } = await start(auth, { referralCode: 'abc123', missing: undefined });

    const response = await auth.loginOAuth2Code(
      formPost(cookie, state, 'application/x-www-form-urlencoded'),
      handler
    );

    expect(response.headers.get('location')).toContain('status=success');
    expect(handler).toHaveBeenCalledWith(expect.any(Request), 'appleWeb', userInfo, token, {
      attributes: { referralCode: 'abc123' },
    });
  });

  it('passes empty attributes when the flow started without any', async () => {
    const auth = createAuth();
    const handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));
    const { cookie, state } = await start(auth);

    const callback = new Request(
      `https://api.test/login/oauth2/code/appleWeb?code=code-1&state=${state}`,
      { headers: { cookie } }
    );
    await auth.loginOAuth2Code(callback, handler);

    expect(handler.mock.calls[0]?.[4]).toEqual({ attributes: {} });
  });

  it('uses the attributes once: a replayed callback finds no authorization request', async () => {
    const auth = createAuth();
    const handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));
    const { cookie, state } = await start(auth, { referralCode: 'abc123' });

    await auth.loginOAuth2Code(
      formPost(cookie, state, 'application/x-www-form-urlencoded'),
      handler
    );
    const replay = await auth.loginOAuth2Code(
      formPost(cookie, state, 'application/x-www-form-urlencoded'),
      handler
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(replay.headers.get('location')).toContain('error=invalid_request');
  });

  it('does not hand the attributes over when the state does not match', async () => {
    const auth = createAuth();
    const handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));
    const { cookie } = await start(auth, { referralCode: 'abc123' });

    const response = await auth.loginOAuth2Code(
      formPost(cookie, 'forged-state', 'application/x-www-form-urlencoded'),
      handler
    );

    expect(handler).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toContain('redirect+state+mismatch');
  });

  it('refuses attributes over 2 KB', async () => {
    const auth = createAuth();
    await expect(start(auth, { blob: 'x'.repeat(2100) })).rejects.toThrow(/at most 2048/);
  });
});

describe('form_post callback', () => {
  it('reads a form body whose content type carries a charset', async () => {
    const auth = createAuth();
    const handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));
    const { cookie, state } = await start(auth);

    const response = await auth.loginOAuth2Code(
      formPost(cookie, state, 'application/x-www-form-urlencoded; charset=UTF-8'),
      handler
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.headers.get('location')).toContain('status=success');
  });
});
