import type { Principal } from '../core';
import type { OAuth2ClientConfig, OAuth2Token, UserInfo } from '../oauth2/types';
import type { KVRepository, Session, SessionRepository } from '../session/types';
import type { CookieOptions } from '../utils/http';

export type LoggedHandler = (principal: Principal) => Promise<void>;
export type AuthorizedHandler = (
  request: Request,
  registrationId: string,
  userInfo: UserInfo,
  token?: OAuth2Token
) => Promise<Principal>;

export interface AuthConfig {
  timing?: boolean;
  kvRepository: KVRepository;
  sessionRepository: SessionRepository;
  cookie?: CookieOptions & { name?: string };
  turnstileSecretKey?: string;
  oauth2?: {
    client?: OAuth2ClientConfig;
  };
}

export interface AuthService {
  // basic
  csrf: (request: Request) => Promise<Response>;
  logout: (request: Request) => Promise<Response>;
  logged: (request: Request, onLogged?: LoggedHandler) => Promise<Response>;

  // oauth2
  oauth2State: (request: Request) => Promise<Response>;
  oauth2Nonce: (request: Request) => Promise<Response>;
  oauth2Authorization: (request: Request) => Promise<Response>;
  loginOAuth2Code: (request: Request, onAuthorized: AuthorizedHandler) => Promise<Response>;
  loginOAuth2Native: (request: Request, onAuthorized: AuthorizedHandler) => Promise<Response>;
  loginOAuth2Onetap: (
    request: Request,
    onAuthorized: AuthorizedHandler,
    registrationId?: string
  ) => Promise<Response>;

  // email & phone
  sendEmailVerificationCode: (
    request: Request,
    sender: (data: { email: string; verificationCode: string }) => Promise<void>
  ) => Promise<Response>;
  sendPhoneVerificationCode: (
    request: Request,
    sender: (data: { phone: string; verificationCode: string }) => Promise<void>
  ) => Promise<Response>;

  loginEmail: (request: Request, onAuthorized: AuthorizedHandler) => Promise<Response>;
  loginPhone: (request: Request, onAuthorized: AuthorizedHandler) => Promise<Response>;

  // session management
  kick: (principal: Principal) => Promise<void>;
  isAuthenticated: (request: Request) => Promise<boolean>;
  getSession: <T extends boolean>(
    request: Request,
    create: T
  ) => Promise<T extends true ? Session : Session | null>;
  deleteSession: (sessionId: string) => Promise<void>;
  getPrincipal: (request: Request) => Promise<Principal | null>;
  listSessions: (principal: Principal) => Promise<Session[]>;
  cleanupExpiredSessions: (cleanupCount?: number) => Promise<Response>;
}
