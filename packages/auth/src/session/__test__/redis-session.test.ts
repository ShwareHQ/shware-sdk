import Redis from 'ioredis';
import { PRINCIPAL_NAME_INDEX_NAME, RedisIndexedSessionRepository } from '../redis-session';

// docker run -d -p 6379:6379 --name my-redis -e REDIS_PASSWORD=123456 redis
const redis = new Redis('redis://default:123456@localhost:6379');
const repository = new RedisIndexedSessionRepository(redis, 'myapp:session');

describe('redis session crud', () => {
  const principalName = 'user_123456';

  test('should create a session', async () => {
    const session = repository.createSession();
    const sessionId = session.getId();
    session.setAttribute(PRINCIPAL_NAME_INDEX_NAME, principalName);
    await repository.save(session);
    const foundSession = await repository.findById(sessionId);
    expect(foundSession?.getAttribute(PRINCIPAL_NAME_INDEX_NAME)).toBe(principalName);
  });

  test('should find a session by principal name', async () => {
    const sessions = await repository.findByPrincipalName(principalName);
    expect(sessions.size).toBeGreaterThan(0);
  });

  test('should delete a session by id', async () => {
    const sessions = await repository.findByPrincipalName(principalName);
    for (const session of sessions.values()) {
      const sessionId = session.getId();
      await repository.deleteById(sessionId);
      const foundSession = await repository.findById(sessionId);
      expect(foundSession).toBeNull();
    }
  });
});

describe('redis session config', () => {
  const maxInactiveInterval = 24 * 60 * 60;
  repository.setDefaultMaxInactiveInterval(maxInactiveInterval);

  test('should set default max inactive interval', () => {
    const session = repository.createSession();
    expect(session.isExpired()).toBe(false);
    expect(session.getMaxInactiveInterval()).toBe(maxInactiveInterval);
  });
});
