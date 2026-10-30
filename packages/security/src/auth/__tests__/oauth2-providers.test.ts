import { createHmac } from 'node:crypto';
import { type JWTPayload, SignJWT, exportJWK, generateKeyPair } from 'jose';
import { type Mock, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apple, facebook, google } from '../../oauth2/provider/index';
import { MapSession } from '../../session/map-session';
import type { KVRepository, SessionRepository } from '../../session/types';
import { Auth } from '../index';
import type { AuthorizedHandler } from '../types';

/**
 * End to end through `Auth` and the real providers: only the network is stubbed. Id tokens are
 * signed with a local key whose JWKS is served at each provider's JWKS URL, so audience, issuer and
 * nonce checks run exactly as in production.
 */

const APPLE_WEB = 'com.example.web'; // Services ID
const APPLE_APP = 'com.example.app'; // bundle id
const GOOGLE_WEB = '1234-web.apps.googleusercontent.com';
const GOOGLE_IOS = '1234-ios.apps.googleusercontent.com';
const GOOGLE_ANDROID = '1234-android.apps.googleusercontent.com';
const FACEBOOK_APP = '555000';

const APPLE_ISS = 'https://appleid.apple.com';
const GOOGLE_ISS = 'https://accounts.google.com';
const FACEBOOK_ISS = 'https://www.facebook.com';

let privateKey: CryptoKey;
let jwks: { keys: object[] };

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] };
});

function sign(claims: JWTPayload & { iss: string; aud: string }) {
  return new SignJWT({ sub: 'user-1', email: 'a@example.com', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

/** What the stubbed token endpoints answer with: an id token, set per test. */
let issuedIdToken: string;

const fetchMock = vi.fn<typeof fetch>();

function urlOf(input: string | URL | Request) {
  return new URL(input instanceof Request ? input.url : input);
}

function route(input: string | URL | Request): Response {
  const url = urlOf(input);
  const jwksUris = [
    'https://appleid.apple.com/auth/keys',
    'https://www.googleapis.com/oauth2/v3/certs',
    'https://limited.facebook.com/.well-known/oauth/openid/jwks/',
  ];
  if (jwksUris.includes(url.href)) return Response.json(jwks);
  if (
    url.href === 'https://appleid.apple.com/auth/token' ||
    url.href === 'https://oauth2.googleapis.com/token'
  ) {
    return Response.json({
      access_token: 'at',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'rt',
      id_token: issuedIdToken,
    });
  }
  if (url.origin + url.pathname === 'https://graph.facebook.com/me') {
    return Response.json({
      id: 'fb-1',
      name: 'Jane',
      email: 'jane@example.com',
      email_verified: true,
      picture: {
        data: { url: 'https://example.com/p.png', width: 1, height: 1, is_silhouette: false },
      },
    });
  }
  throw new Error(`unexpected fetch: ${url.href}`);
}

/** Form bodies posted to a token endpoint, in order. */
function tokenRequests() {
  return fetchMock.mock.calls
    .filter(([input]) => urlOf(input).pathname.endsWith('/token'))
    .map(([, init]) => new URLSearchParams(init?.body as URLSearchParams));
}

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

function memoryKV(): KVRepository & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    setItem: async (key, value) => {
      store.set(key, value);
    },
    getItem: async (key) => store.get(key) ?? null,
    removeItem: async (key) => {
      store.delete(key);
    },
    increment: async (key) => {
      const count = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(count));
      return count;
    },
  };
}

let appleSecret: Mock<(clientId: string) => Promise<string>>;
let kv: ReturnType<typeof memoryKV>;
let handler: Mock<AuthorizedHandler>;

function createAuth(nonce?: { optional?: string[] }) {
  return new Auth({
    sessionRepository: memorySessions(),
    kvRepository: kv,
    oauth2: {
      nonce,
      client: {
        baseUri: 'https://api.test',
        errorUri: 'https://app.test/?status=error',
        successUri: 'https://app.test/',
        providers: {
          apple: {
            provider: apple,
            web: { clientId: APPLE_WEB, clientSecret: appleSecret },
            native: [{ clientId: APPLE_APP, clientSecret: appleSecret }],
          },
          google: {
            provider: google,
            web: { clientId: GOOGLE_WEB, clientSecret: 'google-secret' },
            native: [{ clientId: GOOGLE_IOS }, { clientId: GOOGLE_ANDROID }],
          },
          facebook: {
            provider: facebook,
            web: { clientId: FACEBOOK_APP, clientSecret: 'fb-secret' },
          },
          facebookPublic: { provider: facebook, native: [{ clientId: FACEBOOK_APP }] },
        },
      },
    },
  });
}

function postJson(path: string, body: unknown) {
  return new Request(`https://api.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The reason of a google.rpc error body. */
async function reasonOf(response: Response) {
  const body = (await response.json()) as { error: { details: { reason: string }[] } };
  return body.error.details[0]?.reason;
}

/** A login the JSON routes refused: 403 with the reason, nobody signed in. */
async function refused(login: Promise<Response>, reason: string) {
  const response = await login;
  expect(response.status).toBe(403);
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(await reasonOf(response)).toBe(reason);
}

/** A nonce from `GET /oauth2/nonce/:provider`, as the web app fetches before One Tap's `prompt`. */
async function issueNonce(auth: Auth, provider = 'google') {
  const response = await auth.oauth2Nonce(new Request(`https://api.test/oauth2/nonce/${provider}`));
  const { nonce } = (await response.json()) as { nonce: string };
  return nonce;
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => route(input));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  appleSecret = vi.fn<(clientId: string) => Promise<string>>(
    async (clientId: string) => `secret-for-${clientId}`
  );
  kv = memoryKV();
  handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A PKCE verifier using every kind of RFC 7636 unreserved character. */
const CODE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk.~';

describe('Sign in with Apple: app and web under one provider', () => {
  it('native: exchanges as the bundle id, with the secret minted for it', async () => {
    const auth = createAuth();
    issuedIdToken = await sign({
      iss: APPLE_ISS,
      aud: APPLE_APP,
      nonce: await issueNonce(auth, 'apple'),
    });

    const response = await auth.loginOAuth2Native(
      postJson('/login/oauth2/native/apple', { code: 'c0de' }),
      handler
    );

    expect(response.status).toBe(200);
    expect(appleSecret).toHaveBeenCalledWith(APPLE_APP);
    const body = tokenRequests()[0];
    expect(body.get('client_id')).toBe(APPLE_APP);
    expect(body.get('client_secret')).toBe(`secret-for-${APPLE_APP}`);
    expect(handler.mock.calls[0]?.[1]).toMatchObject({ provider: 'apple', clientId: APPLE_APP });
  });

  it('native: leaves a code_verifier out of the exchange, as Apple takes none', async () => {
    const auth = createAuth();
    issuedIdToken = await sign({
      iss: APPLE_ISS,
      aud: APPLE_APP,
      nonce: await issueNonce(auth, 'apple'),
    });
    const response = await auth.loginOAuth2Native(
      postJson('/login/oauth2/native/apple', { code: 'c0de', code_verifier: CODE_VERIFIER }),
      handler
    );

    expect(response.status).toBe(200);
    expect(tokenRequests()[0]?.has('code_verifier')).toBe(false);
  });

  /** Starts the redirect flow: the session cookie, the state and the nonce the request sent. */
  async function startWebFlow(auth: Auth, provider = 'apple') {
    const start = await auth.oauth2Authorization(
      new Request(`https://api.test/oauth2/authorization/${provider}`)
    );
    const location = new URL(start.headers.get('location') ?? '');
    const cookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const state = location.searchParams.get('state') ?? '';
    const nonce = location.searchParams.get('nonce') ?? '';
    return { location, cookie, state, nonce };
  }

  function appleCallback(cookie: string, state: string) {
    return new Request('https://api.test/login/oauth2/code/apple', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: 'c0de', state }).toString(),
    });
  }

  it('web: redirects and exchanges as the Services ID, and reports the provider', async () => {
    const auth = createAuth();

    const { location, cookie, state, nonce } = await startWebFlow(auth);
    expect(location.searchParams.get('client_id')).toBe(APPLE_WEB);
    expect(location.searchParams.get('redirect_uri')).toBe(
      'https://api.test/login/oauth2/code/apple'
    );
    expect(nonce).not.toBe('');
    issuedIdToken = await sign({ iss: APPLE_ISS, aud: APPLE_WEB, nonce });

    const callback = await auth.loginOAuth2Code(appleCallback(cookie, state), handler);

    const success = new URL(callback.headers.get('location') ?? '');
    expect(success.searchParams.get('status')).toBe('success');
    expect(success.searchParams.get('provider')).toBe('apple');
    expect(success.searchParams.has('registrationId')).toBe(false);
    expect(appleSecret).toHaveBeenCalledWith(APPLE_WEB);
    expect(appleSecret).not.toHaveBeenCalledWith(APPLE_APP);
    expect(tokenRequests()[0]?.get('client_id')).toBe(APPLE_WEB);
    expect(handler.mock.calls[0]?.[1]).toMatchObject({ provider: 'apple', clientId: APPLE_WEB });
  });

  it('web: refuses a callback whose id token lacks the nonce it sent, or carries another', async () => {
    const auth = createAuth();
    for (const nonce of [undefined, 'another']) {
      const { cookie, state } = await startWebFlow(auth);
      issuedIdToken = await sign({ iss: APPLE_ISS, aud: APPLE_WEB, ...(nonce ? { nonce } : {}) });
      const callback = await auth.loginOAuth2Code(appleCallback(cookie, state), handler);
      const error = new URL(callback.headers.get('location') ?? '');
      expect(error.searchParams.get('status')).toBe('error');
      expect(error.searchParams.get('reason')).toBe(nonce ? 'NONCE_MISMATCH' : 'NONCE_MISSING');
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('native: refuses an id token issued to another client, even one of ours', async () => {
    const auth = createAuth();
    for (const aud of ['com.attacker.app', APPLE_WEB]) {
      issuedIdToken = await sign({ iss: APPLE_ISS, aud });
      await refused(
        auth.loginOAuth2Native(postJson('/login/oauth2/native/apple', { code: 'c0de' }), handler),
        'OAUTH2_INVALID_GRANT'
      );
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('native: refuses an id token from another issuer', async () => {
    issuedIdToken = await sign({ iss: 'https://evil.example.com', aud: APPLE_APP });
    const auth = createAuth();
    await refused(
      auth.loginOAuth2Native(postJson('/login/oauth2/native/apple', { code: 'c0de' }), handler),
      'OAUTH2_INVALID_GRANT'
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('native: refuses a client_id that is not configured, before calling Apple', async () => {
    const auth = createAuth();
    await refused(
      auth.loginOAuth2Native(
        postJson('/login/oauth2/native/apple', { code: 'c0de', client_id: 'com.attacker.app' }),
        handler
      ),
      'OAUTH2_INVALID_CLIENT'
    );
    expect(tokenRequests()).toHaveLength(0);
    expect(appleSecret).not.toHaveBeenCalled();
  });
});

describe('nonce', () => {
  it('accepts a nonce issued for the provider, once', async () => {
    const auth = createAuth();
    const { nonce } = (await (
      await auth.oauth2Nonce(new Request('https://api.test/oauth2/nonce/apple'))
    ).json()) as { nonce: string };
    expect(kv.store.get(`oauth2:nonce:${nonce}`)).toBe('apple');
    issuedIdToken = await sign({ iss: APPLE_ISS, aud: APPLE_APP, nonce });

    const first = await auth.loginOAuth2Native(
      postJson('/login/oauth2/native/apple', { code: 'c0de' }),
      handler
    );
    const replay = await auth.loginOAuth2Native(
      postJson('/login/oauth2/native/apple', { code: 'c0de' }),
      handler
    );

    expect(first.status).toBe(200);
    expect(replay.status).toBe(403);
    expect(await reasonOf(replay)).toBe('NONCE_MISMATCH');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('native: refuses an Apple id token without a nonce, unless apple is listed as optional', async () => {
    issuedIdToken = await sign({ iss: APPLE_ISS, aud: APPLE_APP });
    const login = (auth: Auth) =>
      auth.loginOAuth2Native(postJson('/login/oauth2/native/apple', { code: 'c0de' }), handler);

    await refused(login(createAuth()), 'NONCE_MISSING');
    expect(handler).not.toHaveBeenCalled();
    expect((await login(createAuth({ optional: ['apple'] }))).status).toBe(200);
  });

  it('native: still checks a nonce the token carries when apple is listed as optional', async () => {
    issuedIdToken = await sign({ iss: APPLE_ISS, aud: APPLE_APP, nonce: 'made-up' });
    await refused(
      createAuth({ optional: ['apple'] }).loginOAuth2Native(
        postJson('/login/oauth2/native/apple', { code: 'c0de' }),
        handler
      ),
      'NONCE_MISMATCH'
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses a nonce issued for another provider', async () => {
    const auth = createAuth();
    const { nonce } = (await (
      await auth.oauth2Nonce(new Request('https://api.test/oauth2/nonce/google'))
    ).json()) as { nonce: string };
    issuedIdToken = await sign({ iss: APPLE_ISS, aud: APPLE_APP, nonce });

    const response = await auth.loginOAuth2Native(
      postJson('/login/oauth2/native/apple', { code: 'c0de' }),
      handler
    );

    await refused(Promise.resolve(response), 'NONCE_MISMATCH');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('Google', () => {
  it('one tap: accepts a credential issued to the web client', async () => {
    const auth = createAuth();
    const nonce = await issueNonce(auth);
    const credential = await sign({ iss: GOOGLE_ISS, aud: GOOGLE_WEB, nonce });

    const response = await auth.loginOAuth2Onetap(
      postJson('/login/oauth2/onetap/google', { credential }),
      handler
    );

    expect(response.status).toBe(200);
    expect(handler.mock.calls[0]?.[1]).toMatchObject({
      provider: 'google',
      clientId: GOOGLE_WEB,
      userInfo: { claims: { sub: 'user-1' } },
    });
  });

  it('one tap: accepts the bare-host issuer Google also uses', async () => {
    const auth = createAuth();
    const nonce = await issueNonce(auth);
    const credential = await sign({ iss: 'accounts.google.com', aud: GOOGLE_WEB, nonce });
    const response = await auth.loginOAuth2Onetap(
      postJson('/login/oauth2/onetap/google', { credential }),
      handler
    );
    expect(response.status).toBe(200);
  });

  it('one tap: consumes the nonce, so the same credential cannot sign in twice', async () => {
    const auth = createAuth();
    const nonce = await issueNonce(auth);
    const credential = await sign({ iss: GOOGLE_ISS, aud: GOOGLE_WEB, nonce });
    const login = () =>
      auth.loginOAuth2Onetap(postJson('/login/oauth2/onetap/google', { credential }), handler);

    expect((await login()).status).toBe(200);
    const replay = await login();

    await refused(Promise.resolve(replay), 'NONCE_MISMATCH');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('one tap: refuses a credential without a nonce', async () => {
    const credential = await sign({ iss: GOOGLE_ISS, aud: GOOGLE_WEB });
    const response = await createAuth().loginOAuth2Onetap(
      postJson('/login/oauth2/onetap/google', { credential }),
      handler
    );

    await refused(Promise.resolve(response), 'NONCE_MISSING');
    expect(handler).not.toHaveBeenCalled();
  });

  it('one tap: refuses a nonce that was never issued, or was issued for another provider', async () => {
    const auth = createAuth();
    const appleNonce = await issueNonce(auth, 'apple');
    for (const nonce of ['made-up', appleNonce]) {
      const credential = await sign({ iss: GOOGLE_ISS, aud: GOOGLE_WEB, nonce });
      const response = await auth.loginOAuth2Onetap(
        postJson('/login/oauth2/onetap/google', { credential }),
        handler
      );
      await refused(Promise.resolve(response), 'NONCE_MISMATCH');
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('one tap: accepts a credential without a nonce when google is listed as optional', async () => {
    const credential = await sign({ iss: GOOGLE_ISS, aud: GOOGLE_WEB });
    const response = await createAuth({ optional: ['google'] }).loginOAuth2Onetap(
      postJson('/login/oauth2/onetap/google', { credential }),
      handler
    );
    expect(response.status).toBe(200);
  });

  it('one tap: still checks a nonce the credential carries when google is listed as optional', async () => {
    const credential = await sign({ iss: GOOGLE_ISS, aud: GOOGLE_WEB, nonce: 'made-up' });
    await refused(
      createAuth({ optional: ['google'] }).loginOAuth2Onetap(
        postJson('/login/oauth2/onetap/google', { credential }),
        handler
      ),
      'NONCE_MISMATCH'
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("one tap: refuses a credential for another app's client, or for our app clients", async () => {
    const auth = createAuth();
    for (const aud of ['9999-foreign.apps.googleusercontent.com', GOOGLE_IOS]) {
      const credential = await sign({ iss: GOOGLE_ISS, aud });
      await refused(
        auth.loginOAuth2Onetap(postJson('/login/oauth2/onetap/google', { credential }), handler),
        'OAUTH2_INVALID_GRANT'
      );
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('one tap: refuses a credential from another issuer', async () => {
    const credential = await sign({ iss: 'https://evil.example.com', aud: GOOGLE_WEB });
    await refused(
      createAuth().loginOAuth2Onetap(
        postJson('/login/oauth2/onetap/google', { credential }),
        handler
      ),
      'OAUTH2_INVALID_GRANT'
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('one tap: is refused by a provider without One Tap', async () => {
    const credential = await sign({ iss: APPLE_ISS, aud: APPLE_WEB });
    const response = await createAuth().loginOAuth2Onetap(
      postJson('/login/oauth2/onetap/google', { credential }),
      handler,
      'apple'
    );
    expect(response.status).toBe(400);
    expect(await reasonOf(response)).toBe('OAUTH2_INVALID_REQUEST');
  });

  it('native: exchanges as the named installed-app client, without a secret', async () => {
    issuedIdToken = await sign({ iss: GOOGLE_ISS, aud: GOOGLE_IOS });
    const response = await createAuth().loginOAuth2Native(
      postJson('/login/oauth2/native/google', { code: 'c0de', client_id: GOOGLE_IOS }),
      handler
    );

    expect(response.status).toBe(200);
    const body = tokenRequests()[0];
    expect(body.get('client_id')).toBe(GOOGLE_IOS);
    expect(body.has('client_secret')).toBe(false);
    expect(body.has('code_verifier')).toBe(false);
    expect(handler.mock.calls[0]?.[1]).toMatchObject({ provider: 'google', clientId: GOOGLE_IOS });
  });

  it('native: sends the PKCE code_verifier the app posted with the code', async () => {
    issuedIdToken = await sign({ iss: GOOGLE_ISS, aud: GOOGLE_ANDROID });
    const response = await createAuth().loginOAuth2Native(
      postJson('/login/oauth2/native/google', {
        code: 'c0de',
        client_id: GOOGLE_ANDROID,
        code_verifier: CODE_VERIFIER,
      }),
      handler
    );

    expect(response.status).toBe(200);
    const body = tokenRequests()[0];
    expect(body.get('code_verifier')).toBe(CODE_VERIFIER);
    expect(body.get('code')).toBe('c0de');
  });

  it.each([
    ['too short', 'a'.repeat(42)],
    ['too long', 'a'.repeat(129)],
    ['outside the unreserved set', `${'a'.repeat(42)}+`],
    ['not a string', 12345],
  ])('native: refuses a code_verifier %s, before calling Google', async (_, code_verifier) => {
    const response = await createAuth().loginOAuth2Native(
      postJson('/login/oauth2/native/google', {
        code: 'c0de',
        client_id: GOOGLE_IOS,
        code_verifier,
      }),
      handler
    );
    expect(response.status).toBe(400);
    expect(await reasonOf(response)).toBe('INVALID_CODE_VERIFIER');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('native: accepts the web client by name, with its secret (Android server auth code)', async () => {
    issuedIdToken = await sign({ iss: GOOGLE_ISS, aud: GOOGLE_WEB });
    await createAuth().loginOAuth2Native(
      postJson('/login/oauth2/native/google', { code: 'c0de', client_id: GOOGLE_WEB }),
      handler
    );
    expect(tokenRequests()[0]?.get('client_secret')).toBe('google-secret');
    expect(handler.mock.calls[0]?.[1]).toMatchObject({ clientId: GOOGLE_WEB });
  });

  it('native: refuses an id token whose audience is not the client exchanged as', async () => {
    issuedIdToken = await sign({ iss: GOOGLE_ISS, aud: GOOGLE_ANDROID });
    await refused(
      createAuth().loginOAuth2Native(
        postJson('/login/oauth2/native/google', { code: 'c0de', client_id: GOOGLE_IOS }),
        handler
      ),
      'OAUTH2_INVALID_GRANT'
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('native: refuses a client of another project or app', async () => {
    await refused(
      createAuth().loginOAuth2Native(
        postJson('/login/oauth2/native/google', {
          code: 'c0de',
          client_id: '1234-evil.apps.googleusercontent.com',
        }),
        handler
      ),
      'OAUTH2_INVALID_CLIENT'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('native: asks for client_id when several native clients could be meant', async () => {
    const response = await createAuth().loginOAuth2Native(
      postJson('/login/oauth2/native/google', { code: 'c0de' }),
      handler
    );
    expect(response.status).toBe(400);
    expect(await reasonOf(response)).toBe('OAUTH2_INVALID_REQUEST');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Facebook', () => {
  it('limited login: accepts an id token for the app, refuses one for another app', async () => {
    const auth = createAuth();
    const ok = await sign({
      iss: FACEBOOK_ISS,
      aud: FACEBOOK_APP,
      nonce: await issueNonce(auth, 'facebook'),
    });
    const response = await auth.loginOAuth2Native(
      postJson('/login/oauth2/native/facebook', { id_token: ok }),
      handler
    );
    expect(response.status).toBe(200);
    expect(handler.mock.calls[0]?.[1]).toMatchObject({
      provider: 'facebook',
      clientId: FACEBOOK_APP,
    });

    const foreign = await sign({
      iss: FACEBOOK_ISS,
      aud: '777',
      nonce: await issueNonce(auth, 'facebook'),
    });
    await refused(
      auth.loginOAuth2Native(
        postJson('/login/oauth2/native/facebook', { id_token: foreign }),
        handler
      ),
      'OAUTH2_INVALID_GRANT'
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('limited login: refuses an id token without the nonce the app must set', async () => {
    const token = await sign({ iss: FACEBOOK_ISS, aud: FACEBOOK_APP });
    await refused(
      createAuth().loginOAuth2Native(
        postJson('/login/oauth2/native/facebook', { id_token: token }),
        handler
      ),
      'NONCE_MISSING'
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('access token: binds it to the app with appsecret_proof', async () => {
    await createAuth().loginOAuth2Native(
      postJson('/login/oauth2/native/facebook', { access_token: 'user-at' }),
      handler
    );
    const [input] =
      fetchMock.mock.calls.find(([i]) => urlOf(i).host === 'graph.facebook.com') ?? [];
    const proof = createHmac('sha256', 'fb-secret').update('user-at').digest('hex');
    expect(input && urlOf(input).searchParams.get('appsecret_proof')).toBe(proof);
  });

  it('access token: refused when the client has no secret to prove it with', async () => {
    await refused(
      createAuth().loginOAuth2Native(
        postJson('/login/oauth2/native/facebookPublic', { access_token: 'user-at' }),
        handler
      ),
      'OAUTH2_INVALID_CLIENT'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('provider keys', () => {
  it.each(['nope', 'constructor', 'facebookPublic'])(
    'answers 400 when the redirect flow is started for %s',
    async (provider) => {
      const response = await createAuth().oauth2Authorization(
        new Request(`https://api.test/oauth2/authorization/${provider}`)
      );
      expect(response.status).toBe(400);
      expect(await reasonOf(response)).toBe('OAUTH2_INVALID_REQUEST');
    }
  );
});
