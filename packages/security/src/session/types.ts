import type { Principal } from '../core/index';

export interface Authentication extends Principal {
  '@class': string;
  principal?: Principal;
  authorities?: string[];
  credentials?: object;
  details?: object;
}

export interface SecurityContext {
  '@class': string;
  authentication?: Authentication;
}

export type Namespace = `${string}:session`;

// package org.springframework.session;
export interface Session {
  getId(): string;
  changeSessionId(): string;

  getAttribute(name: string): string | number | null;
  getAttributeNames(): string[];
  setAttribute(name: string, value: string | number): void;
  removeAttribute(name: string): void;

  getCreationTime(): number;
  getLastAccessedTime(): number;
  setLastAccessedTime(lastAccessedTime: number): void;

  getMaxInactiveInterval(): number;
  setMaxInactiveInterval(interval: number): void;

  isExpired(): boolean;
}

export interface SessionRepository<S extends Session = Session> {
  createSession(): S;
  save(session: S): Promise<void>;
  findById(sessionId: string): Promise<S | null>;
  deleteById(sessionId: string): Promise<void>;

  // FindByIndexNameSessionRepository
  findByIndexNameAndIndexValue(indexName: string, indexValue: string): Promise<Map<string, S>>;
  findByPrincipalName(principalName: string): Promise<Map<string, S>>;

  // added
  cleanupExpiredSessions(cleanupCount?: number): Promise<void>;
}

export interface KVRepository {
  setItem(key: string, value: string, expiresIn?: number): Promise<void>;
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
}
