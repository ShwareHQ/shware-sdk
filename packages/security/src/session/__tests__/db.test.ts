import { describe, expect, test } from 'vitest';
import { PRINCIPAL_NAME_INDEX_NAME } from '../common';
import { type DBAdapter, DBIndexedSessionRepository } from '../db';

type Entity = Parameters<DBAdapter['save']>[0];

/** An adapter that records what `save` receives and keeps rows in memory. */
function memoryAdapter() {
  const rows = new Map<string, Entity>();
  const saves: Entity[] = [];
  const adapter: DBAdapter = {
    async save(entity) {
      saves.push(entity);
      rows.set(entity.sessionId, entity);
    },
    async deleteById(sessionId) {
      rows.delete(sessionId);
    },
    async findById(sessionId) {
      const row = rows.get(sessionId);
      // What a database adapter returns: the stored columns, no `isNew`.
      return row ? { ...row, isNew: undefined } : null;
    },
    async findByPrincipalName(principalName) {
      return [...rows.values()].filter((row) => row.principalName === principalName);
    },
    async cleanupExpiredSessions() {},
  };
  return { adapter, saves };
}

describe('DBIndexedSessionRepository', () => {
  test('tells the adapter whether a saved session is new', async () => {
    const { adapter, saves } = memoryAdapter();
    const repository = new DBIndexedSessionRepository(adapter);

    const created = repository.createSession();
    created.setAttribute(PRINCIPAL_NAME_INDEX_NAME, 'user_1');
    await repository.save(created);
    expect(saves[0]?.isNew).toBe(true);

    // Saved once, the same object is no longer new.
    await repository.save(created);
    expect(saves[1]?.isNew).toBe(false);

    // A session loaded through the adapter was stored before: never new.
    const loaded = await repository.findById(created.getId());
    if (!loaded) throw new Error('session not found');
    await repository.save(loaded);
    expect(saves[2]?.isNew).toBe(false);

    const byPrincipal = await repository.findByPrincipalName('user_1');
    for (const session of byPrincipal.values()) await repository.save(session);
    expect(saves.at(-1)?.isNew).toBe(false);
  });
});
