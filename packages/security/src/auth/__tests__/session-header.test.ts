import { describe, expect, it } from 'vitest';
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
  return session;
}

const request = (headers: Record<string, string>) =>
  new Request('https://api.example.com/v1/me', { headers });

describe('where the session id is read from', () => {
  it('reads the X-Auth-Token header when there is no cookie', async () => {
    const session = signedIn();
    const auth = new Auth({ kvRepository: kv, sessionRepository: sessions(session) });

    expect(await auth.getPrincipal(request({ 'X-Auth-Token': session.getId() }))).toEqual({
      name: 'alice',
    });
  });

  it('prefers the cookie over the header', async () => {
    const session = signedIn();
    const auth = new Auth({ kvRepository: kv, sessionRepository: sessions(session) });

    const principal = await auth.getPrincipal(
      request({ Cookie: `SESSION=${session.getId()}`, 'X-Auth-Token': 'not-a-session' })
    );
    expect(principal).toEqual({ name: 'alice' });
  });

  it('never reads Authorization: Bearer', async () => {
    const session = signedIn();
    const auth = new Auth({ kvRepository: kv, sessionRepository: sessions(session) });

    expect(await auth.getPrincipal(request({ Authorization: `Bearer ${session.getId()}` }))).toBe(
      null
    );
  });

  it('reads a configured header, or none with header: false', async () => {
    const session = signedIn();
    const custom = new Auth({
      kvRepository: kv,
      sessionRepository: sessions(session),
      session: { header: 'X-Session' },
    });
    expect(await custom.getPrincipal(request({ 'X-Session': session.getId() }))).toEqual({
      name: 'alice',
    });
    expect(await custom.getPrincipal(request({ 'X-Auth-Token': session.getId() }))).toBe(null);

    const cookieOnly = new Auth({
      kvRepository: kv,
      sessionRepository: sessions(session),
      session: { header: false },
    });
    expect(await cookieOnly.getPrincipal(request({ 'X-Auth-Token': session.getId() }))).toBe(null);
  });
});
