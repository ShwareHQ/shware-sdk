import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuth2Client } from '../../oauth2/client';
import { google } from '../../oauth2/provider/index';
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

/** Holds one emailed verification code, so loginEmail can be driven end to end. */
const EMAIL = 'user@example.com';
const CODE = '123456';
const kv: KVRepository = {
  setItem: async () => {},
  getItem: async (key) => (key.includes(EMAIL) ? CODE : null),
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
    expect(handler).toHaveBeenCalledWith(expect.any(Request), {
      registrationId: 'appleWeb',
      userInfo,
      token,
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

    expect(handler.mock.calls[0]?.[1].attributes).toEqual({});
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

function postJson(path: string, body: unknown) {
  return new Request(`https://api.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('attributes sent with a login body', () => {
  it('native: hands them to onAuthorized and keeps them out of the credentials', async () => {
    const native = vi
      .spyOn(OAuth2Client.prototype, 'loginOAuth2Native')
      .mockResolvedValue({ userInfo, token });
    const auth = createAuth();
    const handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));

    const response = await auth.loginOAuth2Native(
      postJson('/login/oauth2/native/appleApp', {
        id_token: 'id-token',
        attributes: { referralCode: 'abc123' },
      }),
      handler
    );

    expect(response.status).toBe(200);
    expect(native.mock.calls[0]?.[0].credentials).toEqual({ id_token: 'id-token' });
    expect(handler.mock.calls[0]?.[1].attributes).toEqual({ referralCode: 'abc123' });
  });

  it('native: refuses attributes that are not strings', async () => {
    vi.spyOn(OAuth2Client.prototype, 'loginOAuth2Native').mockResolvedValue({ userInfo, token });
    const auth = createAuth();
    const handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));

    const response = await auth.loginOAuth2Native(
      postJson('/login/oauth2/native/appleApp', { id_token: 'x', attributes: { n: 1 } }),
      handler
    );

    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it('one tap: hands JSON attributes over', async () => {
    vi.spyOn(google, 'getTokenInfo').mockResolvedValue({ token, userInfo });
    const auth = createAuth();
    const handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));

    await auth.loginOAuth2Onetap(
      postJson('/login/oauth2/onetap/google', {
        credential: 'jwt',
        attributes: { referralCode: 'abc123' },
      }),
      handler
    );

    expect(handler.mock.calls[0]?.[1].attributes).toEqual({ referralCode: 'abc123' });
  });

  it('email: hands them over, and passes {} when absent', async () => {
    const auth = createAuth();
    const handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));

    await auth.loginEmail(
      postJson('/login/email', {
        email: EMAIL,
        verificationCode: CODE,
        attributes: { referralCode: 'abc123' },
      }),
      handler
    );
    await auth.loginEmail(
      postJson('/login/email', { email: EMAIL, verificationCode: CODE }),
      handler
    );

    expect(handler.mock.calls[0]?.[1]).toMatchObject({
      registrationId: 'EMAIL',
      attributes: { referralCode: 'abc123' },
    });
    expect(handler.mock.calls[1]?.[1].attributes).toEqual({});
  });

  it('email: refuses attributes over 2 KB', async () => {
    const auth = createAuth();
    const handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));

    const response = await auth.loginEmail(
      postJson('/login/email', {
        email: EMAIL,
        verificationCode: CODE,
        attributes: { blob: 'x'.repeat(2100) },
      }),
      handler
    );

    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });
});
