import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuth2Client } from '../../oauth2/client';
import { OAuth2Error } from '../../oauth2/error';
import { apple, google } from '../../oauth2/provider/index';
import type { OAuth2Token, UserInfo } from '../../oauth2/types';
import { MapSession } from '../../session/map-session';
import type { KVRepository, SessionRepository } from '../../session/types';
import { AuthenticationError } from '../error';
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
/** A nonce issued for google, as One Tap logins require. */
const NONCE = 'nonce-1';
const kv: KVRepository = {
  setItem: async () => {},
  getItem: async (key) => {
    if (key.includes(EMAIL)) return CODE;
    return key === `oauth2:nonce:${NONCE}` ? 'google' : null;
  },
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
const WEB_CLIENT = 'com.example.web';
const APP_CLIENT = 'com.example.app';
const GOOGLE_CLIENT = '1234-web.apps.googleusercontent.com';

function createAuth() {
  return new Auth({
    sessionRepository: memorySessions(),
    kvRepository: kv,
    oauth2: {
      client: {
        baseUri: 'https://api.test',
        errorUri: 'https://app.test/?status=error',
        successUri: 'https://app.test/',
        providers: {
          apple: { provider: apple, web: { clientId: WEB_CLIENT } },
          google: { provider: google, web: { clientId: GOOGLE_CLIENT } },
        },
      },
    },
  });
}

/** Starts a redirect flow and returns the session cookie and the state the provider would echo. */
async function start(auth: Auth, attributes?: Record<string, string | undefined>) {
  const response = await auth.oauth2Authorization(
    new Request('https://api.test/oauth2/authorization/apple'),
    attributes ? { attributes } : undefined
  );
  const location = new URL(response.headers.get('location') ?? '');
  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return { cookie, state: location.searchParams.get('state') ?? '' };
}

function formPost(cookie: string, state: string, contentType: string, user?: string) {
  return new Request('https://api.test/login/oauth2/code/apple', {
    method: 'POST',
    headers: { cookie, 'content-type': contentType },
    body: new URLSearchParams({ code: 'code-1', state, ...(user ? { user } : {}) }).toString(),
  });
}

beforeEach(() => {
  vi.spyOn(OAuth2Client.prototype, 'createAuthorizationUri').mockImplementation(
    async ({ state }) => new URL(`https://provider.test/authorize?state=${state}`)
  );
  vi.spyOn(OAuth2Client.prototype, 'exchangeAuthorizationCode').mockResolvedValue({
    clientId: WEB_CLIENT,
    token,
  });
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
      provider: 'apple',
      clientId: WEB_CLIENT,
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
      `https://api.test/login/oauth2/code/apple?code=code-1&state=${state}`,
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

  it("hands Apple's first-authorization user to the provider with the token", async () => {
    const getUserInfo = vi.spyOn(OAuth2Client.prototype, 'getUserInfo').mockResolvedValue(userInfo);
    const auth = createAuth();
    const handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));
    const { cookie, state } = await start(auth);
    const user = JSON.stringify({ name: { firstName: 'John', lastName: 'Appleseed' } });

    const response = await auth.loginOAuth2Code(
      formPost(cookie, state, 'application/x-www-form-urlencoded', user),
      handler
    );

    expect(response.headers.get('location')).toContain('status=success');
    expect(getUserInfo).toHaveBeenCalledWith({
      provider: 'apple',
      clientId: WEB_CLIENT,
      token,
      response: { user },
    });
  });

  it('passes no authorization response when the callback carries no user', async () => {
    const getUserInfo = vi.spyOn(OAuth2Client.prototype, 'getUserInfo').mockResolvedValue(userInfo);
    const auth = createAuth();
    const handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));
    const { cookie, state } = await start(auth);

    await auth.loginOAuth2Code(
      formPost(cookie, state, 'application/x-www-form-urlencoded'),
      handler
    );

    expect(getUserInfo.mock.calls[0]?.[0].response).toBeUndefined();
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
      .mockResolvedValue({ clientId: APP_CLIENT, userInfo, token });
    const auth = createAuth();
    const handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));

    const response = await auth.loginOAuth2Native(
      postJson('/login/oauth2/native/apple', {
        id_token: 'id-token',
        attributes: { referralCode: 'abc123' },
      }),
      handler
    );

    expect(response.status).toBe(200);
    expect(native.mock.calls[0]?.[0].credentials).toEqual({ id_token: 'id-token' });
    expect(handler.mock.calls[0]?.[1].attributes).toEqual({ referralCode: 'abc123' });
  });

  it('native: passes fullName on to the provider with the credentials', async () => {
    const native = vi
      .spyOn(OAuth2Client.prototype, 'loginOAuth2Native')
      .mockResolvedValue({ clientId: APP_CLIENT, userInfo, token });
    const auth = createAuth();
    const handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));
    const name = {
      fullName: { givenName: 'John', familyName: 'Appleseed', namePrefix: 'Dr.' },
    };

    const response = await auth.loginOAuth2Native(
      postJson('/login/oauth2/native/apple', { code: 'code-1', ...name }),
      handler
    );

    expect(response.status).toBe(200);
    expect(native.mock.calls[0]?.[0].credentials).toEqual({ code: 'code-1', ...name });
  });

  it('native: refuses attributes that are not strings', async () => {
    vi.spyOn(OAuth2Client.prototype, 'loginOAuth2Native').mockResolvedValue({
      clientId: APP_CLIENT,
      userInfo,
      token,
    });
    const auth = createAuth();
    const handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));

    const response = await auth.loginOAuth2Native(
      postJson('/login/oauth2/native/apple', { id_token: 'x', attributes: { n: 1 } }),
      handler
    );

    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it('one tap: hands JSON attributes over', async () => {
    vi.spyOn(google, 'getTokenInfo').mockResolvedValue({
      token,
      userInfo: { ...userInfo, data: { nonce: NONCE } },
    });
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
      provider: 'EMAIL',
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

describe('oauth2 redirect params', () => {
  async function startWith(redirectParams: Record<string, string | undefined>) {
    const auth = createAuth();
    const response = await auth.oauth2Authorization(
      new Request('https://api.test/oauth2/authorization/apple'),
      { redirectParams }
    );
    const location = new URL(response.headers.get('location') ?? '');
    const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    return { auth, cookie, state: location.searchParams.get('state') ?? '' };
  }

  function callback(cookie: string, query: string) {
    return new Request(`https://api.test/login/oauth2/code/apple?${query}`, {
      headers: { cookie },
    });
  }

  it('adds them to the success redirect, never over its own parameters', async () => {
    const { auth, cookie, state } = await startWith({
      attempt: 'a1',
      status: 'forged',
      missing: undefined,
    });
    const handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));

    const response = await auth.loginOAuth2Code(callback(cookie, `code=c&state=${state}`), handler);

    const location = new URL(response.headers.get('location') ?? '');
    expect(location.searchParams.get('attempt')).toBe('a1');
    expect(location.searchParams.get('status')).toBe('success');
    expect(location.searchParams.get('provider')).toBe('apple');
    expect(location.searchParams.has('missing')).toBe(false);
  });

  it('adds them to the error redirect when the user cancels', async () => {
    const { auth, cookie, state } = await startWith({ attempt: 'a1' });
    const handler = vi.fn<AuthorizedHandler>();

    const response = await auth.loginOAuth2Code(
      callback(cookie, `error=access_denied&state=${state}`),
      handler
    );

    const location = new URL(response.headers.get('location') ?? '');
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('attempt')).toBe('a1');
  });

  it('adds them to the error redirect of a refusal, beside its reason', async () => {
    const { auth, cookie, state } = await startWith({ attempt: 'a1', reason: 'forged' });
    const handler = vi.fn<AuthorizedHandler>(async () => {
      throw new AuthenticationError('EMAIL_ALREADY_USED');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await auth.loginOAuth2Code(callback(cookie, `code=c&state=${state}`), handler);

    const location = new URL(response.headers.get('location') ?? '');
    expect(location.searchParams.get('attempt')).toBe('a1');
    expect(location.searchParams.get('reason')).toBe('EMAIL_ALREADY_USED');
  });

  it('drops the names the redirects use themselves, even where a redirect leaves one out', async () => {
    const { auth, cookie, state } = await startWith({
      attempt: 'a1',
      reason: 'EMAIL_ALREADY_USED',
      provider: 'GOOGLE',
      error_description: 'forged',
    });

    // A cancel carries no reason, provider or description of its own.
    const response = await auth.loginOAuth2Code(
      callback(cookie, `error=access_denied&state=${state}`),
      vi.fn<AuthorizedHandler>()
    );

    const location = new URL(response.headers.get('location') ?? '');
    expect(location.searchParams.get('attempt')).toBe('a1');
    for (const key of ['reason', 'provider', 'error_description']) {
      expect(location.searchParams.has(key)).toBe(false);
    }
  });

  it('adds them on a state mismatch', async () => {
    const { auth, cookie } = await startWith({ attempt: 'a1' });

    const response = await auth.loginOAuth2Code(
      callback(cookie, 'code=c&state=another'),
      vi.fn<AuthorizedHandler>()
    );

    const location = new URL(response.headers.get('location') ?? '');
    expect(location.searchParams.get('error_description')).toBe('redirect state mismatch');
    expect(location.searchParams.get('attempt')).toBe('a1');
  });

  it('adds them when the code exchange fails', async () => {
    const { auth, cookie, state } = await startWith({ attempt: 'a1' });
    vi.spyOn(OAuth2Client.prototype, 'exchangeAuthorizationCode').mockRejectedValueOnce(
      new OAuth2Error(400, 'invalid_grant')
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await auth.loginOAuth2Code(
      callback(cookie, `code=c&state=${state}`),
      vi.fn<AuthorizedHandler>()
    );

    const location = new URL(response.headers.get('location') ?? '');
    expect(location.searchParams.get('error')).toBe('invalid_grant');
    expect(location.searchParams.get('attempt')).toBe('a1');
  });

  it("keeps a refusal's metadata beside the host's parameters", async () => {
    const { auth, cookie, state } = await startWith({ attempt: 'a1', hint: 'host' });
    const handler = vi.fn<AuthorizedHandler>(async () => {
      throw new AuthenticationError('EMAIL_ALREADY_USED', { metadata: { provider: 'GOOGLE' } });
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await auth.loginOAuth2Code(callback(cookie, `code=c&state=${state}`), handler);

    const location = new URL(response.headers.get('location') ?? '');
    expect(location.searchParams.get('provider')).toBe('GOOGLE');
    expect(location.searchParams.get('hint')).toBe('host');
  });

  it('names redirectParams when they are over the limit', async () => {
    await expect(startWith({ attempt: 'x'.repeat(3000) })).rejects.toThrow(/redirectParams/);
  });

  it('cannot add them when the callback finds no session', async () => {
    const { auth, state } = await startWith({ attempt: 'a1' });

    const response = await auth.loginOAuth2Code(
      callback('', `code=c&state=${state}`),
      vi.fn<AuthorizedHandler>()
    );

    const location = new URL(response.headers.get('location') ?? '');
    expect(location.searchParams.get('error')).toBe('invalid_request');
    expect(location.searchParams.has('attempt')).toBe(false);
  });
});
