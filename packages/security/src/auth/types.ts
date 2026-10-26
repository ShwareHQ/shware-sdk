import type { Principal } from '../core';
import type { OAuth2ClientConfig, OAuth2Token, UserInfo } from '../oauth2/types';
import type { KVRepository, Session, SessionRepository } from '../session/types';
import type { CookieOptions } from '../utils/http';

export type LoggedHandler = (principal: Principal) => Promise<void>;
/**
 * Who signed in, and how: what every login method hands to `onAuthorized`.
 *
 * - `provider`: the key of the provider in `oauth2.client.providers` (`apple`, `google`, ...), or
 *   `EMAIL` for email sign-in. With `userInfo.claims.sub` it identifies the user: a provider's
 *   subjects are the same whichever of its clients the user came through.
 * - `clientId`: the client the user signed in through (the web client, an app's bundle id, ...),
 *   telling the surfaces apart; absent for email sign-in.
 * - `userInfo`: the provider's user info, or the verified email as claims.
 * - `token`: the provider's tokens; absent for email sign-in.
 * - `attributes`: what the host attached when it started a redirect flow with
 *   `oauth2Authorization(request, { attributes })`, or the `attributes` field of a native, One Tap
 *   (JSON) or email login body; `{}` when there were none.
 */
export interface Authorization {
  provider: string;
  clientId?: string;
  userInfo: UserInfo;
  token?: OAuth2Token;
  attributes: Record<string, string>;
}

/** Creates or updates the user and returns the principal whose `name` the session stores. */
export type AuthorizedHandler = (
  request: Request,
  authorization: Authorization
) => Promise<Principal>;

export interface OAuth2AuthorizationOptions {
  /**
   * Values to carry from the start of a redirect flow to its callback, e.g. a referral code read
   * from a cookie or query parameter of the authorization request. Stored with the authorization
   * request in the session (never sent to the provider), returned to `onAuthorized` as
   * `authorization.attributes` once state and session check out, and removed with the request after a
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
  session?: {
    /**
     * Seconds between two writes of a session's `lastAccessedTime` from authenticated access
     * (`getPrincipal`, `isAuthenticated`): every request that authenticates renews the session's
     * expiry (sliding expiration, as Spring Session and `express-session`'s `rolling` do), but
     * the row is only rewritten when the previous access is older than this, so expiry lags real
     * activity by at most this much while active sessions cost one write per interval. Default
     * 3600 (an hour); `0` writes on every authenticated request.
     */
    touchInterval?: number;
  };
  turnstileSecretKey?: string;
  /** Limits of email verification codes (a code itself is valid for 10 minutes). */
  verificationCode?: {
    /**
     * Wrong guesses a code survives: once a login exceeds this many attempts the code is discarded
     * and `loginEmail` answers `VERIFICATION_CODE_ATTEMPTS_EXCEEDED`. Default 5.
     */
    maxAttempts?: number;
    /**
     * Seconds after a send before the same email can be sent another code; earlier requests are
     * answered `429 VERIFICATION_CODE_RESEND_TOO_SOON`. Default 60.
     */
    resendCooldown?: number;
  };
  oauth2?: {
    client?: OAuth2ClientConfig;
    /** Google One Tap / FedCM sign-in (`loginOAuth2Onetap`). */
    onetap?: {
      /**
       * Require the One Tap `credential` to carry a `nonce` claim issued by `GET
       * /oauth2/nonce/google` (`oauth2Nonce`) and unused so far; each nonce signs in once. Without
       * it, anyone holding a user's ID token could replay it for a new session until it expires.
       * Turn off only while a front end that does not yet pass `nonce` to `prompt` is phased out.
       * Default `true`.
       */
      requireNonce?: boolean;
    };
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
    provider?: string
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
  /** Checks a mailed code without signing in (verifying or changing a user's email); consumes it. */
  verifyEmailCode: (email: string, verificationCode: string) => Promise<EmailCodeVerification>;
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

/** `verifyEmailCode`'s answer: the code matched and is now spent, or why it did not. */
export type EmailCodeVerification =
  | { ok: true }
  | { ok: false; error: 'INVALID_VERIFICATION_CODE' | 'VERIFICATION_CODE_ATTEMPTS_EXCEEDED' };
