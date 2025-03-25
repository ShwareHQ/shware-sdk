import { randomUUID } from 'crypto';
import type { Redis } from 'ioredis';

type Config = {
  namespace: string;
  timeout: number;
};

interface Principal {
  getName(): string;
}

type JSONValue =
  | null
  | string
  | number
  | boolean
  | Array<JSONValue>
  | { [value: string]: JSONValue };

interface SessionHash {
  lastAccessedTime: number;
  creationTime: number;
  maxInactiveInterval: number;
  // sessionAttr:name -> value
  [key: string]: JSONValue;
}
const namespace = 'hackertalk';
const maxInactiveInterval = 1800;

// package org.springframework.session;
interface Session {
  getId(): string;
  changeSessionId(): string;

  getAttribute(name: string): JSONValue | null;
  getAttributeNames(): string[];
  setAttribute(name: string, value: JSONValue): void;
  removeAttribute(name: string): void;

  getCreationTime(): number;
  getLastAccessedTime(): number;
  setLastAccessedTime(lastAccessedTime: number): void;

  getMaxInactiveInterval(): number;
  setMaxInactiveInterval(interval: number): void;

  isExpired(): boolean;
}

const DEFAULT_MAX_INACTIVE_INTERVAL_SECONDS = 1800;

class MapSession implements Session {
  private id: string;
  private readonly originalId: string;

  private sessionAttrs = new Map<string, JSONValue>();
  private creationTime = Date.now();
  private lastAccessedTime = this.creationTime;
  private maxInactiveInterval = DEFAULT_MAX_INACTIVE_INTERVAL_SECONDS;

  constructor(id: string) {
    this.id = id;
    this.originalId = id;
  }

  static create() {
    return new MapSession(randomUUID());
  }

  static fromSession(session: Session): MapSession {
    const mapSession = new MapSession(session.getId());
    for (const attrName of session.getAttributeNames()) {
      const attrValue = session.getAttribute(attrName);
      if (attrValue === null) continue;
      mapSession.setAttribute(attrName, attrValue);
    }

    mapSession.lastAccessedTime = session.getLastAccessedTime();
    mapSession.creationTime = session.getCreationTime();
    mapSession.maxInactiveInterval = session.getMaxInactiveInterval();
    return mapSession;
  }

  private generateId() {
    return randomUUID();
  }

  setId(id: string) {
    this.id = id;
  }

  // override
  getId() {
    return this.id;
  }

  getOriginalId() {
    return this.originalId;
  }

  changeSessionId() {
    const changedId = this.generateId();
    this.id = changedId;
    return changedId;
  }

  getAttribute(name: string) {
    return this.sessionAttrs.get(name) ?? null;
  }

  getAttributeNames(): string[] {
    return Array.from(this.sessionAttrs.keys());
  }

  setAttribute(name: string, value: JSONValue) {
    this.sessionAttrs.set(name, value);
  }

  removeAttribute(name: string) {
    this.sessionAttrs.delete(name);
  }

  getCreationTime() {
    return this.creationTime;
  }

  setCreationTime(creationTime: number) {
    this.creationTime = creationTime;
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

const CREATION_TIME_KEY = 'creationTime';
const LAST_ACCESSED_TIME_KEY = 'lastAccessedTime';
const MAX_INACTIVE_INTERVAL_KEY = 'maxInactiveInterval';
const ATTRIBUTE_PREFIX = 'sessionAttr:';

// todo: rename to KVSession
class RedisSession implements Session {
  private readonly cached: MapSession;

  public isNew: boolean;
  public delta = new Map<string, JSONValue>();
  public originalSessionId: string;
  public originalLastAccessTime: number | null = null;

  constructor(cached: MapSession, isNew: boolean) {
    this.cached = cached;
    this.isNew = isNew;
    this.originalSessionId = cached.getId();
    if (isNew) {
      this.delta.set(CREATION_TIME_KEY, cached.getCreationTime());
      this.delta.set(LAST_ACCESSED_TIME_KEY, cached.getLastAccessedTime());
      this.delta.set(MAX_INACTIVE_INTERVAL_KEY, cached.getMaxInactiveInterval());
      this.cached
        .getAttributeNames()
        .forEach((name) => this.delta.set(ATTRIBUTE_PREFIX + name, this.cached.getAttribute(name)));
    }
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
    const newSessionId = randomUUID();
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
    this.delta.set(ATTRIBUTE_PREFIX + name, value);
  }

  removeAttribute(name: string) {
    this.cached.removeAttribute(name);
    this.delta.delete(ATTRIBUTE_PREFIX + name);
  }
}

interface SessionRepository<S extends Session> {
  createSession(): S;
  save(session: S): Promise<void>;
  findById(sessionId: string): Promise<S | null>;
  deleteById(sessionId: string): Promise<void>;

  // FindByIndexNameSessionRepository
  findByIndexNameAndIndexValue(indexName: string, indexValue: string): Promise<Map<string, S>>;
  findByPrincipalName(principalName: string): Promise<Map<string, S>>;
}

// class CacheSession implements Session {
//   private readonly isNew: boolean;
//   private readonly cached: MapSession;
//   private readonly originalSessionId: string;

//   constructor(cached: MapSession, isNew: boolean) {
//     this.cached = cached;
//     this.isNew = isNew;
//     this.originalSessionId = cached.getId();
//   }
// }

// https://juejin.cn/post/7262623363700408357
// 15549130 <spring:session:sessions:uuid, hash<session>> + 300s
// 15549147 <spring:session:expirations:timestamp, set<expires:uuid>>  + 300s, cell to 1-minute level
// 15548839 <spring:session:sessions:expires:uuid, string<empty>>
class IndexedSessionRepository implements SessionRepository<RedisSession> {
  private defaultMaxInactiveInterval = 1800;
  private readonly attributePrefix = 'sessionAttr:';
  private readonly sessionExpiresPredix = 'expires:';

  private readonly redis: Redis;
  private readonly namespace: string;

  constructor(redis: Redis, namespace: `${string}:session`) {
    this.redis = redis;
    this.namespace = namespace;
  }

  getSessionKey(sessionId: string) {
    return `${this.namespace}:sessions:${sessionId}`;
  }

  getExpiredKey(sessionId: string) {
    return `${this.namespace}:sessions:expires:${sessionId}`;
  }

  getExpirationKey(expires: number) {
    return `${this.namespace}:expirations:${expires}`;
  }

  getIndexKey(indexName: string, indexValue: string) {
    return `${this.namespace}:index:${indexName}:${indexValue}`;
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
      if (key.startsWith(this.attributePrefix)) {
        loaded.setAttribute(key.slice(this.attributePrefix.length), value);
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
    session.isNew = false;
    session.delta.clear();
    const originalExpiration =
      session.originalLastAccessTime !== null
        ? session.originalLastAccessTime + session.getMaxInactiveInterval()
        : null;

    // onExpirationUpdated
    const keyToExpire = this.sessionExpiresPredix + session.getId();
    const toExpire = this.roundUpToNextMinute(this.expiresInMillis(session));
    if (originalExpiration !== null) {
      const originalRoundedUp = this.roundUpToNextMinute(originalExpiration);
      if (toExpire !== originalRoundedUp) {
        const expireKey = this.getExpirationKey(originalRoundedUp);
        await this.redis.srem(expireKey, keyToExpire);
      }
    }
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
      // todo: rename index
    }
    session.originalSessionId = sessionId;
  }

  // override
  createSession() {
    const cached = MapSession.create();
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
    const expireKey = this.getExpirationKey(toExpire);
    const entryToRemove = this.sessionExpiresPredix + session.getId();
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
    return this.findByIndexNameAndIndexValue('PRINCIPAL_NAME_INDEX_NAME', principalName);
  }
}
