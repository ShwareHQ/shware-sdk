import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { invariant } from '@shware/utils';
import { extend, literal, object, regex, string } from 'zod/mini';
import type { Principal } from '../core/index';
import { loginEmailSchema, sendEmailVerificationCodeSchema } from '../email/schema';
import { OAuth2Client, googleOneTapSchema, oauth2RedirectQuerySchema } from '../oauth2/client';
import { OAuth2Error, type OAuth2ErrorType, isKnownOAuth2ErrorType } from '../oauth2/error';
import type {
  NativeCredential,
  OAuth2AuthorizationRequest,
  PkceParameters,
  StandardClaims,
} from '../oauth2/types';
import { PRINCIPAL_NAME_INDEX_NAME } from '../session/common';
import type { KVRepository, Session, SessionRepository } from '../session/types';
import {
  type CookieOptions,
  deleteCookie,
  getCookie,
  param,
  query,
  setCookie,
} from '../utils/http';
import { timing } from '../utils/timing';
import { parse, readForm, readJson, verifyTurnstileToken } from '../utils/valid';
import {
  MAX_ATTRIBUTES_BYTES,
  attributesSchema,
  attributesSize,
  bodyAttributes,
} from './attributes';
import { DesktopCodes } from './desktop-codes';
import { type EmailSender, EmailVerificationCodes } from './email-codes';
import { AuthenticationError } from './error';
import { errorResponse, invalidArgument, unauthenticated } from './respond';
import type {
  AuthConfig,
  AuthService,
  Authorization,
  AuthorizedHandler,
  LoggedHandler,
  LogoutOptions,
  OAuth2AuthorizationOptions,
} from './types';

// PKCE per RFC 7636: code_verifier / code_challenge are 43-128 chars from
// the unreserved set. We restrict to base64url (drops "." and "~") since
// that's what S256 produces and what callers should be sending; rejecting
// the rest shrinks the accepted input shape without losing legit clients.
// A 32-byte random verifier base64url-encodes to exactly 43 chars.
const PKCE_FORMAT = /^[A-Za-z0-9_-]{43,128}$/;

// A native app's `code_verifier` goes on to the provider, which checks it against the challenge
// the app sent: accept the whole RFC 7636 unreserved set here, as the provider does.
const CODE_VERIFIER_FORMAT = /^[A-Za-z0-9._~-]{43,128}$/;

/** The header a session id travels in besides the cookie, with `session.header` on. */
const SESSION_HEADER = 'X-Auth-Token';

/** Seconds an OAuth2 state or nonce may be used within. */
const OAUTH2_PARAMETER_TTL = 10 * 60;

// error_description forwarded to errorUri comes from the provider or an error message: cap it so
// the redirect URL stays short and an attacker-crafted callback cannot stuff the page with text.
const MAX_ERROR_DESCRIPTION_LENGTH = 256;

/** An error code safe to put on errorUri: a registered one as is, anything else as `fallback`. */
function safeErrorType(error: string, fallback: OAuth2ErrorType): OAuth2ErrorType {
  return isKnownOAuth2ErrorType(error) ? error : fallback;
}

/**
 * The codes a failure past validation keeps on errorUri, each one the user can act on: the code
 * expired or was used (start again), they declined, or the provider is briefly down. Every other
 * failure there (a rejected client, a user info request that failed) is the app's or the
 * provider's problem, which the user sees as `server_error`.
 */
const CALLBACK_ERROR_TYPES: ReadonlySet<OAuth2ErrorType> = new Set([
  'invalid_grant',
  'access_denied',
  'temporarily_unavailable',
]);

/**
 * The host's values for the flow (`attributes`, `redirectParams`, named by `name` in the error),
 * `undefined` ones dropped.
 */
function authorizationAttributes(
  attributes: OAuth2AuthorizationOptions['attributes'],
  name = 'attributes'
): Record<string, string> | undefined {
  if (!attributes) return undefined;
  const defined: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) defined[key] = value;
  }
  if (Object.keys(defined).length === 0) return undefined;
  // The host's own values, written with the session: oversized is a bug in the host, not a 400.
  const size = attributesSize(defined);
  invariant(
    size <= MAX_ATTRIBUTES_BYTES,
    `oauth2 authorization ${name} are ${size} bytes, at most ${MAX_ATTRIBUTES_BYTES} allowed`
  );
  return defined;
}

interface RedirectDetails {
  description?: string;
  refusal?: AuthenticationError;
  /** The flow's `redirectParams`. */
  params?: Record<string, string>;
}

/**
 * What the callback's redirects say themselves. A host's `redirectParams` never carry these, even
 * on a redirect that leaves one out (a cancel has no `reason`): the page would read it as the SDK's.
 */
const REDIRECT_PARAMS = new Set(['status', 'provider', 'error', 'error_description', 'reason']);

/** The flow's `redirectParams` without the names the redirects keep for themselves. */
function hostParams(params: Record<string, string> | undefined) {
  if (!params) return undefined;
  return Object.fromEntries(Object.entries(params).filter(([key]) => !REDIRECT_PARAMS.has(key)));
}

/** `base` with `params` added, none replacing one it carries itself. */
function withParams(base: string, params: Record<string, string> = {}) {
  const uri = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (!uri.searchParams.has(key)) uri.searchParams.set(key, value);
  }
  return uri;
}

/** Sign in with Apple answers with `response_mode=form_post`; a charset parameter may follow. */
function isFormPost(request: Request) {
  const contentType = request.headers.get('content-type')?.toLowerCase();
  return (
    request.method === 'POST' && !!contentType?.startsWith('application/x-www-form-urlencoded')
  );
}

/** Google's own form post carries no attributes; an app posting JSON may add them. */
const oneTapBodySchema = extend(googleOneTapSchema, { attributes: attributesSchema });

const desktopAuthorizeSchema = object({
  code_challenge: string().check(regex(PKCE_FORMAT)),
  code_challenge_method: literal('S256'),
});

const desktopExchangeSchema = object({
  code: string(),
  code_verifier: string().check(regex(PKCE_FORMAT)),
});

export const PATH = {
  CSRF: '/csrf',
  LOGOUT: '/logout',
  LOGGED: '/logged',

  OAUTH2_STATE: '/oauth2/state/:provider',
  OAUTH2_NONCE: '/oauth2/nonce/:provider',
  OAUTH2_AUTHORIZATION: '/oauth2/authorization/:provider',
  LOGIN_OAUTH2_CODE: '/login/oauth2/code/:provider',
  LOGIN_OAUTH2_NATIVE: '/login/oauth2/native/:provider',
  LOGIN_OAUTH2_ONETAP: '/login/oauth2/onetap/google',

  LOGIN_EMAIL: '/login/email',
  SEND_EMAIL_VERIFICATION_CODE: '/auth/sendEmailVerificationCode',

  // Desktop / native app sign-in via web loopback (RFC 8252 + OAuth 2.1 Auth Code Flow):
  //   1. user already authenticated with cookie session → POST DESKTOP_AUTHORIZE → { code }
  //   2. web redirects to desktop's loopback callback with the code
  //   3. desktop renderer POSTs DESKTOP_EXCHANGE with the code → server returns
  //      Set-Cookie carrying a fresh session, single-use code is invalidated
  // The two-step flow keeps the actual session id off the redirect URL — only a
  // 5-minute single-use code transits via the loopback.
  DESKTOP_AUTHORIZE: '/auth/desktop/authorize',
  DESKTOP_EXCHANGE: '/auth/desktop/exchange',

  CLEANUP_EXPIRED_SESSIONS: '/sessions/expired/cleanup',
} as const;

/**
 * The login routes and session helpers. Every route is one straight line: read and validate the
 * request, check the credential, call the host's `onAuthorized`, sign in. Failures are thrown and
 * answered in one place per kind of route: a JSON route runs under `guard`, which maps a
 * `RequestError`, an `AuthenticationError` or an `OAuth2Error` to its google.rpc body (see
 * `respond.ts`); the redirect callback maps the same errors to `errorUri` parameters (`redirect`).
 */
export class Auth implements AuthService {
  private readonly timing: boolean;
  private readonly cookieName;
  private readonly cookieOptions: CookieOptions;
  private readonly kv: KVRepository;
  private readonly repository: SessionRepository;
  private readonly turnstileSecretKey?: string;
  private readonly emailCodes: EmailVerificationCodes;
  private readonly desktopCodes: DesktopCodes;
  private readonly oauth2Client: OAuth2Client | null;
  /** Provider keys whose logins may come without a nonce (`oauth2.nonce.optional`). */
  private readonly nonceOptional: ReadonlySet<string>;
  private readonly touchInterval: number;
  private readonly sessionHeader: boolean;
  private readonly ATTR_OAUTH2_AUTHORIZATION_REQUEST = 'oauth2AuthorizationRequest';

  constructor({
    sessionRepository,
    kvRepository,
    turnstileSecretKey,
    verificationCode,
    oauth2,
    cookie,
    session,
    timing,
  }: AuthConfig) {
    this.timing = timing ?? false;
    this.kv = kvRepository;
    this.repository = sessionRepository;
    this.turnstileSecretKey = turnstileSecretKey;
    const maxAttempts = verificationCode?.maxAttempts ?? 5;
    const resendCooldown = verificationCode?.resendCooldown ?? 60;
    invariant(maxAttempts >= 1, 'verificationCode.maxAttempts must be at least 1');
    invariant(resendCooldown >= 1, 'verificationCode.resendCooldown must be at least 1 second');
    this.emailCodes = new EmailVerificationCodes(kvRepository, { maxAttempts, resendCooldown });
    this.desktopCodes = new DesktopCodes(kvRepository);
    const { name, ...cookieOptions } = cookie ?? {};
    this.cookieName = name ?? 'SESSION';
    this.cookieOptions = {
      path: '/',
      sameSite: 'none',
      secure: true,
      httpOnly: true,
      ...cookieOptions,
    };
    this.oauth2Client = oauth2?.client ? new OAuth2Client(oauth2.client) : null;
    this.nonceOptional = new Set(oauth2?.nonce?.optional);
    this.touchInterval = (session?.touchInterval ?? 3600) * 1000;
    this.sessionHeader = session?.header ?? false;
    invariant(this.touchInterval >= 0, 'session.touchInterval must not be negative');
  }

  // ---- sessions and responses ------------------------------------------------------------------

  private getSessionId(request: Request): string | undefined {
    const fromCookie = getCookie(request, this.cookieName);
    if (fromCookie) return fromCookie;
    return (this.sessionHeader && request.headers.get(SESSION_HEADER)) || undefined;
  }

  /** The session the request carries, if it exists. */
  private async loadSession(request: Request): Promise<Session | null> {
    const sessionId = this.getSessionId(request);
    return sessionId ? this.repository.findById(sessionId) : null;
  }

  /** The signed-in principal of a session, if any. */
  private principalOf(session: Session): Principal | null {
    const name = session.getAttribute(PRINCIPAL_NAME_INDEX_NAME);
    return name ? { name: String(name) } : null;
  }

  /**
   * A new session signed in as `principal`. With `carryOver`, what the host kept in the pre-login
   * session moves to the new one; the authorization request (state, PKCE verifier, flow
   * attributes) is single-use and was consumed, and a principal left there from an earlier
   * sign-in is replaced. The new id is never the one the browser brought, which may have been
   * planted by an attacker who started the flow (session fixation).
   */
  private async signIn(principal: Principal, carryOver?: Session): Promise<Session> {
    const session = this.repository.createSession();
    for (const attribute of carryOver?.getAttributeNames() ?? []) {
      if (attribute === this.ATTR_OAUTH2_AUTHORIZATION_REQUEST) continue;
      if (attribute === PRINCIPAL_NAME_INDEX_NAME) continue;
      const value = carryOver?.getAttribute(attribute);
      if (value !== null && value !== undefined) session.setAttribute(attribute, value);
    }
    session.setAttribute(PRINCIPAL_NAME_INDEX_NAME, principal.name);
    await this.repository.save(session);
    return session;
  }

  /**
   * `response` carrying `session`: its cookie, renewed for the whole inactive interval, and with
   * `session.header` on, the `X-Auth-Token` header a client without a cookie jar reads.
   */
  private withSession(response: Response, session: Session, cookie?: CookieOptions): Response {
    const maxAge = session.getMaxInactiveInterval();
    setCookie(response, this.cookieName, session.getId(), {
      ...this.cookieOptions,
      ...cookie,
      maxAge,
    });
    if (this.sessionHeader) response.headers.set(SESSION_HEADER, session.getId());
    return response;
  }

  /** Runs a JSON route: a failure it knows is its response, anything else is the host's. */
  private async guard(run: () => Promise<Response>): Promise<Response> {
    try {
      return await run();
    } catch (error) {
      const response = errorResponse(error);
      if (response) return response;
      throw error;
    }
  }

  /**
   * The error redirect of the callback flow: `refusal`'s reason and metadata ride along, and the
   * flow's `redirectParams` once its authorization request is known.
   */
  private redirect(
    error: OAuth2ErrorType,
    { description, refusal, params }: RedirectDetails = {}
  ): Response {
    invariant(this.oauth2Client, 'oauth2Client is not initialized');
    // A refusal's metadata wins over the host's parameters of the same name: it is about this answer.
    const uri = withParams(this.oauth2Client.errorUri, { ...params, ...refusal?.metadata });
    uri.searchParams.set('error', error);
    if (description) {
      uri.searchParams.set('error_description', description.slice(0, MAX_ERROR_DESCRIPTION_LENGTH));
    }
    if (refusal) uri.searchParams.set('reason', refusal.reason);
    return Response.redirect(uri.href, 302);
  }

  // ---- basic -----------------------------------------------------------------------------------

  csrf = async (_request: Request): Promise<Response> => {
    const token = randomUUID();
    const response = Response.json({
      token,
      parameterName: '_csrf',
      headerName: 'X-XSRF-TOKEN',
    });

    // Double Submit Cookie Protection
    setCookie(response, 'XSRF-TOKEN', token, {
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'none',
      domain: this.cookieOptions.domain,
    });
    return response;
  };

  logout = async (request: Request, options?: LogoutOptions): Promise<Response> => {
    const scope = options?.scope ?? 'local';
    const sessionId = this.getSessionId(request);
    // `global` and `others` reach the principal's other sessions through the one the request
    // carries; a request without a signed-in session has no principal to widen to, and ends as
    // `local` would.
    if (scope !== 'local' && sessionId) {
      const session = await this.repository.findById(sessionId);
      const principal = session && this.principalOf(session);
      if (principal) {
        const sessions = await this.repository.findByPrincipalName(principal.name);
        for (const id of sessions.keys()) {
          if (id !== sessionId) await this.repository.deleteById(id);
        }
      }
    }
    const response = Response.json({});
    if (scope === 'others') return response;
    if (sessionId) await this.repository.deleteById(sessionId);
    // A Set-Cookie only replaces the stored cookie when Domain and Path match (RFC 6265),
    // so clear it with the same attributes it was set with.
    deleteCookie(response, this.cookieName, this.cookieOptions);
    return response;
  };

  logged = async (request: Request, onLogged?: LoggedHandler): Promise<Response> => {
    const session = await this.loadSession(request);
    if (!session) return Response.json({ data: false });

    session.setLastAccessedTime(Date.now());
    await this.repository.save(session);

    const principal = this.principalOf(session);
    if (principal) await onLogged?.(principal);
    return this.withSession(Response.json({ data: principal !== null }), session);
  };

  // ---- oauth2 ----------------------------------------------------------------------------------

  private createPkceParameters(): PkceParameters {
    // 32 random bytes: a 43-char base64url verifier, the RFC 7636 minimum (a UUID is 36).
    const code_verifier = randomBytes(32).toString('base64url');
    const code_challenge = createHash('sha256')
      .update(code_verifier)
      .digest()
      .toString('base64url');

    return { code_verifier, code_challenge, code_challenge_method: 'S256' };
  }

  private getOauth2StateKey(state: string) {
    return `oauth2:state:${state}`;
  }

  private getOauth2NonceKey(nonce: string) {
    return `oauth2:nonce:${nonce}`;
  }

  /**
   * Spends a nonce `oauth2Nonce` issued for `provider`: `NONCE_MISMATCH` for one that was not,
   * or was used already. An id token is replayable until it expires; the nonce it carries makes
   * it sign in once.
   */
  private async consumeNonce(nonce: string, provider: string): Promise<void> {
    const key = this.getOauth2NonceKey(nonce);
    if ((await this.kv.getItem(key)) !== provider) throw new AuthenticationError('NONCE_MISMATCH');
    await this.kv.removeItem(key);
  }

  /**
   * The nonce check of the JSON logins (One Tap, native), where the client obtained the id token
   * and the nonce came from `oauth2Nonce`: spends the one the token carries, and refuses a token
   * without one when the provider's flow echoes nonces (`required`) and the host has not listed the
   * provider as optional. An id token is replayable until it expires; the nonce makes it sign in
   * once.
   */
  private async checkIssuedNonce(
    userInfo: Authorization['userInfo'],
    provider: string,
    required: boolean
  ): Promise<boolean> {
    const { nonce } = userInfo.data as { nonce?: unknown };
    if (typeof nonce === 'string' && nonce) {
      await this.consumeNonce(nonce, provider);
      return true;
    }
    if (required && !this.nonceOptional.has(provider)) {
      throw new AuthenticationError('NONCE_MISSING');
    }
    return false;
  }

  oauth2State = async (request: Request): Promise<Response> => {
    const { provider } = param(request, PATH.OAUTH2_STATE);
    const state = randomUUID();
    await this.kv.setItem(this.getOauth2StateKey(state), provider, OAUTH2_PARAMETER_TTL);
    return Response.json({ state });
  };

  oauth2Nonce = async (request: Request): Promise<Response> => {
    const { provider } = param(request, PATH.OAUTH2_NONCE);
    const nonce = randomUUID();
    await this.kv.setItem(this.getOauth2NonceKey(nonce), provider, OAUTH2_PARAMETER_TTL);
    return Response.json({ nonce });
  };

  oauth2Authorization = (
    request: Request,
    options?: OAuth2AuthorizationOptions
  ): Promise<Response> =>
    this.guard(async () => {
      invariant(this.oauth2Client, 'oauth2Client is not initialized');
      const attributes = authorizationAttributes(options?.attributes);
      const redirectParams = authorizationAttributes(options?.redirectParams, 'redirectParams');
      const { mark, setTiming } = timing({ enabled: this.timing });
      const { provider } = param(request, PATH.OAUTH2_AUTHORIZATION);
      const state = randomUUID();
      const pkce = this.createPkceParameters();
      // Sent only to a provider whose id token echoes it: the callback then requires it back, so
      // a code that was swapped in for another sign-in's yields a token the session refuses.
      const nonce = (await this.oauth2Client.nonceSupport(provider)).web ? randomUUID() : undefined;
      const uri = await this.oauth2Client.createAuthorizationUri({ provider, state, pkce, nonce });
      let session = await this.loadSession(request);
      if (!session) {
        // A session made for the flow only has to outlive the state: an abandoned flow must not
        // keep a row for the default interval. Sign-in moves to a new session, with the default.
        session = this.repository.createSession();
        session.setMaxInactiveInterval(OAUTH2_PARAMETER_TTL);
      }
      mark('fetch_session');

      const authorizationRequest: OAuth2AuthorizationRequest = {
        state,
        provider,
        authorizationRequestUri: uri.href,
        additionalParameters: pkce,
        ...(nonce ? { nonce } : {}),
        ...(attributes ? { attributes } : {}),
        ...(redirectParams ? { redirectParams } : {}),
      };
      session.setAttribute(
        this.ATTR_OAUTH2_AUTHORIZATION_REQUEST,
        JSON.stringify(authorizationRequest)
      );
      await this.repository.save(session);
      mark('save_session');

      const response = new Response(null, { status: 302, headers: { location: uri.href } });
      setTiming(response);
      return this.withSession(response, session);
    });

  loginOAuth2Code = async (request: Request, handler: AuthorizedHandler): Promise<Response> => {
    invariant(this.oauth2Client, 'oauth2Client is not initialized');
    const { mark, setTiming } = timing({ enabled: this.timing });

    // 1. the session the flow started on, and the authorization request it stored
    const session = await this.loadSession(request);
    if (!session) return this.redirect('invalid_request', { description: 'session not found' });
    mark('load_session');
    const json = session.getAttribute(this.ATTR_OAUTH2_AUTHORIZATION_REQUEST) as string | null;
    if (!json) {
      return this.redirect('invalid_request', { description: 'authorization request not found' });
    }
    const cached: OAuth2AuthorizationRequest = JSON.parse(json);
    // From here on the redirect back to the app is this flow's, with the host's parameters.
    const params = hostParams(cached.redirectParams);

    // 2. the provider's answer: query, or a form for Apple's response_mode=form_post
    const { provider } = param(request, PATH.LOGIN_OAUTH2_CODE);
    const data = isFormPost(request)
      ? Object.fromEntries(new URLSearchParams(await request.text()))
      : query(request);
    const parsed = oauth2RedirectQuerySchema.safeParse(data);
    if (!parsed.success) {
      return this.redirect('invalid_request', { description: 'invalid redirect query', params });
    }
    // The provider answered with an error instead of a code (the user pressed Cancel →
    // access_denied, invalid_scope, server_error, ...). Forward it rather than reporting a
    // malformed query. This runs before the state check on purpose: providers echo state on
    // error responses, but not all reliably do, and a forged error callback can only make the
    // victim's popup show an error — nothing is exchanged or signed in. A present state that does
    // not match still wins, since that is the more accurate (and more alarming) diagnosis.
    if (parsed.data.error) {
      if (parsed.data.state && parsed.data.state !== cached.state) {
        return this.redirect('invalid_request', { description: 'redirect state mismatch', params });
      }
      return this.redirect(safeErrorType(parsed.data.error, 'server_error'), {
        description: parsed.data.error_description,
        params,
      });
    }
    const { code, state, user } = parsed.data;
    if (!code || !state) {
      return this.redirect('invalid_request', { description: 'invalid redirect query', params });
    }
    if (state !== cached.state) {
      return this.redirect('invalid_request', { description: 'redirect state mismatch', params });
    }
    if (provider !== cached.provider) {
      return this.redirect('invalid_request', {
        description: 'redirect provider mismatch',
        params,
      });
    }
    mark('validate_session');

    // 3. exchange the code, load the user, sign in. Everything here can fail (an expired or reused
    // code, a network error, the host's handler or session store). The callback runs in a popup
    // the user is looking at, so every failure must land on errorUri, never as a JSON error.
    let signedIn: Session;
    try {
      const { clientId, token } = await this.oauth2Client.exchangeAuthorizationCode({
        provider,
        code,
        pkce: cached.additionalParameters,
      });
      // Apple posts the user's name alongside the code, once: hand it to the provider with the token.
      const userInfo = await this.oauth2Client.getUserInfo({
        provider,
        clientId,
        token,
        response: user ? { user } : undefined,
      });
      mark('exchange_code');
      // The id token must carry the nonce this flow sent (stored with the state, not in KV: it
      // is bound to this session's request). A provider that gave no id token has nothing to
      // carry it, as has a request stored before nonces were sent.
      if (cached.nonce && token.id_token) {
        const { nonce } = userInfo.data as { nonce?: unknown };
        if (typeof nonce !== 'string' || !nonce) throw new AuthenticationError('NONCE_MISSING');
        if (nonce !== cached.nonce) throw new AuthenticationError('NONCE_MISMATCH');
        mark('check_nonce');
      }

      const principal = await handler(request, {
        provider,
        clientId,
        userInfo,
        token,
        attributes: cached.attributes ?? {},
      });
      mark('save_principal');

      signedIn = await this.signIn(principal, session);
      await this.repository.deleteById(session.getId());
      mark('update_session');
    } catch (error) {
      // The details stay in the logs: an OAuth2Error message can carry a client id or a
      // provider's response, which has no place in a URL the browser keeps in its history.
      if (error instanceof OAuth2Error) {
        console.warn('OAuth2 callback failed', error);
        const type = CALLBACK_ERROR_TYPES.has(error.error) ? error.error : 'server_error';
        return this.redirect(type, { params });
      }
      // A refusal is something the user can act on, so its reason and metadata reach the page,
      // as they reach a JSON client through the ErrorInfo.
      if (error instanceof AuthenticationError) {
        console.warn('OAuth2 sign-in refused', error.reason, error.metadata);
        return this.redirect('access_denied', { refusal: error, params });
      }
      console.error('OAuth2 callback failed', error);
      return this.redirect('server_error', { params });
    }

    const uri = withParams(this.oauth2Client.successUri, params);
    uri.searchParams.set('status', 'success');
    uri.searchParams.set('provider', provider);
    const response = new Response(null, { status: 302, headers: { location: uri.href } });
    setTiming(response);
    return this.withSession(response, signedIn);
  };

  /** The shared tail of the JSON login routes: the host's handler, then a signed-in session. */
  private async authorize(
    request: Request,
    handler: AuthorizedHandler,
    authorization: Authorization,
    setTiming: (response: Response) => void
  ): Promise<Response> {
    const principal = await handler(request, authorization);
    const session = await this.signIn(principal);
    const response = Response.json(principal);
    setTiming(response);
    return this.withSession(response, session);
  }

  loginOAuth2Native = (request: Request, handler: AuthorizedHandler): Promise<Response> =>
    this.guard(async () => {
      invariant(this.oauth2Client, 'oauth2Client is not initialized');
      const { mark, setTiming } = timing({ enabled: this.timing });
      const { provider } = param(request, PATH.LOGIN_OAUTH2_NATIVE);
      const body = await readJson(request);
      // Whatever the app sends besides its credentials for `onAuthorized` (a referral code, ...).
      const attributes = bodyAttributes(body);
      // Only the credentials go on to the provider client.
      const { attributes: _, ...credentials } = body as NativeCredential & { attributes?: unknown };
      const { code_verifier } = credentials as { code_verifier?: unknown };
      if (
        code_verifier !== undefined &&
        (typeof code_verifier !== 'string' || !CODE_VERIFIER_FORMAT.test(code_verifier))
      ) {
        throw invalidArgument(
          'INVALID_CODE_VERIFIER',
          'code_verifier must be 43-128 characters from [A-Za-z0-9-._~]'
        );
      }
      const { clientId, userInfo, token } = await this.oauth2Client.loginOAuth2Native({
        provider,
        credentials,
      });
      mark('login_oauth2_native');

      // Required when the provider's native id token echoes a nonce and the login produced one
      // (Facebook's access_token login has none to carry it).
      const required = (await this.oauth2Client.nonceSupport(provider)).native && !!token.id_token;
      if (await this.checkIssuedNonce(userInfo, provider, required)) mark('check_nonce');

      return this.authorize(
        request,
        handler,
        { provider, clientId, userInfo, token, attributes },
        setTiming
      );
    });

  loginOAuth2Onetap = (
    request: Request,
    handler: AuthorizedHandler,
    provider = 'google'
  ): Promise<Response> =>
    this.guard(async () => {
      invariant(this.oauth2Client, 'oauth2Client is not initialized');
      const { mark, setTiming } = timing({ enabled: this.timing });

      // Google's own form post, or an app's JSON.
      const contentType = request.headers.get('content-type') ?? '';
      const body = contentType.includes('application/json')
        ? await readJson(request)
        : await readForm(request);
      const { attributes = {}, ...parsed } = parse(oneTapBodySchema, body);

      // Both the credential and the code are issued to the provider's web client.
      let clientId: string;
      let token: Authorization['token'];
      let userInfo: Authorization['userInfo'];
      if (parsed.credential) {
        ({ clientId, token, userInfo } = await this.oauth2Client.getTokenInfo({
          provider,
          credential: parsed.credential,
        }));
        mark('verify_credential');

        // The credential must carry a single-use nonce from `oauth2Nonce`, which the front end
        // passed to `prompt`. This replaces Google's `g_csrf_token` double-submit cookie, which
        // FedCM mode no longer sets.
        const required = (await this.oauth2Client.nonceSupport(provider)).web;
        if (await this.checkIssuedNonce(userInfo, provider, required)) mark('check_nonce');
      } else if (parsed.code) {
        ({ clientId, token } = await this.oauth2Client.exchangeAuthorizationCode({
          provider,
          code: parsed.code,
        }));
        userInfo = await this.oauth2Client.getUserInfo({ provider, clientId, token });
      } else {
        throw invalidArgument('INVALID_ARGUMENT', 'credential or code is required');
      }

      return this.authorize(
        request,
        handler,
        { provider, clientId, userInfo, token, attributes },
        setTiming
      );
    });

  // ---- email -----------------------------------------------------------------------------------

  sendEmailVerificationCode = (request: Request, sender: EmailSender): Promise<Response> =>
    this.guard(async () => {
      invariant(this.turnstileSecretKey, 'turnstileSecretKey is not configured');
      const { email, turnstileToken } = parse(
        sendEmailVerificationCodeSchema,
        await readJson(request)
      );
      await verifyTurnstileToken(this.turnstileSecretKey, turnstileToken);
      await this.emailCodes.send(email, sender);
      return Response.json({});
    });

  verifyEmailCode = (email: string, verificationCode: string): Promise<void> =>
    this.emailCodes.verify(email, verificationCode);

  loginEmail = (request: Request, handler: AuthorizedHandler): Promise<Response> =>
    this.guard(async () => {
      const { setTiming } = timing({ enabled: this.timing });
      const {
        email,
        verificationCode,
        attributes = {},
      } = parse(loginEmailSchema, await readJson(request));
      await this.emailCodes.verify(email, verificationCode);
      const claims: StandardClaims = { sub: email, email, email_verified: true };
      return this.authorize(
        request,
        handler,
        { provider: 'EMAIL', userInfo: { claims, data: {} }, attributes },
        setTiming
      );
    });

  // ---- desktop ---------------------------------------------------------------------------------

  /**
   * Step 1 of the desktop / native app sign-in handshake. The caller already completed normal
   * sign-in on the web (so a cookie session exists); this issues a 5-minute single-use code that
   * the web page hands off to the desktop client via a loopback redirect.
   *
   * PKCE (RFC 7636, S256 only): the desktop generates a random `code_verifier` before opening the
   * browser, derives `code_challenge = base64url(sha256(verifier))`, and threads the challenge
   * through the URL → web page → here. The challenge is pinned to the code; `desktopExchange`
   * enforces that the caller knows the matching verifier. This blocks an attacker who only
   * intercepts the auth code (browser history, malicious extension, packet capture on loopback)
   * from exchanging it.
   *
   * Requires an authenticated cookie session: anonymous callers get 401. Throttling / abuse
   * protection on this endpoint is the API layer's job (rate-limit per principal); the SDK does
   * not gate it because the upstream sign-in flow already passed CAPTCHA / OAuth / verification.
   */
  desktopAuthorize = (request: Request): Promise<Response> =>
    this.guard(async () => {
      const principal = await this.getPrincipal(request);
      if (!principal) throw unauthenticated('Sign in first');
      const { code_challenge } = parse(desktopAuthorizeSchema, await readJson(request));
      const code = await this.desktopCodes.issue(principal, code_challenge);
      return Response.json({ code });
    });

  /**
   * Step 2 of the desktop / native app sign-in handshake. The desktop client hands back the auth
   * code it received via the loopback callback, and we mint a fresh session for it, independent
   * of the web cookie session that originally authorized the code, so logging out on either side
   * does not cascade to the other.
   *
   * Cookie attributes: `SameSite=None; Secure` so the cookie survives cross-site fetches from the
   * desktop renderer's `file://` / `app://` origin. The configured `cookieOptions` provide
   * everything else (`domain`, `path`, `httpOnly`); the override is targeted at the
   * SameSite/Secure pair only. In a non-HTTPS dev backend this combination is rejected by
   * Chromium, see the desktop sign-in PRD for workarounds.
   *
   * No CSRF check needed: the request carries no cookie, the auth code itself is the credential,
   * and the code's single-use removal blocks replay.
   */
  desktopExchange = (request: Request): Promise<Response> =>
    this.guard(async () => {
      const { code, code_verifier } = parse(desktopExchangeSchema, await readJson(request));
      const principal = await this.desktopCodes.redeem(code, code_verifier);
      const session = await this.signIn(principal);
      session.setAttribute('client_type', 'desktop');
      await this.repository.save(session);
      return this.withSession(Response.json({ ok: true }), session, {
        sameSite: 'none',
        secure: true,
      });
    });

  // ---- session management ----------------------------------------------------------------------

  kick = async (principal: Principal): Promise<void> => {
    const sessions = await this.repository.findByPrincipalName(principal.name);
    for (const sessionId of sessions.keys()) {
      await this.repository.deleteById(sessionId);
    }
  };

  /**
   * Sliding expiration: an authenticated request renews the session, as `logged` does, so a user
   * who keeps using the app is never signed out after `maxInactiveInterval` of not calling one
   * particular endpoint. No extra read: the session was just loaded to authenticate, and its
   * `lastAccessedTime` is compared in memory; writes are spaced by `session.touchInterval` (see
   * `AuthConfig`), so a session accessed again within the interval is not rewritten.
   */
  private async touch(session: Session) {
    const now = Date.now();
    if (now - session.getLastAccessedTime() < this.touchInterval) return;
    session.setLastAccessedTime(now);
    await this.repository.save(session);
  }

  getPrincipal = async (request: Request): Promise<Principal | null> => {
    const session = await this.loadSession(request);
    const principal = session && this.principalOf(session);
    if (!principal) return null;
    await this.touch(session);
    return principal;
  };

  isAuthenticated = async (request: Request): Promise<boolean> => {
    return (await this.getPrincipal(request)) !== null;
  };

  getSession = async <T extends boolean>(
    request: Request,
    create: T
  ): Promise<T extends true ? Session : Session | null> => {
    type Result = T extends true ? Session : Session | null;
    const session = await this.loadSession(request);
    if (session || !create) return session as Result;
    const created = this.repository.createSession();
    await this.repository.save(created);
    return created;
  };

  deleteSession = async (sessionId: string): Promise<void> => {
    await this.repository.deleteById(sessionId);
  };

  listSessions = async (principal: Principal): Promise<Session[]> => {
    const sessions = await this.repository.findByPrincipalName(principal.name);
    return Array.from(sessions.values());
  };

  cleanupExpiredSessions = async (cleanupCount?: number): Promise<Response> => {
    await this.repository.cleanupExpiredSessions(cleanupCount);
    return Response.json({});
  };
}
