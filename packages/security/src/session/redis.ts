import { PRINCIPAL_NAME_INDEX_NAME, SPRING_SECURITY_CONTEXT, resolveIndexesFor } from './common';
import { MapSession } from './map-session';
import type { KVRepository, Namespace, Session, SessionRepository } from './types';
import type { Redis } from 'ioredis';

const CREATION_TIME_KEY = 'creationTime';
const LAST_ACCESSED_TIME_KEY = 'lastAccessedTime';
const MAX_INACTIVE_INTERVAL_KEY = 'maxInactiveInterval';
const ATTRIBUTE_PREFIX = 'sessionAttr:';
const SESSION_EXPIRES_PREFIX = 'expires:';

class RedisSession implements Session {
  private readonly cached: MapSession;

  public isNew: boolean;
  public delta = new Map<string, string | number | null>();
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
      this.cached.getAttributeNames().forEach((name) => {
        const value = this.cached.getAttribute(name);
        if (value) this.delta.set(this.getSessionAttrNameKey(name), value);
      });
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
    return this.cached.changeSessionId();
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

  setAttribute(name: string, value: string) {
    this.cached.setAttribute(name, value);
    this.delta.set(this.getSessionAttrNameKey(name), value);
  }

  removeAttribute(name: string) {
    this.cached.removeAttribute(name);
    this.delta.set(this.getSessionAttrNameKey(name), null);
  }
}

interface RedisSessionExpirationStore {
  save(session: RedisSession): Promise<void>;
  remove(sessionId: string): Promise<void>;
  rename(session: RedisSession): Promise<void>;
  cleanupExpiredSessions(cleanupCount?: number): Promise<void>;
}

class SortedSetRedisSessionExpirationStore implements RedisSessionExpirationStore {
  private readonly redis: Redis;
  private readonly namespace: Namespace;
  private readonly expirationsKey: string;

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

  async rename(session: RedisSession) {
    if (session.originalSessionId === null || session.originalSessionId === session.getId()) return;
    await this.remove(session.originalSessionId);
    await this.save(session);
  }

  async cleanupExpiredSessions(cleanupCount: number = 100) {
    const key = this.expirationsKey;
    const score = Date.now();
    const sessionIds = await this.redis.zrevrangebyscore(key, score, 0, 'LIMIT', 0, cleanupCount);
    if (sessionIds.length === 0) return;
    for (const sessionId of sessionIds) {
      const sessionKey = this.getSessionKey(sessionId);
      // Checks if the session exists. By trying to access the session we only trigger a deletion
      // if the TTL is expired.
      await this.redis.exists(sessionKey);
    }
  }
}

// <spring:session:sessions:uuid, hash<session>> + 300s
// <spring:session:sessions:expirations, sorted_set<uuid>>
// <spring:session:sessions:expires:uuid, string<empty>>: for expire check & event
export class RedisIndexedSessionRepository implements SessionRepository<RedisSession> {
  private readonly redis: Redis;
  private readonly namespace: Namespace;
  private readonly expirationStore: RedisSessionExpirationStore;

  private defaultMaxInactiveInterval = 1800;

  constructor(redis: Redis, namespace: Namespace = 'spring:session') {
    this.redis = redis;
    this.namespace = namespace;
    this.expirationStore = new SortedSetRedisSessionExpirationStore(redis, namespace);
  }

  setDefaultMaxInactiveInterval(interval: number) {
    this.defaultMaxInactiveInterval = interval;
  }

  private getSessionKey(sessionId: string) {
    return `${this.namespace}:sessions:${sessionId}`;
  }

  private getExpiredKey(sessionId: string) {
    return `${this.namespace}:sessions:expires:${sessionId}`;
  }

  private getSessionAttrNameKey(name: string) {
    return ATTRIBUTE_PREFIX + name;
  }

  private getPrincipalKey(principalName: string) {
    return `${this.namespace}:index:${PRINCIPAL_NAME_INDEX_NAME}:${principalName}`;
  }

  private async getSession(id: string, allowExpired: boolean): Promise<RedisSession | null> {
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

  private async saveDelta(session: RedisSession) {
    if (session.delta.size === 0) return;
    const sessionId = session.getId();
    const delta = new Map<string, string | number>();
    const removes: string[] = [];
    session.delta.forEach((value, key) => {
      if (value !== null) delta.set(key, value);
      else removes.push(key);
    });

    if (delta.size !== 0) {
      await this.redis.hset(this.getSessionKey(sessionId), delta);
    }
    if (removes.length !== 0) {
      await this.redis.hdel(this.getSessionKey(sessionId), ...removes);
    }

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

    if (session.isNew) {
      // here your can send session created message to channel
      session.isNew = false;
    }

    const sessionExpireInSeconds = session.getMaxInactiveInterval();

    // createShadowKey start
    const keyToExpire = SESSION_EXPIRES_PREFIX + session.getId();
    const sessionKey = this.getSessionKey(keyToExpire);

    if (sessionExpireInSeconds < 0) {
      await this.redis.append(sessionKey, '');
      await this.redis.persist(sessionKey);
      await this.redis.persist(this.getSessionKey(session.getId()));
    } else if (sessionExpireInSeconds === 0) {
      await this.redis.del(sessionKey);
    } else {
      await this.redis.append(sessionKey, '');
      await this.redis.expire(sessionKey, sessionExpireInSeconds);
    }
    // createShadowKey end

    if (sessionExpireInSeconds > 0) {
      const fiveMinutesAfterExpires = sessionExpireInSeconds + 5 * 60;
      await this.redis.expire(this.getSessionKey(session.getId()), fiveMinutesAfterExpires);
    }

    await this.expirationStore.save(session);
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
      await this.expirationStore.rename(session);
    }
    session.originalSessionId = sessionId;
  }

  // override
  createSession() {
    const cached = new MapSession();
    cached.setMaxInactiveInterval(this.defaultMaxInactiveInterval);
    return new RedisSession(cached, true);
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
    const principal = resolveIndexesFor(session);
    if (principal !== null) {
      await this.redis.srem(this.getPrincipalKey(principal), sessionId);
    }
    // 2. delete in set
    await this.expirationStore.remove(sessionId);
    // 3. delete expired key
    const expiredKey = this.getExpiredKey(sessionId);
    await this.redis.del(expiredKey);

    session.setMaxInactiveInterval(0);
    await this.save(session);
  }

  async findByIndexNameAndIndexValue(indexName: string, indexValue: string) {
    if (indexName !== PRINCIPAL_NAME_INDEX_NAME) {
      return new Map<string, RedisSession>();
    }

    const principalKey = this.getPrincipalKey(indexValue);
    const sessionIds = await this.redis.smembers(principalKey);
    if (!sessionIds || sessionIds.length === 0) {
      return new Map<string, RedisSession>();
    }
    const sessions = new Map<string, RedisSession>();
    for (const sessionId of sessionIds) {
      const session = await this.findById(sessionId);
      if (session !== null) {
        sessions.set(sessionId, session);
      }
    }
    return sessions;
  }

  async findByPrincipalName(principalName: string) {
    return this.findByIndexNameAndIndexValue(PRINCIPAL_NAME_INDEX_NAME, principalName);
  }

  async cleanupExpiredSessions(cleanupCount?: number) {
    await this.expirationStore.cleanupExpiredSessions(cleanupCount);
  }
}

export class RedisKVRepository implements KVRepository {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async setItem(key: string, value: string, expiresIn?: number) {
    if (expiresIn) {
      await this.redis.set(key, value, 'EX', expiresIn);
    } else {
      await this.redis.set(key, value);
    }
  }

  async getItem(key: string): Promise<string | null> {
    return await this.redis.get(key);
  }

  async removeItem(key: string) {
    await this.redis.del(key);
  }
}
