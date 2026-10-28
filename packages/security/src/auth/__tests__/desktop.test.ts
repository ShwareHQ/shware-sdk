import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PRINCIPAL_NAME_INDEX_NAME } from '../../session/common';
import { MapSession } from '../../session/map-session';
import type { KVRepository, SessionRepository } from '../../session/types';
import { Auth } from '../index';

function memorySessions() {
  const store = new Map<string, MapSession>();
  const repository: SessionRepository<MapSession> = {
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
  return { repository, store };
}

function memoryKV() {
  const store = new Map<string, string>();
  const kv: KVRepository = {
    setItem: async (key, value) => {
      store.set(key, value);
    },
    getItem: async (key) => store.get(key) ?? null,
    removeItem: async (key) => {
      store.delete(key);
    },
    increment: async () => 1,
  };
  return { kv, store };
}

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

let sessions: ReturnType<typeof memorySessions>;
let kv: ReturnType<typeof memoryKV>;
let auth: Auth;

function post(path: string, body: unknown, cookie?: string) {
  return new Request(`https://api.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function reasonOf(response: Response) {
  const body = (await response.json()) as { error: { details: { reason: string }[] } };
  return body.error.details[0]?.reason;
}

/** A web session signed in as `user-1`, as its cookie header. */
async function signedInCookie() {
  const session = new MapSession();
  session.setAttribute(PRINCIPAL_NAME_INDEX_NAME, 'user-1');
  await sessions.repository.save(session);
  return `SESSION=${session.getId()}`;
}

beforeEach(() => {
  sessions = memorySessions();
  kv = memoryKV();
  auth = new Auth({ sessionRepository: sessions.repository, kvRepository: kv.kv });
});

afterEach(() => {
  sessions.store.clear();
});

describe('desktop sign-in handshake', () => {
  it('issues a code to a signed-in session and exchanges it for a fresh session', async () => {
    const cookie = await signedInCookie();
    const authorized = await auth.desktopAuthorize(
      post(
        '/auth/desktop/authorize',
        { code_challenge: CHALLENGE, code_challenge_method: 'S256' },
        cookie
      )
    );
    expect(authorized.status).toBe(200);
    const { code } = (await authorized.json()) as { code: string };

    const exchanged = await auth.desktopExchange(
      post('/auth/desktop/exchange', { code, code_verifier: VERIFIER })
    );

    expect(exchanged.status).toBe(200);
    const setCookie = exchanged.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^SESSION=/);
    expect(setCookie).toContain('SameSite=None');
    const id = setCookie.slice('SESSION='.length).split(';')[0] ?? '';
    const session = await sessions.repository.findById(id);
    expect(session?.getAttribute(PRINCIPAL_NAME_INDEX_NAME)).toBe('user-1');
    expect(session?.getAttribute('client_type')).toBe('desktop');
    // Independent of the web session, which stays.
    expect(id).not.toBe(cookie.slice('SESSION='.length));
    expect(sessions.store.size).toBe(2);
  });

  it('refuses to issue a code to an anonymous caller', async () => {
    const response = await auth.desktopAuthorize(
      post('/auth/desktop/authorize', { code_challenge: CHALLENGE, code_challenge_method: 'S256' })
    );
    expect(response.status).toBe(401);
    expect(await reasonOf(response)).toBe('UNAUTHENTICATED');
  });

  it('answers a malformed body with 400, naming the field', async () => {
    const cookie = await signedInCookie();
    const response = await auth.desktopAuthorize(
      post(
        '/auth/desktop/authorize',
        { code_challenge: 'short', code_challenge_method: 'S256' },
        cookie
      )
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { details: { fieldViolations?: { field: string }[] }[] };
    };
    expect(body.error.details[0]?.fieldViolations?.[0]?.field).toBe('code_challenge');
  });

  it('refuses a code with the wrong verifier, without burning it, and spends it on success', async () => {
    const cookie = await signedInCookie();
    const authorized = await auth.desktopAuthorize(
      post(
        '/auth/desktop/authorize',
        { code_challenge: CHALLENGE, code_challenge_method: 'S256' },
        cookie
      )
    );
    const { code } = (await authorized.json()) as { code: string };

    const wrong = await auth.desktopExchange(
      post('/auth/desktop/exchange', { code, code_verifier: 'x'.repeat(43) })
    );
    expect(wrong.status).toBe(403);
    expect(await reasonOf(wrong)).toBe('INVALID_DESKTOP_CODE');
    expect(wrong.headers.get('set-cookie')).toBeNull();

    expect(
      (
        await auth.desktopExchange(
          post('/auth/desktop/exchange', { code, code_verifier: VERIFIER })
        )
      ).status
    ).toBe(200);
    const replay = await auth.desktopExchange(
      post('/auth/desktop/exchange', { code, code_verifier: VERIFIER })
    );
    expect(replay.status).toBe(403);
    expect(await reasonOf(replay)).toBe('INVALID_DESKTOP_CODE');
  });

  it('answers a body that is not JSON with 400 INVALID_JSON', async () => {
    const response = await auth.desktopExchange(
      new Request('https://api.test/auth/desktop/exchange', { method: 'POST', body: 'nope' })
    );
    expect(response.status).toBe(400);
    expect(await reasonOf(response)).toBe('INVALID_JSON');
  });
});
