import { Redis } from 'ioredis';

export interface HttpSession<T extends Record<string, any>> {
  /** A string containing the unique identifier assigned to this session */
  id: string;

  /**
   * The time when this session was created, measured in milliseconds since midnight January 1,
   * 1970 GMT
   * */
  creationTime: number;

  /**
   * The last time the client sent a request associated with this session, as the number of
   * milliseconds since midnight January 1, 1970 GMT, and marked by the time the session manager
   * received the request.
   *
   * Actions that your application takes, such as getting or setting a value associated with the
   * session, do not affect the access time
   * */
  lastAccessedTime: number;

  /**
   * Specifies the time, in seconds, between client requests before the session manager will
   * invalidate this session. A zero or negative time indicates that the session should never
   * timeout.
   * */
  maxInactiveInterval: number;

  // OAuth2AuthorizationRequest
  /**
   * the object bound with the specified name in this session, or null if no object is bound under
   * the name.
   * */
  attributes: T;

  /**
   * Returns true if the client does not yet know about the session or if the client chooses not to
   * join the session. For example, if the server used only cookie-based sessions, and the client
   * had disabled the use of cookies, then a session would be new on each request.
   * */
  isNew: boolean;

  /** Invalidates this session then unbinds any objects bound to it. */
  invalidate(): void;
}

export interface OAuth2AuthorizationRequest {
  state: string;
  nonce?: string;
  codeVerifier?: string;
  registrationId: string;
}

export interface SessionManagerOptions {
  namespace: string;
  redisUrl: string;
}

export class SessionManager<T extends Record<string, any>> {
  private readonly redis: Redis;
  private readonly namespace: string;

  constructor(options: SessionManagerOptions) {
    this.redis = new Redis(options.redisUrl);
    this.namespace = options.namespace;
  }

  getSession(sessionId?: string, create: boolean = true) {
    const { redis, namespace } = this;
    redis.hset(`${namespace}:session:sessions:${sessionId}`, {});
  }

  onSessionCreated(callback: (session: HttpSession<T>) => void) {}
  onSessionExpired(callback: (session: HttpSession<T>) => void) {}
}

// https://juejin.cn/post/7262623363700408357
// 15549130 <spring:session:sessions:uuid, hash<session>> + 300s
// 15549147 <spring:session:expirations:timestamp, set<expires:uuid>>  + 300s, cell to 1-minute level
// 15548839 <spring:session:sessions:expires:uuid, string<empty>>
