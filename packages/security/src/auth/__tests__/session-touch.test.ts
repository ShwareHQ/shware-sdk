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

/** One stored session, handed back by id, with every save recorded. */
function store(session: MapSession) {
  const saves: number[] = [];
  const sessions: SessionRepository<MapSession> = {
    createSession: () => new MapSession(),
    save: async (s) => {
      saves.push(s.getLastAccessedTime());
    },
    findById: async (id) => (id === session.getId() ? session : null),
    deleteById: async () => {},
    findByIndexNameAndIndexValue: async () => new Map(),
    findByPrincipalName: async () => new Map(),
    cleanupExpiredSessions: async () => {},
  };
  return { sessions, saves };
}

function signedIn() {
  const session = new MapSession();
  session.setAttribute(PRINCIPAL_NAME_INDEX_NAME, 'alice');
  return session;
}

const request = (session: MapSession) =>
  new Request('https://api.example.com/v1/me', {
    headers: { Cookie: `SESSION=${session.getId()}` },
  });

describe('sliding expiration on authenticated access', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renews the session once the touch interval has passed, not before', async () => {
    const session = signedIn();
    const { sessions, saves } = store(session);
    const auth = new Auth({ sessionRepository: sessions, kvRepository: kv });
    const t0 = Date.now();

    // Accessed within the hour: nothing is written, the stored time stands.
    vi.setSystemTime(t0 + 30 * 60 * 1000);
    expect(await auth.getPrincipal(request(session))).toEqual({ name: 'alice' });
    expect(await auth.isAuthenticated(request(session))).toBe(true);
    expect(saves).toEqual([]);
    expect(session.getLastAccessedTime()).toBe(t0);

    // An hour on: one write, carrying the new access time.
    vi.setSystemTime(t0 + 60 * 60 * 1000);
    expect(await auth.getPrincipal(request(session))).toEqual({ name: 'alice' });
    expect(saves).toEqual([t0 + 60 * 60 * 1000]);
    // And the next request in the same hour is quiet again.
    await auth.isAuthenticated(request(session));
    expect(saves).toHaveLength(1);
  });

  it('writes on every request with touchInterval 0', async () => {
    const session = signedIn();
    const { sessions, saves } = store(session);
    const auth = new Auth({
      sessionRepository: sessions,
      kvRepository: kv,
      session: { touchInterval: 0 },
    });

    await auth.getPrincipal(request(session));
    await auth.isAuthenticated(request(session));
    expect(saves).toHaveLength(2);
  });

  it('does not touch an anonymous session', async () => {
    const session = new MapSession();
    const { sessions, saves } = store(session);
    const auth = new Auth({
      sessionRepository: sessions,
      kvRepository: kv,
      session: { touchInterval: 0 },
    });

    expect(await auth.getPrincipal(request(session))).toBeNull();
    expect(await auth.isAuthenticated(request(session))).toBe(false);
    expect(saves).toEqual([]);
  });
});
