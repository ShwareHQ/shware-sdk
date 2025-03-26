import Redis from 'ioredis';
import { PRINCIPAL_NAME_INDEX_NAME, RedisIndexedSessionRepository } from '../redis-session';

// docker run -d -p 6379:6379 --name my-redis -e REDIS_PASSWORD=123456 redis
const redis = new Redis('redis://default:123456@localhost:6379');
const repository = new RedisIndexedSessionRepository(redis, 'myapp:session');
const principalName = 'user_123456';

describe('session crud', async () => {
  const session = repository.createSession();
  const sessionId = session.getId();
  session.setAttribute(PRINCIPAL_NAME_INDEX_NAME, principalName);
  await repository.save(session);

  test('should create a session', async () => {
    const foundSession = await repository.findById(sessionId);
    expect(foundSession?.getAttribute(PRINCIPAL_NAME_INDEX_NAME)).toBe(principalName);
  });

  test('should find a session by principal name', async () => {
    const sessions = await repository.findByPrincipalName(principalName);
    expect(sessions.size).toBeGreaterThan(0);
    expect(sessions.keys()).toContain(sessionId);
  });

  test('should delete a session by id', async () => {
    const sessions = await repository.findByPrincipalName(principalName);
    for (const session of sessions.values()) {
      await repository.deleteById(session.getId());
    }
  });
});
