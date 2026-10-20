import type { Principal } from '../core';
import type { OAuth2ClientConfig, OAuth2Token, UserInfo } from '../oauth2/types';
import type { KVRepository, Session, SessionRepository } from '../session/types';
import type { CookieOptions } from '../utils/http';

export type LoggedHandler = (principal: Principal) => Promise<void>;
/**
 * What `onAuthorized` gets besides the user: the `attributes` the host attached when it started a
 * redirect flow with `oauth2Authorization(request, { attributes })` — empty for every other login
 * method (native, One Tap, email), whose request the handler can read directly.
 */
export interface AuthorizedContext {
  attributes: Record<string, string>;
}

export type AuthorizedHandler = (
  request: Request,
  registrationId: string,
  userInfo: UserInfo,
  token?: OAuth2Token,
  context?: AuthorizedContext
) => Promise<Principal>;

export interface OAuth2AuthorizationOptions {
  /**
   * Values to carry from the start of a redirect flow to its callback, e.g. a referral code read
   * from a cookie or query parameter of the authorization request. Stored with the authorization
   * request in the session (never sent to the provider), returned to `onAuthorized` as
   * `context.attributes` once state and session check out, and removed with the request after a
   * successful login. `undefined` values are dropped. At most 2 KB serialized.
   *
   * They come from the browser that started the flow, so trust them like a cookie: fine for
   * attribution or where to go next, not for authorization decisions.
   */
  attributes?: Record<string, string | undefined>;
}

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
  oauth2Authorization: (
    request: Request,
    options?: OAuth2AuthorizationOptions
  ) => Promise<Response>;
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
