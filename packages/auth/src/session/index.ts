import { randomUUID } from 'crypto';
import type { Redis } from 'ioredis';
import type { Session, JSONValue, SecurityContext } from './types';

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
