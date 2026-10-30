import { describe, expect, it } from 'vitest';
import { PRINCIPAL_NAME_INDEX_NAME } from '../../session/common';
import { MapSession } from '../../session/map-session';
import type { KVRepository, SessionRepository } from '../../session/types';
import type { CookieOptions } from '../../utils/http';
import { Auth } from '../index';
import type { LogoutScope } from '../types';

const sessions: SessionRepository<MapSession> = {
  createSession: () => new MapSession(),
  save: async () => {},
  findById: async () => null,
  deleteById: async () => {},
  findByIndexNameAndIndexValue: async () => new Map(),
  findByPrincipalName: async () => new Map(),
  cleanupExpiredSessions: async () => {},
};

const kv: KVRepository = {
  setItem: async () => {},
  getItem: async () => null,
  removeItem: async () => {},
  increment: async () => 1,
};

async function logout(cookie?: CookieOptions & { name?: string }) {
  const auth = new Auth({ sessionRepository: sessions, kvRepository: kv, cookie });
  const response = await auth.logout(
    new Request('https://api.example.com/logout', {
      method: 'POST',
      headers: { Cookie: 'SESSION=abc' },
    })
  );
  return response.headers.get('set-cookie') ?? '';
}

describe('logout', () => {
  it('clears the session cookie with the domain and path it was set with', async () => {
    const setCookie = await logout({ domain: '.example.com', path: '/' });
    expect(setCookie).toMatch(/^SESSION=;/);
    expect(setCookie).toContain('Domain=.example.com; Path=/');
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=None');
  });

  it('omits Domain when none is configured', async () => {
    const setCookie = await logout();
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).not.toContain('Domain=');
  });
});

/** An in-memory store with three sessions: two of user-1 (`abc` is the request's), one of user-2. */
function store() {
  const rows = new Map<string, MapSession>();
  const add = (id: string, principal: string) => {
    const session = new MapSession(id);
    session.setAttribute(PRINCIPAL_NAME_INDEX_NAME, principal);
    rows.set(id, session);
  };
  add('abc', 'user-1');
  add('def', 'user-1');
  add('xyz', 'user-2');
  const repository: SessionRepository<MapSession> = {
    ...sessions,
    findById: async (id) => rows.get(id) ?? null,
    deleteById: async (id) => {
      rows.delete(id);
    },
    findByPrincipalName: async (name) =>
      new Map([...rows].filter(([, s]) => s.getAttribute(PRINCIPAL_NAME_INDEX_NAME) === name)),
  };
  return { rows, repository };
}

describe('logout scope', () => {
  async function run(scope: LogoutScope, cookie = 'SESSION=abc') {
    const { rows, repository } = store();
    const auth = new Auth({ sessionRepository: repository, kvRepository: kv });
    const response = await auth.logout(
      new Request('https://api.example.com/logout', {
        method: 'POST',
        headers: { Cookie: cookie },
      }),
      { scope }
    );
    return { left: [...rows.keys()].sort(), setCookie: response.headers.get('set-cookie') };
  }

  it("local: ends the request's session only", async () => {
    const { left, setCookie } = await run('local');
    expect(left).toEqual(['def', 'xyz']);
    expect(setCookie).toMatch(/^SESSION=;/);
  });

  it("global: ends every session of the principal, nobody else's, and clears the cookie", async () => {
    const { left, setCookie } = await run('global');
    expect(left).toEqual(['xyz']);
    expect(setCookie).toMatch(/^SESSION=;/);
  });

  it("others: ends the principal's other sessions and keeps this one signed in", async () => {
    const { left, setCookie } = await run('others');
    expect(left).toEqual(['abc', 'xyz']);
    expect(setCookie).toBeNull();
  });

  it('global without a known session has no principal to widen to, and still clears the cookie', async () => {
    const { left, setCookie } = await run('global', 'SESSION=unknown');
    expect(left).toEqual(['abc', 'def', 'xyz']);
    expect(setCookie).toMatch(/^SESSION=;/);
  });
});
