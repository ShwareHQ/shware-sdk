import { describe, expect, it } from 'vitest';
import { MapSession } from '../../session/map-session';
import type { KVRepository, SessionRepository } from '../../session/types';
import type { CookieOptions } from '../../utils/http';
import { Auth } from '../index';

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
