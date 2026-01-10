import { randomUUID } from 'crypto';
import type { Session } from './types';

function generateId() {
  return randomUUID();
}

const DEFAULT_MAX_INACTIVE_INTERVAL = 1800;

export class MapSession implements Session {
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
