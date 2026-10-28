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

describe('session id in the X-Auth-Token header', () => {
  it('is neither read nor written by default', async () => {
    const session = signedIn();
    const auth = new Auth({ kvRepository: kv, sessionRepository: sessions(session) });

    expect(await auth.getPrincipal(request({ 'X-Auth-Token': session.getId() }))).toBe(null);
    const logged = await auth.logged(request({ Cookie: `SESSION=${session.getId()}` }));
    expect(logged.headers.get('X-Auth-Token')).toBe(null);
  });

  it('with session.header on, is read without a cookie and written with the cookie', async () => {
    const session = signedIn();
    const auth = new Auth({
      kvRepository: kv,
      sessionRepository: sessions(session),
      session: { header: true },
    });

    expect(await auth.getPrincipal(request({ 'X-Auth-Token': session.getId() }))).toEqual({
      name: 'alice',
    });
    const logged = await auth.logged(request({ 'X-Auth-Token': session.getId() }));
    expect(logged.headers.get('X-Auth-Token')).toBe(session.getId());
    expect(logged.headers.get('set-cookie')).toContain(`SESSION=${session.getId()}`);
  });

  it('prefers the cookie over the header, and never reads Authorization', async () => {
    const session = signedIn();
    const auth = new Auth({
      kvRepository: kv,
      sessionRepository: sessions(session),
      session: { header: true },
    });

    expect(
      await auth.getPrincipal(
        request({ Cookie: `SESSION=${session.getId()}`, 'X-Auth-Token': 'not-a-session' })
      )
    ).toEqual({ name: 'alice' });
    expect(await auth.getPrincipal(request({ Authorization: `Bearer ${session.getId()}` }))).toBe(
      null
    );
  });
});
