import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRINCIPAL_NAME_INDEX_NAME } from '../../session/common';
import { MapSession } from '../../session/map-session';
import type { KVRepository, SessionRepository } from '../../session/types';
import { Auth } from '../index';

const kv: KVRepository = {
  setItem: async () => {},
  getItem: async () => null,
  removeItem: async () => {},
  increment: async () => 1,
};

function sessions(session: MapSession): SessionRepository<MapSession> {
  return {
    createSession: () => new MapSession(),
    save: async () => {},
    findById: async (id) => (id === session.getId() ? session : null),
    deleteById: async () => {},
    findByIndexNameAndIndexValue: async () => new Map(),
    findByPrincipalName: async () => new Map(),
    cleanupExpiredSessions: async () => {},
  };
}

function signedIn() {
  const session = new MapSession();
  session.setAttribute(PRINCIPAL_NAME_INDEX_NAME, 'alice');
  session.setMaxInactiveInterval(30 * 24 * 60 * 60);
  return session;
}

const request = (session: MapSession) =>
  new Request('https://api.example.com/v1/me', {
    headers: { Cookie: `SESSION=${session.getId()}` },
  });

const HOUR = 60 * 60 * 1000;

describe('renew: the session cookie slides with the session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renews the cookie on the request that touched the session, as login writes it', async () => {
    const session = signedIn();
    const auth = new Auth({
      sessionRepository: sessions(session),
      kvRepository: kv,
      cookie: { domain: '.example.com', sameSite: 'lax' },
    });
    vi.setSystemTime(Date.now() + HOUR);

    const req = request(session);
    expect(await auth.getPrincipal(req)).toEqual({ name: 'alice' });
    const response = auth.renew(req, Response.json({}));
    expect(response.headers.getSetCookie()).toEqual([
      `SESSION=${session.getId()}; Max-Age=2592000; Domain=.example.com; Path=/; HttpOnly; Secure; SameSite=Lax`,
    ]);

    // Once per request: a second call adds nothing.
    expect(auth.renew(req, Response.json({})).headers.getSetCookie()).toEqual([]);
  });

  it('adds no cookie within the touch interval', async () => {
    const session = signedIn();
    const auth = new Auth({ sessionRepository: sessions(session), kvRepository: kv });
    vi.setSystemTime(Date.now() + HOUR / 2);

    const req = request(session);
    expect(await auth.isAuthenticated(req)).toBe(true);
    const original = Response.json({});
    const response = auth.renew(req, original);
    expect(response).toBe(original);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('is a no-op for anonymous requests and requests never authenticated', async () => {
    const anonymous = new MapSession();
    const auth = new Auth({
      sessionRepository: sessions(anonymous),
      kvRepository: kv,
      session: { touchInterval: 0 },
    });

    const req = request(anonymous);
    expect(await auth.getPrincipal(req)).toBeNull();
    expect(auth.renew(req, Response.json({})).headers.getSetCookie()).toEqual([]);

    const unknown = new Request('https://api.example.com/v1/me');
    expect(await auth.isAuthenticated(unknown)).toBe(false);
    expect(auth.renew(unknown, Response.json({})).headers.getSetCookie()).toEqual([]);

    // A signed-in session, but getPrincipal was never called for this request.
    const session = signedIn();
    const other = new Auth({
      sessionRepository: sessions(session),
      kvRepository: kv,
      session: { touchInterval: 0 },
    });
    expect(other.renew(request(session), Response.json({})).headers.getSetCookie()).toEqual([]);
  });

  it('keeps SameSite=None; Secure on a desktop session whatever the configured cookie', async () => {
    const session = signedIn();
    session.setAttribute('client_type', 'desktop');
    const auth = new Auth({
      sessionRepository: sessions(session),
      kvRepository: kv,
      cookie: { sameSite: 'lax', secure: false },
      session: { touchInterval: 0 },
    });

    const req = request(session);
    await auth.getPrincipal(req);
    const [cookie] = auth.renew(req, Response.json({})).headers.getSetCookie();
    expect(cookie).toContain('SameSite=None');
    expect(cookie).toContain('Secure');
  });

  it('leaves a cookie the route wrote itself alone', async () => {
    const session = signedIn();
    const auth = new Auth({
      sessionRepository: sessions(session),
      kvRepository: kv,
      session: { touchInterval: 0 },
    });

    const req = request(session);
    await auth.getPrincipal(req);
    const loggedOut = await auth.logout(req);
    expect(auth.renew(req, loggedOut).headers.getSetCookie()).toEqual([
      expect.stringContaining('SESSION=; Max-Age=0'),
    ]);
  });

  it('copies a response whose headers are immutable', async () => {
    const session = signedIn();
    const auth = new Auth({
      sessionRepository: sessions(session),
      kvRepository: kv,
      session: { touchInterval: 0 },
    });

    const req = request(session);
    await auth.getPrincipal(req);
    const response = auth.renew(req, Response.redirect('https://example.com/next', 302));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://example.com/next');
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringContaining(`SESSION=${session.getId()}`),
    ]);
  });
});
