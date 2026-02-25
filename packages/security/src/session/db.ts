import { randomUUID } from 'crypto';
import { PRINCIPAL_NAME_INDEX_NAME, resolveIndexesFor } from './common';
import { MapSession } from './map-session';
import type { SessionRepository } from './types';

interface SessionEntity {
  primaryId: string;
  sessionId: string;
  creationTime: number;
  lastAccessTime: number;
  maxInactiveInterval: number;
  expiryTime: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attributes: Record<string, any>;
  principalName?: string | null;
}

class DBSession extends MapSession {
  public isNew: boolean;
  public primaryId: string;

  constructor(cached: MapSession, isNew: boolean) {
    super(cached);
    this.isNew = isNew;
    this.primaryId = randomUUID();
  }
}

export interface DBAdapter {
  save(session: SessionEntity): Promise<void>;
  deleteById(sessionId: string): Promise<void>;
  findById(sessionId: string): Promise<SessionEntity | null>;
  findByPrincipalName(principalName: string): Promise<SessionEntity[]>;
  cleanupExpiredSessions(cleanupCount?: number): Promise<void>;
}

export class DBIndexedSessionRepository implements SessionRepository<DBSession> {
  private defaultMaxInactiveInterval = 1800;
  private db: DBAdapter;

  constructor(db: DBAdapter) {
    this.db = db;
  }

  setDefaultMaxInactiveInterval(interval: number) {
    this.defaultMaxInactiveInterval = interval;
  }

  private mapSessionToEntity(session: DBSession): SessionEntity {
    const attributes: Record<string, string | number | null> = {};
    for (const name of session.getAttributeNames()) {
      attributes[name] = session.getAttribute(name);
    }
    const principalName = resolveIndexesFor(session);

    return {
      primaryId: session.primaryId,
      sessionId: session.getId(),
      creationTime: session.getCreationTime(),
      lastAccessTime: session.getLastAccessedTime(),
      maxInactiveInterval: session.getMaxInactiveInterval(),
      expiryTime: session.getLastAccessedTime() + session.getMaxInactiveInterval() * 1000,
      attributes,
      principalName,
    };
  }

  private mapEntityToSession(entity: SessionEntity, allowExpired: boolean): DBSession | null {
    const loaded = new MapSession(entity.sessionId);
    loaded.setCreationTime(entity.creationTime);
    loaded.setLastAccessedTime(entity.lastAccessTime);
    loaded.setMaxInactiveInterval(entity.maxInactiveInterval);
    for (const [key, value] of Object.entries(entity.attributes)) {
      loaded.setAttribute(key, value);
    }

    if (!allowExpired && loaded.isExpired()) return null;
    const session = new DBSession(loaded, false);
    session.primaryId = entity.primaryId;
    return session;
  }

  private async getSession(id: string, allowExpired: boolean): Promise<DBSession | null> {
    const entity = await this.db.findById(id);
    if (!entity) return null;
    return this.mapEntityToSession(entity, allowExpired);
  }

  // override
  createSession() {
    const cached = new MapSession();
    cached.setMaxInactiveInterval(this.defaultMaxInactiveInterval);
    return new DBSession(cached, true);
  }

  async save(session: DBSession) {
    const entity = this.mapSessionToEntity(session);
    await this.db.save(entity);
    session.isNew = false;
  }

  async findById(sessionId: string): Promise<DBSession | null> {
    return this.getSession(sessionId, false);
  }

  async deleteById(sessionId: string) {
    await this.db.deleteById(sessionId);
  }

  async findByIndexNameAndIndexValue(
    indexName: string,
    indexValue: string
  ): Promise<Map<string, DBSession>> {
    if (indexName !== PRINCIPAL_NAME_INDEX_NAME) {
      return new Map<string, DBSession>();
    }
    const entities = await this.db.findByPrincipalName(indexValue);
    if (entities.length === 0) {
      return new Map<string, DBSession>();
    }
    const sessions = new Map<string, DBSession>();
    for (const entity of entities) {
      const session = this.mapEntityToSession(entity, false);
      if (session) {
        sessions.set(session.getId(), session);
      }
    }
    return sessions;
  }

  async findByPrincipalName(principalName: string): Promise<Map<string, DBSession>> {
    return this.findByIndexNameAndIndexValue(PRINCIPAL_NAME_INDEX_NAME, principalName);
  }

  async cleanupExpiredSessions(cleanupCount?: number): Promise<void> {
    return this.db.cleanupExpiredSessions(cleanupCount);
  }
}
