import type { Principal } from '../core';
import type { OAuth2ClientConfig, OAuth2Token, UserInfo } from '../oauth2/types';
import type { KVRepository, Session, SessionRepository } from '../session/types';
import type { CookieOptions } from '../utils/http';
import type { EmailSender } from './email-codes';

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

/**
 * Creates or updates the user and returns the principal whose `name` the session stores. Throw an
 * `AuthenticationError` to refuse the sign-in with a reason the client can act on; any other error
 * is treated as a server fault.
 */
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
  /**
   * Query parameters added to this flow's redirect back to the app, on `successUri` and on
   * `errorUri` alike, e.g. an id the page that opened a sign-in popup matches the result against.
   * Unlike `attributes` they reach the browser. Stored with the authorization request, so a
   * callback that cannot find it (no session) goes without them. The names the redirects use
   * themselves (`status`, `provider`, `error`, `error_description`, `reason`) are dropped, even
   * where a redirect leaves one out, and a refusal's metadata wins over a parameter it shares a name
   * with. `undefined` values are dropped, and the same 2 KB limit applies, as an invariant: a value
   * from the browser (a query parameter) is the host's to check first.
   */
  redirectParams?: Record<string, string | undefined>;
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
    /**
     * Also carry the session id in the `X-Auth-Token` header, for clients without a cookie jar
     * (a CLI, a desktop shell), as Spring Session's `HeaderHttpSessionIdResolver` does: every
     * response that sets the session cookie (a login, `logged`) also answers `X-Auth-Token: <id>`,
     * and a request without the cookie is read from the same header. Default `false`. Turning it
     * on exposes the id to same-origin scripts, which the cookie's `HttpOnly` kept it from, and a
     * cross-origin client needs the header in `Access-Control-Expose-Headers`. The header is for
     * the session id only: an API token for programmatic access is a different credential and
     * is not read here.
     */
    header?: boolean;
  };
  turnstileSecretKey?: string;
  /** Limits of email verification codes (a code itself is valid for 10 minutes). */
  verificationCode?: {
    /**
     * Wrong guesses a code survives: once a login exceeds this many attempts the code is discarded
     * and `loginEmail` answers `403 VERIFICATION_CODE_ATTEMPTS_EXCEEDED`. Default 5.
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
    nonce?: {
      /**
       * Provider keys whose logins may arrive without a nonce. By default every flow a provider
       * declares as echoing one (`Provider.nonce`) must carry it: the redirect flow's id token the
       * nonce `Auth` sent, a One Tap `credential` or a native id token one issued by `GET
       * /oauth2/nonce/:provider` (`oauth2Nonce`) and unused so far, so each signs in once. Without
       * that, anyone holding a user's id token could replay it for a new session until it expires.
       * List a provider here only while a client that does not pass a nonce yet is phased out; a
       * nonce such a login does carry is still checked and consumed.
       */
      optional?: string[];
    };
  };
}

/**
 * Which sessions `logout` ends, as Supabase's `signOut({ scope })` names them: `local`, the one
 * the request carries (default); `global`, every session of its principal, this one included
 * ("sign out everywhere"); `others`, every session of its principal but this one, which keeps the
 * caller signed in and its cookie untouched ("sign out other devices").
 */
export type LogoutScope = 'local' | 'others' | 'global';

export interface LogoutOptions {
  scope?: LogoutScope;
}

export interface AuthService {
  // basic
  csrf: (request: Request) => Promise<Response>;
  logout: (request: Request, options?: LogoutOptions) => Promise<Response>;
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

  // email
  sendEmailVerificationCode: (request: Request, sender: EmailSender) => Promise<Response>;
  loginEmail: (request: Request, onAuthorized: AuthorizedHandler) => Promise<Response>;
  /**
   * Spends a mailed code without signing in, for a host flow that only needs proof of the address
   * (verifying or changing a signed-in user's email). Throws `AuthenticationError`
   * (`INVALID_VERIFICATION_CODE`, `VERIFICATION_CODE_ATTEMPTS_EXCEEDED`) as `loginEmail` answers.
   */
  verifyEmailCode: (email: string, verificationCode: string) => Promise<void>;

  // desktop
  desktopAuthorize: (request: Request) => Promise<Response>;
  desktopExchange: (request: Request) => Promise<Response>;

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
