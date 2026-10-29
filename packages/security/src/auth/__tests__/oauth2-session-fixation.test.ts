import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuth2Client } from '../../oauth2/client';
import { apple } from '../../oauth2/provider/index';
import type { OAuth2Token, UserInfo } from '../../oauth2/types';
import { PRINCIPAL_NAME_INDEX_NAME } from '../../session/common';
import { type DBAdapter, DBIndexedSessionRepository } from '../../session/db';
import { MapSession } from '../../session/map-session';
import { RedisIndexedSessionRepository } from '../../session/redis';
import type { KVRepository, SessionRepository } from '../../session/types';
import { Auth } from '../index';
import type { AuthorizedHandler } from '../types';

type SessionEntity = Parameters<DBAdapter['save']>[0];

/** A DBAdapter over a Map, indexed by principal name the way a database table would be. */
function memoryAdapter(): DBAdapter {
  const rows = new Map<string, SessionEntity>();
  return {
    save: async (entity) => {
      rows.set(entity.sessionId, structuredClone(entity));
    },
    deleteById: async (id) => {
      rows.delete(id);
    },
    findById: async (id) => structuredClone(rows.get(id) ?? null),
    findByPrincipalName: async (name) =>
      [...rows.values()]
        .filter((row) => row.principalName === name)
        .map((row) => structuredClone(row)),
    cleanupExpiredSessions: async () => {},
  };
}

/** Sessions kept in memory, copied on save and load like a real store would serialize them. */
function memorySessions(): SessionRepository<MapSession> {
  const store = new Map<string, MapSession>();
  const byPrincipal = async (name: string) =>
    new Map(
      [...store.values()]
        .filter((session) => session.getAttribute(PRINCIPAL_NAME_INDEX_NAME) === name)
        .map((session) => [session.getId(), new MapSession(session)])
    );
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
    findByIndexNameAndIndexValue: async (_index, value) => byPrincipal(value),
    findByPrincipalName: byPrincipal,
    cleanupExpiredSessions: async () => {},
  };
}

// The Redis repository runs against a live local Redis, like session/__tests__/redis.test.ts,
// and is skipped when nothing listens on 6379.
const redis = new Redis('redis://default:123456@localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 0,
  retryStrategy: () => null,
});
const redisAvailable = await redis.connect().then(
  () => true,
  () => false
);
afterAll(() => {
  redis.disconnect();
});

const repositories: { name: string; available: boolean; create: () => SessionRepository }[] = [
  { name: 'in-memory', available: true, create: memorySessions },
  { name: 'db', available: true, create: () => new DBIndexedSessionRepository(memoryAdapter()) },
  {
    name: 'redis',
    available: redisAvailable,
    create: () => new RedisIndexedSessionRepository(redis, `fixation-${Date.now()}:session`),
  },
];

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
const WEB_CLIENT = 'com.example.web';

function createAuth(sessionRepository: SessionRepository) {
  return new Auth({
    sessionRepository,
    kvRepository: kv,
    oauth2: {
      client: {
        baseUri: 'https://api.test',
        errorUri: 'https://app.test/?status=error',
        successUri: 'https://app.test/',
        providers: { apple: { provider: apple, web: { clientId: WEB_CLIENT } } },
      },
    },
  });
}

function sessionId(response: Response) {
  const cookie = response.headers.get('set-cookie') ?? '';
  return /SESSION=([^;]+)/.exec(cookie)?.[1] ?? '';
}

/** Starts a redirect flow, optionally on a session the browser already carries. */
async function start(auth: Auth, cookie?: string, attributes?: Record<string, string>) {
  const response = await auth.oauth2Authorization(
    new Request('https://api.test/oauth2/authorization/apple', {
      headers: cookie ? { cookie } : {},
    }),
    attributes ? { attributes } : undefined
  );
  const location = new URL(response.headers.get('location') ?? '');
  return { id: sessionId(response), state: location.searchParams.get('state') ?? '' };
}

function callback(id: string, state: string) {
  return new Request(`https://api.test/login/oauth2/code/apple?code=code-1&state=${state}`, {
    headers: { cookie: `SESSION=${id}` },
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

describe.each(repositories)('session fixation on the redirect flow ($name)', (repo) => {
  it.skipIf(!repo.available)('signs in on a new session id and deletes the old one', async () => {
    const repository = repo.create();
    const auth = createAuth(repository);
    const handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'user-1' }));
    const started = await start(auth, undefined, { referralCode: 'abc123' });

    const response = await auth.loginOAuth2Code(callback(started.id, started.state), handler);

    expect(response.headers.get('location')).toContain('status=success');
    const signedIn = sessionId(response);
    expect(signedIn).not.toBe('');
    expect(signedIn).not.toBe(started.id);
    expect(await repository.findById(started.id)).toBeNull();

    const session = await repository.findById(signedIn);
    expect(session?.getAttribute(PRINCIPAL_NAME_INDEX_NAME)).toBe('user-1');
    // The single-use authorization request (state, PKCE verifier) does not carry over.
    expect(session?.getAttribute('oauth2AuthorizationRequest')).toBeNull();
    // The login attributes still reach onAuthorized.
    expect(handler.mock.calls[0]?.[1].attributes).toEqual({ referralCode: 'abc123' });

    // The principal index points at the new id only, so listSessions and kick see it.
    const sessions = await auth.listSessions({ name: 'user-1' });
    expect(sessions.map((s) => s.getId())).toEqual([signedIn]);
    await auth.kick({ name: 'user-1' });
    expect(await repository.findById(signedIn)).toBeNull();
  });

  it.skipIf(!repo.available)('leaves a planted session id unauthenticated', async () => {
    const repository = repo.create();
    const auth = createAuth(repository);
    const handler = vi.fn<AuthorizedHandler>(async () => ({ name: 'victim' }));

    // The attacker starts the flow and plants the session id in the victim's browser; the host
    // had stored its own attribute in that pre-login session.
    const planted = await start(auth);
    const pre = await repository.findById(planted.id);
    pre?.setAttribute('locale', 'fr');
    if (pre) await repository.save(pre);

    const response = await auth.loginOAuth2Code(callback(planted.id, planted.state), handler);

    const signedIn = sessionId(response);
    expect(signedIn).not.toBe(planted.id);
    const attacker = new Request('https://api.test/', {
      headers: { cookie: `SESSION=${planted.id}` },
    });
    expect(await auth.isAuthenticated(attacker)).toBe(false);
    expect(await auth.getPrincipal(attacker)).toBeNull();
    const victim = new Request('https://api.test/', { headers: { cookie: `SESSION=${signedIn}` } });
    expect(await auth.getPrincipal(victim)).toEqual({ name: 'victim' });
    // The host's own attributes move to the new session.
    expect((await repository.findById(signedIn))?.getAttribute('locale')).toBe('fr');
  });

  it.skipIf(!repo.available)('replaces a session that was already signed in', async () => {
    const repository = repo.create();
    const auth = createAuth(repository);
    const first = await start(auth);
    const firstLogin = await auth.loginOAuth2Code(callback(first.id, first.state), async () => ({
      name: 'user-a',
    }));
    const second = await start(auth, `SESSION=${sessionId(firstLogin)}`);
    expect(second.id).toBe(sessionId(firstLogin));

    const response = await auth.loginOAuth2Code(callback(second.id, second.state), async () => ({
      name: 'user-b',
    }));

    expect(sessionId(response)).not.toBe(second.id);
    expect(await auth.listSessions({ name: 'user-a' })).toEqual([]);
    const sessions = await auth.listSessions({ name: 'user-b' });
    expect(sessions.map((s) => s.getId())).toEqual([sessionId(response)]);
  });
});

describe('PKCE parameters of the redirect flow', () => {
  it('sends a 43-128 char base64url verifier with its S256 challenge', async () => {
    const authorize = vi.spyOn(OAuth2Client.prototype, 'createAuthorizationUri');
    const auth = createAuth(memorySessions());
    await auth.oauth2Authorization(new Request('https://api.test/oauth2/authorization/apple'));

    const pkce = authorize.mock.calls[0]?.[0].pkce;
    expect(pkce?.code_verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(pkce?.code_challenge_method).toBe('S256');
    const challenge = createHash('sha256')
      .update(pkce?.code_verifier ?? '')
      .digest('base64url');
    expect(pkce?.code_challenge).toBe(challenge);
  });
});
