import { randomUUID } from 'crypto';
import type { Redis } from 'ioredis';
import type { Session, JSONValue, SecurityContext, SessionRepository, Namespace } from './types';

const DEFAULT_MAX_INACTIVE_INTERVAL = 1800;

const CREATION_TIME_KEY = 'creationTime';
const LAST_ACCESSED_TIME_KEY = 'lastAccessedTime';
const MAX_INACTIVE_INTERVAL_KEY = 'maxInactiveInterval';
const ATTRIBUTE_PREFIX = 'sessionAttr:';
const SESSION_EXPIRES_PREFIX = 'expires:';

const PRINCIPAL_NAME_INDEX_NAME = `org.springframework.session.FindByIndexNameSessionRepository.PRINCIPAL_NAME_INDEX_NAME`;
const SPRING_SECURITY_CONTEXT = 'SPRING_SECURITY_CONTEXT';

function generateId() {
  return randomUUID();
}

class MapSession implements Session {
  private id: string;
  private readonly originalId: string;
  private sessionAttrs = new Map<string, JSONValue>();
  private creationTime = Date.now();
  private lastAccessedTime = this.creationTime;
  private maxInactiveInterval = DEFAULT_MAX_INACTIVE_INTERVAL;

  constructor(id?: string);
  constructor(session: Session);
  constructor(input?: string | Session) {
    if (typeof input === 'undefined') {
      const id = generateId();
      this.id = id;
      this.originalId = id;
    } else if (typeof input === 'string') {
      this.id = input;
      this.originalId = input;
    } else {
      const session = input;
      this.id = session.getId();
      this.originalId = session.getId();

      for (const attrName of session.getAttributeNames()) {
        const attrValue = session.getAttribute(attrName);
        if (attrValue !== null) {
          this.setAttribute(attrName, attrValue);
        }
      }

      this.lastAccessedTime = session.getLastAccessedTime();
      this.creationTime = session.getCreationTime();
      this.maxInactiveInterval = session.getMaxInactiveInterval();
    }
  }

  setId(id: string) {
    this.id = id;
  }

  getOriginalId() {
    return this.originalId;
  }

  setCreationTime(creationTime: number) {
    this.creationTime = creationTime;
  }

  // override
  getId() {
    return this.id;
  }

  changeSessionId() {
    const changedId = generateId();
    this.setId(changedId);
    return changedId;
  }

  getAttribute(name: string) {
    return this.sessionAttrs.get(name) ?? null;
  }

  getAttributeNames(): string[] {
    return Array.from(this.sessionAttrs.keys());
  }

  setAttribute(name: string, value: JSONValue) {
    if (value === null) {
      this.removeAttribute(name);
    } else {
      this.sessionAttrs.set(name, value);
    }
  }

  removeAttribute(name: string) {
    this.sessionAttrs.delete(name);
  }

  getCreationTime() {
    return this.creationTime;
  }

  getLastAccessedTime() {
    return this.lastAccessedTime;
  }

  setLastAccessedTime(lastAccessedTime: number) {
    this.lastAccessedTime = lastAccessedTime;
  }

  getMaxInactiveInterval() {
    return this.maxInactiveInterval;
  }

  setMaxInactiveInterval(interval: number) {
    this.maxInactiveInterval = interval;
  }

  isExpired() {
    if (this.maxInactiveInterval < 0) return false;
    return Date.now() - this.maxInactiveInterval - this.lastAccessedTime >= 0;
  }
}

function resolveIndexesFor(session: Session): string | null {
  const principalName = session.getAttribute(PRINCIPAL_NAME_INDEX_NAME) as string | null;
  if (principalName !== null) return principalName;

  const context = session.getAttribute(SPRING_SECURITY_CONTEXT) as unknown as SecurityContext;
  if (context !== null) {
    return context?.authentication?.name ?? context.authentication?.principal?.name ?? null;
  }
  return null;
}

class RedisSession implements Session {
  private readonly cached: MapSession;

  public isNew: boolean;
  public delta = new Map<string, JSONValue>();
  public originalSessionId: string;
  public originalPrincipalName: string | null;
  public originalLastAccessTime: number | null = null;

  constructor(cached: MapSession, isNew: boolean) {
    this.cached = cached;
    this.isNew = isNew;
    this.originalSessionId = cached.getId();
    this.originalPrincipalName = resolveIndexesFor(this);

    if (isNew) {
      this.delta.set(CREATION_TIME_KEY, cached.getCreationTime());
      this.delta.set(LAST_ACCESSED_TIME_KEY, cached.getLastAccessedTime());
      this.delta.set(MAX_INACTIVE_INTERVAL_KEY, cached.getMaxInactiveInterval());
      this.cached
        .getAttributeNames()
        .forEach((name) =>
          this.delta.set(this.getSessionAttrNameKey(name), this.cached.getAttribute(name))
        );
    }
  }

  getSessionAttrNameKey(name: string) {
    return ATTRIBUTE_PREFIX + name;
  }

  // override
  setLastAccessedTime(lastAccessedTime: number) {
    this.cached.setLastAccessedTime(lastAccessedTime);
    this.delta.set(LAST_ACCESSED_TIME_KEY, lastAccessedTime);
  }

  isExpired() {
    return this.cached.isExpired();
  }

  getCreationTime() {
    return this.cached.getCreationTime();
  }

  getId() {
    return this.cached.getId();
  }

  changeSessionId() {
    const newSessionId = generateId();
    this.cached.setId(newSessionId);
    return newSessionId;
  }

  getLastAccessedTime() {
    return this.cached.getLastAccessedTime();
  }

  setMaxInactiveInterval(interval: number) {
    this.cached.setMaxInactiveInterval(interval);
    this.delta.set(MAX_INACTIVE_INTERVAL_KEY, interval);
  }

  getMaxInactiveInterval() {
    return this.cached.getMaxInactiveInterval();
  }

  getAttribute(name: string) {
    return this.cached.getAttribute(name);
  }

  getAttributeNames() {
    return this.cached.getAttributeNames();
  }

  setAttribute(name: string, value: JSONValue) {
    this.cached.setAttribute(name, value);
    this.delta.set(this.getSessionAttrNameKey(name), value);
  }

  removeAttribute(name: string) {
    this.cached.removeAttribute(name);
    this.delta.delete(this.getSessionAttrNameKey(name));
  }
}

interface RedisSessionExpirationStore {
  save(session: RedisSession): Promise<void>;
  remove(sessionId: string): Promise<void>;
  cleanupExpiredSessions(): Promise<void>;
}

class SortedSetRedisSessionExpirationStore implements RedisSessionExpirationStore {
  private readonly redis: Redis;
  private readonly namespace: Namespace;
  private readonly expirationsKey: string;

  private cleanupCount = 100;

  constructor(redis: Redis, namespace: Namespace) {
    this.redis = redis;
    this.namespace = namespace;
    this.expirationsKey = `${this.namespace}:sessions:expirations`;
  }

  getSessionKey(sessionId: string) {
    return `${this.namespace}:sessions:${sessionId}`;
  }

  async save(session: RedisSession) {
    const expirationInMillis =
      session.getLastAccessedTime() + session.getMaxInactiveInterval() * 1000;
    await this.redis.zadd(this.expirationsKey, expirationInMillis, session.getId());
  }

  async remove(sessionId: string) {
    await this.redis.zrem(this.expirationsKey, sessionId);
  }

  async cleanupExpiredSessions() {
    const sessionIds = await this.redis.zrevrangebyscore(
      this.expirationsKey,
      Date.now(),
      0,
      'LIMIT',
      0,
      this.cleanupCount
    );
    if (sessionIds.length === 0) return;
    for (const sessionId of sessionIds) {
      const sessionKey = this.getSessionKey(sessionId);
      // Checks if the session exists. By trying to access the session we only trigger a deletion
      // if the TTL is expired.
      await this.redis.exists(sessionKey);
    }
  }
}

// reference: https://juejin.cn/post/7262623363700408357
// 15549130 <spring:session:sessions:uuid, hash<session>> + 300s
// 15549147 <spring:session:sessions:expirations, sorted_set<expires:uuid>>  + 300s, cell to 1-minute level
// 15548839 <spring:session:sessions:expires:uuid, string<empty>>
export class RedisIndexedSessionRepository implements SessionRepository<RedisSession> {
  private readonly redis: Redis;
  private readonly expirationStore: RedisSessionExpirationStore;

  private namespace: Namespace;
  private defaultMaxInactiveInterval = 1800;

  constructor(redis: Redis, namespace: Namespace = 'spring:session') {
    this.redis = redis;
    this.namespace = namespace;
    this.expirationStore = new SortedSetRedisSessionExpirationStore(redis, namespace);
  }

  setDefaultMaxInactiveInterval(interval: number) {
    this.defaultMaxInactiveInterval = interval;
  }

  getSessionKey(sessionId: string) {
    return `${this.namespace}:sessions:${sessionId}`;
  }

  getExpiredKey(sessionId: string) {
    return `${this.namespace}:sessions:expires:${sessionId}`;
  }

  getExpirationsKey(expires: number) {
    return `${this.namespace}:expirations:${expires}`;
  }

  getIndexKey(indexName: string, indexValue: string) {
    return `${this.namespace}:index:${indexName}:${indexValue}`;
  }

  getSessionAttrNameKey(name: string) {
    return ATTRIBUTE_PREFIX + name;
  }

  getPrincipalKey(principalName: string) {
    return `${this.namespace}:index:${PRINCIPAL_NAME_INDEX_NAME}:${principalName}`;
  }

  async getSession(id: string, allowExpired: boolean): Promise<RedisSession | null> {
    const key = this.getSessionKey(id);
    const entries = await this.redis.hgetall(key);
    if (!entries || Object.keys(entries).length === 0) return null;
    const loaded = new MapSession(id);
    if (!entries.creationTime) throw new Error('creationTime attribute not found');
    if (!entries.lastAccessedTime) throw new Error('lastAccessedTime attribute not found');
    if (!entries.maxInactiveInterval) throw new Error('maxInactiveInterval attribute not found');

    loaded.setCreationTime(Number(entries.creationTime));
    loaded.setLastAccessedTime(Number(entries.lastAccessedTime));
    loaded.setMaxInactiveInterval(Number(entries.maxInactiveInterval));

    for (const [key, value] of Object.entries(entries)) {
      if (key.startsWith(ATTRIBUTE_PREFIX)) {
        loaded.setAttribute(key.slice(ATTRIBUTE_PREFIX.length), value);
      }
    }

    if (!allowExpired && loaded.isExpired()) return null;
    const result = new RedisSession(loaded, false);
    result.originalLastAccessTime = loaded.getLastAccessedTime();
    return result;
  }

  expiresInMillis(session: Session) {
    return session.getLastAccessedTime() + session.getMaxInactiveInterval() * 1000;
  }

  roundUpToNextMinute(timeInMs: number) {
    return Math.ceil(timeInMs / 60_000) * 60_000;
  }

  private async saveDelta(session: RedisSession) {
    if (session.delta.size === 0) return;
    const sessionId = session.getId();
    await this.redis.hset(this.getSessionKey(sessionId), session.delta);

    const principalSessionKey = this.getSessionAttrNameKey(PRINCIPAL_NAME_INDEX_NAME);
    const securityPrincipalSessionKey = this.getSessionAttrNameKey(SPRING_SECURITY_CONTEXT);
    if (session.delta.has(principalSessionKey) || session.delta.has(securityPrincipalSessionKey)) {
      if (session.originalPrincipalName !== null) {
        const originalPrincipalRedisKey = this.getPrincipalKey(session.originalPrincipalName);
        await this.redis.srem(originalPrincipalRedisKey, sessionId);
      }
      const principal = resolveIndexesFor(session);
      session.originalPrincipalName = principal;
      if (principal !== null) {
        const principalRedisKey = this.getPrincipalKey(principal);
        await this.redis.sadd(principalRedisKey, sessionId);
      }
    }

    session.isNew = false;

    const sessionExpireInSeconds = session.getMaxInactiveInterval();

    // createShadowKey start
    const keyToExpire = SESSION_EXPIRES_PREFIX + session.getId();
    const sessionKey = this.getSessionKey(keyToExpire);

    if (sessionExpireInSeconds < 0) {
      await this.redis.append(sessionKey, '');
      await this.redis.persist(sessionKey);
      await this.redis.persist(this.getSessionKey(session.getId()));
    }

    if (sessionExpireInSeconds === 0) {
      await this.redis.del(sessionKey);
    } else {
      await this.redis.append(sessionKey, '');
      await this.redis.expire(sessionKey, sessionExpireInSeconds);
    }
    // createShadowKey end

    const fiveMinutesAfterExpires = sessionExpireInSeconds + 5 * 60;
    await this.redis.expire(this.getSessionKey(session.getId()), fiveMinutesAfterExpires);

    // expirationStore.save start
    const originalExpiration =
      session.originalLastAccessTime !== null
        ? session.originalLastAccessTime + session.getMaxInactiveInterval()
        : null;
    const toExpire = this.roundUpToNextMinute(this.expiresInMillis(session));
    if (originalExpiration !== null) {
      const originalRoundedUp = this.roundUpToNextMinute(originalExpiration);
      if (toExpire !== originalRoundedUp) {
        const expireKey = this.getExpirationsKey(originalRoundedUp);
        await this.redis.srem(expireKey, keyToExpire);
      }
    }

    const expirationsKey = this.getExpirationsKey(toExpire);
    await this.redis.expire(expirationsKey, fiveMinutesAfterExpires);
    await this.redis.sadd(expirationsKey, keyToExpire);
    // expirationStore.save end

    session.delta.clear();
  }

  private async saveChangeSessionId(session: RedisSession) {
    const sessionId = session.getId();
    if (sessionId === session.originalSessionId) return;
    if (!session.isNew) {
      const originalSessionIdKey = this.getSessionKey(session.originalSessionId);
      const sessionIdKey = this.getSessionKey(sessionId);
      const originalExpiredKey = this.getExpiredKey(session.originalSessionId);
      const expiredKey = this.getExpiredKey(sessionId);

      await this.redis.rename(originalSessionIdKey, sessionIdKey);
      await this.redis.rename(originalExpiredKey, expiredKey);

      if (session.originalPrincipalName !== null) {
        const originalPrincipalRedisKey = this.getPrincipalKey(session.originalPrincipalName);
        await this.redis.srem(originalPrincipalRedisKey, session.originalSessionId);
        await this.redis.sadd(originalPrincipalRedisKey, sessionId);
      }
      // expirationStore.remove
      const toExpire = this.roundUpToNextMinute(this.expiresInMillis(session));
      const expireKey = this.getExpirationsKey(toExpire);
      const entryToRemove = SESSION_EXPIRES_PREFIX + sessionId;
      await this.redis.srem(expireKey, entryToRemove);
    }
    session.originalSessionId = sessionId;
  }

  // override
  createSession() {
    const cached = new MapSession();
    cached.setMaxInactiveInterval(this.defaultMaxInactiveInterval);
    const session = new RedisSession(cached, true);
    return session;
  }

  async save(session: RedisSession) {
    await this.saveChangeSessionId(session);
    await this.saveDelta(session);
  }

  async findById(sessionId: string): Promise<RedisSession | null> {
    return this.getSession(sessionId, false);
  }

  async deleteById(sessionId: string) {
    const session = await this.getSession(sessionId, true);
    if (!session) return;
    // 1. cleanup index

    // 2. delete in set
    const toExpire = this.roundUpToNextMinute(this.expiresInMillis(session));
    const expireKey = this.getExpirationsKey(toExpire);
    const entryToRemove = SESSION_EXPIRES_PREFIX + session.getId();
    await this.redis.srem(expireKey, entryToRemove);

    // 3. delete expired key
    const expiredKey = this.getExpiredKey(sessionId);
    await this.redis.del(expiredKey);
    session.setMaxInactiveInterval(0);
    await this.save(session);
  }

  async findByIndexNameAndIndexValue(indexName: string, indexValue: string) {
    const indexKey = this.getIndexKey(indexName, indexValue);
    const sessionIds = await this.redis.smembers(indexKey);
    if (!sessionIds || sessionIds.length === 0) return new Map<string, RedisSession>();
    const sessions = new Map<string, RedisSession>();
    for (const sessionId of sessionIds) {
      const session = await this.findById(sessionId);
      if (!session) continue;
      sessions.set(sessionId, session);
    }
    return sessions;
  }

  async findByPrincipalName(principalName: string) {
    return this.findByIndexNameAndIndexValue(PRINCIPAL_NAME_INDEX_NAME, principalName);
  }

  async cleanupExpiredSessions() {
    this.expirationStore.cleanupExpiredSessions();
  }
}
