import Redis from 'ioredis';
import { PRINCIPAL_NAME_INDEX_NAME } from '../common';
import { RedisIndexedSessionRepository } from '../redis';

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

describe('redis session attributes', () => {
  test('should set and get attributes', async () => {
    const session = repository.createSession();
    session.setAttribute('test_key', 'test_value');
    const sessionId = session.getId();
    await repository.save(session);

    const foundSession = await repository.findById(sessionId);
    expect(foundSession).not.toBeNull();
    expect(foundSession?.getAttribute('test_key')).toBe('test_value');

    foundSession?.removeAttribute('test_key');
    await repository.save(foundSession!);

    const foundSession2 = await repository.findById(sessionId);
    expect(foundSession2?.getAttribute('test_key')).toBeNull();
  });

  test('should change session id', async () => {
    const session = repository.createSession();
    session.setAttribute('test_key', 'test_value');
    session.setAttribute(PRINCIPAL_NAME_INDEX_NAME, 'user_123');
    const oldSessionId = session.getId();
    await repository.save(session);

    const oldSession = await repository.findById(oldSessionId);
    expect(oldSession).not.toBeNull();
    if (!oldSession) throw new Error('Not found session id');

    const newSessionId = oldSession.changeSessionId();
    await repository.save(oldSession);

    const foundSession1 = await repository.findById(oldSessionId);
    expect(foundSession1).toBeNull();

    const foundSession2 = await repository.findById(newSessionId);
    expect(foundSession2).not.toBeNull();
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
