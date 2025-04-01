import { randomUUID } from 'crypto';
import type { Redis } from 'ioredis';
import type { Namespace, SecurityContext, Session, SessionRepository } from './types';

const DEFAULT_MAX_INACTIVE_INTERVAL = 1800;

const CREATION_TIME_KEY = 'creationTime';
const LAST_ACCESSED_TIME_KEY = 'lastAccessedTime';
const MAX_INACTIVE_INTERVAL_KEY = 'maxInactiveInterval';
const ATTRIBUTE_PREFIX = 'sessionAttr:';
const SESSION_EXPIRES_PREFIX = 'expires:';

const SPRING_SECURITY_CONTEXT = 'SPRING_SECURITY_CONTEXT';
export const PRINCIPAL_NAME_INDEX_NAME = `org.springframework.session.FindByIndexNameSessionRepository.PRINCIPAL_NAME_INDEX_NAME`;

function generateId() {
  return randomUUID();
}

class MapSession implements Session {
  private id: string;
  private sessionAttrs = new Map<string, string | number>();
  private creationTime = Date.now();
  private lastAccessedTime = this.creationTime;
  private maxInactiveInterval = DEFAULT_MAX_INACTIVE_INTERVAL;

  constructor(id?: string);
  constructor(session: Session);
  constructor(input?: string | Session) {
    if (typeof input === 'undefined') {
      this.id = generateId();
    } else if (typeof input === 'string') {
      this.id = input;
    } else {
      const session = input;
      this.id = session.getId();

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

  setCreationTime(creationTime: number) {
    this.creationTime = creationTime;
  }

  // override
  getId() {
    return this.id;
  }

  changeSessionId() {
    const changedId = generateId();
    this.id = changedId;
    return changedId;
  }

  getAttribute(name: string) {
    return this.sessionAttrs.get(name) ?? null;
  }

  getAttributeNames(): string[] {
    return Array.from(this.sessionAttrs.keys());
  }

  setAttribute(name: string, value: string | number) {
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
    return Date.now() - this.maxInactiveInterval * 1000 - this.lastAccessedTime >= 0;
  }
}

function resolveIndexesFor(session: Session): string | null {
  const principalName = session.getAttribute(PRINCIPAL_NAME_INDEX_NAME) as string | null;
  if (principalName !== null) return principalName;

  const jsonString = session.getAttribute(SPRING_SECURITY_CONTEXT);
  if (typeof jsonString === 'string') {
    const context = JSON.parse(jsonString) as SecurityContext;
    return context?.authentication?.name ?? context.authentication?.principal?.name ?? null;
  }
  return null;
}

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

// 15549130 <spring:session:sessions:uuid, hash<session>> + 300s
// 15549147 <spring:session:sessions:expirations, sorted_set<uuid>> + 300s
// 15548839 <spring:session:sessions:expires:uuid, string<empty>>
export class RedisSessionRepository implements SessionRepository<RedisSession> {
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

  private getItemKey(key: string) {
    return `${this.namespace.replace('session', 'storage')}:${key}`;
  }

  async setItem(key: string, value: unknown, expiresIn?: number) {
    const k = this.getItemKey(key);
    const v = JSON.stringify(value);
    if (expiresIn) {
      await this.redis.set(k, v, 'EX', expiresIn);
    } else {
      await this.redis.set(k, v);
    }
  }

  async getItem<T = unknown>(key: string): Promise<T | null> {
    const k = this.getItemKey(key);
    const json = await this.redis.get(k);
    return json ? (JSON.parse(json) as T) : null;
  }

  async removeItem(key: string) {
    const k = this.getItemKey(key);
    await this.redis.del(k);
  }
}
