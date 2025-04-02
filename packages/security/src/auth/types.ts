import type { Principal } from '../core';
import type { OAuth2Token, OAuth2ClientConfig, PkceParameters, UserInfo } from '../oauth2/types';
import type { KVRepository, Session, SessionRepository } from '../session/types';
import type { CookieOptions } from '../utils/http';

export type LoggedHandler = (principal: Principal) => Promise<void>;
export type OAuth2AuthorizedHandler = (
  request: Request,
  registrationId: string,
  userInfo: UserInfo,
  token: OAuth2Token
) => Promise<Principal>;

export interface OAuth2State extends PkceParameters {
  state: string;
  nonce: string;
  registrationId: string;
}

export interface AuthConfig {
  timing?: boolean;
  kvRepository: KVRepository;
  sessionRepository: SessionRepository;
  cookie?: CookieOptions & { name?: string };
  oauth2?: {
    client?: OAuth2ClientConfig;
  };
}

export interface AuthService {
  // basic
  logout: (request: Request) => Promise<Response>;
  logged: (request: Request, onLogged?: LoggedHandler) => Promise<Response>;

  // oauth2
  oauth2State: (request: Request) => Promise<Response>;
  oauth2Authorization: (request: Request) => Promise<Response>;
  loginOAuth2Code: (request: Request, onAuthorized: OAuth2AuthorizedHandler) => Promise<Response>;
  loginOAuth2Native: (request: Request, onAuthorized: OAuth2AuthorizedHandler) => Promise<Response>;

  // session management
  kick: (principal: Principal) => Promise<void>;
  isAuthenticated: (request: Request) => Promise<boolean>;
  getSession: <T extends boolean>(
    request: Request,
    create: T
  ) => Promise<T extends true ? Session : Session | null>;
  deleteSession: (sessionId: string) => Promise<void>;
  cleanupExpiredSessions: (cleanupCount?: number) => Promise<Response>;
}
