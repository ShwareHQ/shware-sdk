import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { invariant } from '@shware/utils';
import type { Principal } from '../core/index';
import { loginEmailSchema, sendEmailVerificationCodeSchema } from '../email/schema';
import { OAuth2Client, googleOneTapSchema, oauth2RedirectQuerySchema } from '../oauth2/client';
import {
  AuthenticationError,
  OAuth2Error,
  type OAuth2ErrorType,
  isKnownOAuth2ErrorType,
} from '../oauth2/error';
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
import {
  invalidArgument,
  permissionDenied,
  resourceExhausted,
  valid,
  verifyTurnstileToken,
} from '../utils/valid';
import { MAX_ATTRIBUTES_BYTES, attributesSize, bodyAttributes } from './attributes';
import type {
  AuthConfig,
  AuthService,
  Authorization,
  AuthorizedHandler,
  EmailCodeVerification,
  LoggedHandler,
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

const INVALID_CODE_VERIFIER = {
  error: 'invalid_request',
  error_description: 'code_verifier must be 43-128 characters from [A-Za-z0-9-._~]',
};

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

function authorizationAttributes(
  attributes: OAuth2AuthorizationOptions['attributes']
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
    `oauth2 authorization attributes are ${size} bytes, at most ${MAX_ATTRIBUTES_BYTES} allowed`
  );
  return defined;
}

/** Sign in with Apple answers with `response_mode=form_post`; a charset parameter may follow. */
const INVALID_ATTRIBUTES = {
  error: 'invalid_request',
  error_description: `attributes must map strings to strings, at most ${MAX_ATTRIBUTES_BYTES} bytes`,
};

function isFormPost(request: Request) {
  const contentType = request.headers.get('content-type')?.toLowerCase();
  return (
    request.method === 'POST' && !!contentType?.startsWith('application/x-www-form-urlencoded')
  );
}

interface DesktopCodeRecord {
  /** principal.name from the upstream cookie session */
  name: string;
  /** code_challenge (S256, base64url) — verifier must hash to this */
  cc: string;
}

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
  LOGIN_PHONE: '/login/phone',
  SEND_EMAIL_VERIFICATION_CODE: '/auth/sendEmailVerificationCode',
  SEND_PHONE_VERIFICATION_CODE: '/auth/sendPhoneVerificationCode',

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

/** Seconds an email verification code, and its attempt counter, stay valid. */
const EMAIL_VERIFICATION_CODE_TTL = 10 * 60;

export class Auth implements AuthService {
  private readonly timing: boolean;
  private readonly cookieName;
  private readonly cookieOptions: CookieOptions;
  private readonly kv: KVRepository;
  private readonly repository: SessionRepository;
  private readonly turnstileSecretKey?: string;
  private readonly maxVerificationAttempts: number;
  private readonly verificationResendCooldown: number;
  private readonly oauth2Client: OAuth2Client | null;
  private readonly onetapRequireNonce: boolean;
  private readonly touchInterval: number;
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
    this.maxVerificationAttempts = verificationCode?.maxAttempts ?? 5;
    this.verificationResendCooldown = verificationCode?.resendCooldown ?? 60;
    invariant(this.maxVerificationAttempts >= 1, 'verificationCode.maxAttempts must be at least 1');
    invariant(
      this.verificationResendCooldown >= 1,
      'verificationCode.resendCooldown must be at least 1 second'
    );
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
    this.onetapRequireNonce = oauth2?.onetap?.requireNonce ?? true;
    this.touchInterval = (session?.touchInterval ?? 3600) * 1000;
    invariant(this.touchInterval >= 0, 'session.touchInterval must not be negative');
  }

  private getSessionId(request: Request): string | undefined {
    let sessionId: string | undefined;
    const header = request.headers.get('Authorization');
    if (header?.startsWith('Bearer ')) {
      sessionId = header.replace('Bearer ', '');
    }
    if (!sessionId) {
      sessionId = getCookie(request, this.cookieName);
    }
    return sessionId;
  }

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

  logout = async (request: Request): Promise<Response> => {
    const sessionId = this.getSessionId(request);
    if (sessionId) await this.repository.deleteById(sessionId);
    const response = Response.json({});
    // A Set-Cookie only replaces the stored cookie when Domain and Path match (RFC 6265),
    // so clear it with the same attributes it was set with.
    deleteCookie(response, this.cookieName, this.cookieOptions);
    return response;
  };

  logged = async (request: Request, onLogged?: LoggedHandler): Promise<Response> => {
    // 1. get session from header or cookie
    const sessionId = this.getSessionId(request);
    if (!sessionId) return Response.json({ data: false });
    const session = await this.repository.findById(sessionId);
    if (!session) return Response.json({ data: false });

    // 2. get principal name from session
    const name = session.getAttribute(PRINCIPAL_NAME_INDEX_NAME);
    session.setLastAccessedTime(Date.now());
    await this.repository.save(session);

    // 3. call onLogged
    if (name !== null) await onLogged?.({ name: String(name) });

    // 4. renew cookie
    const response = Response.json({ data: name !== null });
    const maxAge = session.getMaxInactiveInterval();
    setCookie(response, this.cookieName, session.getId(), { ...this.cookieOptions, maxAge });
    return response;
  };

  private createPkceParameters(): PkceParameters {
    const code_verifier = randomUUID();
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

  private getEmailVerificationCodeKey(email: string) {
    return `email:verification:${email}`;
  }

  private getEmailVerificationAttemptsKey(email: string) {
    return `email:verification-attempts:${email}`;
  }

  private getEmailVerificationCooldownKey(email: string) {
    return `email:verification-cooldown:${email}`;
  }

  private getPhoneVerificationCodeKey(phone: string) {
    return `phone:verification:${phone}`;
  }

  private getDesktopCodeKey(code: string) {
    return `desktop:code:${code}`;
  }

  oauth2State = async (request: Request): Promise<Response> => {
    const { provider } = param(request, PATH.OAUTH2_STATE);
    const state = randomUUID();
    await this.kv.setItem(this.getOauth2StateKey(state), provider, 10 * 60);
    return Response.json({ state });
  };

  oauth2Nonce = async (request: Request): Promise<Response> => {
    const { provider } = param(request, PATH.OAUTH2_NONCE);
    const nonce = randomUUID();
    await this.kv.setItem(this.getOauth2NonceKey(nonce), provider, 10 * 60);
    return Response.json({ nonce });
  };

  oauth2Authorization = async (
    request: Request,
    options?: OAuth2AuthorizationOptions
  ): Promise<Response> => {
    invariant(this.oauth2Client, 'oauth2Client is not initialized');
    const attributes = authorizationAttributes(options?.attributes);
    const { mark, setTiming } = timing({ enabled: this.timing });
    const { provider } = param(request, PATH.OAUTH2_AUTHORIZATION);
    const state = randomUUID();
    const pkce = this.createPkceParameters();
    const uri = await this.oauth2Client.createAuthorizationUri({ provider, state, pkce });
    const sessionId = this.getSessionId(request);
    const session = sessionId
      ? ((await this.repository.findById(sessionId)) ?? this.repository.createSession())
      : this.repository.createSession();
    mark('fetch_session');

    const authorizationRequest: OAuth2AuthorizationRequest = {
      state,
      provider,
      authorizationRequestUri: uri.href,
      additionalParameters: pkce,
      ...(attributes ? { attributes } : {}),
    };

    const value = JSON.stringify(authorizationRequest);
    session.setAttribute(this.ATTR_OAUTH2_AUTHORIZATION_REQUEST, value);
    await this.repository.save(session);
    mark('save_session');

    const response = new Response(null, { status: 302, headers: { location: uri.href } });
    const maxAge = session.getMaxInactiveInterval();
    setCookie(response, this.cookieName, session.getId(), { ...this.cookieOptions, maxAge });
    setTiming(response);

    return response;
  };

  private readonly redirect = (
    error: OAuth2ErrorType,
    description?: string,
    refusal?: AuthenticationError
  ): Response => {
    invariant(this.oauth2Client, 'oauth2Client is not initialized');
    const base = new URL(this.oauth2Client.errorUri);
    const uri = new URL(base);
    // A refusal's metadata becomes parameters, but never at the expense of what the page reads the
    // outcome from: errorUri's own parameters (`status=error`) are re-applied over it, then the
    // error and the reason.
    for (const [key, value] of Object.entries(refusal?.metadata ?? {})) {
      uri.searchParams.set(key, value);
    }
    for (const [key, value] of base.searchParams) uri.searchParams.set(key, value);
    uri.searchParams.set('error', error);
    if (description) {
      uri.searchParams.set('error_description', description.slice(0, MAX_ERROR_DESCRIPTION_LENGTH));
    }
    if (refusal) uri.searchParams.set('reason', refusal.reason);
    return Response.redirect(uri.href, 302);
  };

  /**
   * The host's `onAuthorized`, with its one expected failure handled: an `AuthenticationError` is
   * the refusal the JSON login routes answer with 403 and the reason the clients act on. Anything
   * else propagates as the 500 it is.
   */
  private async authorize(
    handler: AuthorizedHandler,
    request: Request,
    authorization: Authorization
  ): Promise<Principal | Response> {
    try {
      return await handler(request, authorization);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        console.warn('Sign-in refused', { reason: error.reason, metadata: error.metadata });
        const body = permissionDenied(error.reason, error.metadata);
        return Response.json(body, { status: body.error.code });
      }
      throw error;
    }
  }

  loginOAuth2Code = async (request: Request, handler: AuthorizedHandler): Promise<Response> => {
    invariant(this.oauth2Client, 'oauth2Client is not initialized');
    const { mark, setTiming } = timing({ enabled: this.timing });

    // 1. get session from header or cookie
    const sessionId = this.getSessionId(request);
    const session = sessionId ? await this.repository.findById(sessionId) : null;
    if (!session) {
      return this.redirect('invalid_request', 'session not found');
    }
    mark('load_session');

    // 2. get cached authorization request from session
    const json = session.getAttribute(this.ATTR_OAUTH2_AUTHORIZATION_REQUEST) as string | null;
    if (!json) {
      return this.redirect('invalid_request', 'authorization request not found');
    }
    const cached: OAuth2AuthorizationRequest = JSON.parse(json);

    // 3. validate redirect query/formdata
    const { provider } = param(request, PATH.LOGIN_OAUTH2_CODE);
    let data: Record<string, string>;
    // apple redirect: response_mode=form_post
    if (isFormPost(request)) {
      const params = new URLSearchParams(await request.text());
      data = Object.fromEntries(params.entries());
    } else {
      data = query(request);
    }

    const parsed = oauth2RedirectQuerySchema.safeParse(data);
    if (!parsed.success) {
      return this.redirect('invalid_request', 'invalid redirect query');
    }
    // The provider answered with an error instead of a code (the user pressed Cancel →
    // access_denied, invalid_scope, server_error, ...). Forward it rather than reporting a
    // malformed query. This runs before the state check on purpose: providers echo state on
    // error responses, but not all reliably do, and a forged error callback can only make the
    // victim's popup show an error — nothing is exchanged or signed in. A present state that does
    // not match still wins, since that is the more accurate (and more alarming) diagnosis.
    if (parsed.data.error) {
      if (parsed.data.state && parsed.data.state !== cached.state) {
        return this.redirect('invalid_request', 'redirect state mismatch');
      }
      return this.redirect(
        safeErrorType(parsed.data.error, 'server_error'),
        parsed.data.error_description
      );
    }
    if (!parsed.data.code || !parsed.data.state) {
      return this.redirect('invalid_request', 'invalid redirect query');
    }
    if (parsed.data.state !== cached.state) {
      return this.redirect('invalid_request', 'redirect state mismatch');
    }
    if (provider !== cached.provider) {
      return this.redirect('invalid_request', 'redirect provider mismatch');
    }
    mark('validate_session');

    // 4. exchange authorization code for token and get user info
    const { code, user } = parsed.data;

    // Everything past validation can fail (an expired or reused code, a network error, the host's
    // handler or session store). The callback runs in a popup the user is looking at, so every
    // failure must land on errorUri instead of surfacing as a raw JSON error response.
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

      // 5. create or update principal, with what the host attached when the flow started
      const principal = await handler(request, {
        provider,
        clientId,
        userInfo,
        token,
        attributes: cached.attributes ?? {},
      });
      mark('save_principal');

      // 6. sign in on a new session: the id the browser brought may have been planted by an
      // attacker who started the flow (session fixation), so it must not become authenticated.
      signedIn = this.signedInSession(session, principal.name);
      await this.repository.save(signedIn);
      await this.repository.deleteById(session.getId());
      mark('update_session');
    } catch (error) {
      // The details stay in the logs: an OAuth2Error message can carry a client id or a
      // provider's response, which has no place in a URL the browser keeps in its history.
      if (error instanceof OAuth2Error) {
        console.warn('OAuth2 callback failed', error);
        const type = CALLBACK_ERROR_TYPES.has(error.error) ? error.error : 'server_error';
        return this.redirect(type);
      }
      // A refusal the host's handler made on purpose is something the user can act on, so its
      // reason reaches the page like the JSON routes' 403 does: `error=access_denied`, `reason`,
      // and the metadata entries as parameters.
      if (error instanceof AuthenticationError) {
        console.warn('OAuth2 sign-in refused', { reason: error.reason, metadata: error.metadata });
        return this.redirect('access_denied', undefined, error);
      }
      console.error('OAuth2 callback failed', error);
      return this.redirect('server_error');
    }

    const uri = new URL(this.oauth2Client.successUri);
    uri.searchParams.set('status', 'success');
    uri.searchParams.set('provider', provider);

    const response = new Response(null, { status: 302, headers: { location: uri.href } });
    const maxAge = signedIn.getMaxInactiveInterval();
    setCookie(response, this.cookieName, signedIn.getId(), { ...this.cookieOptions, maxAge });
    setTiming(response);

    return response;
  };

  /**
   * A fresh session for `name`, carrying over what the host kept in the pre-login one. The
   * authorization request (state, PKCE verifier, flow attributes) is single-use and was consumed
   * by this callback, and a principal left there from an earlier sign-in is replaced.
   */
  private signedInSession(previous: Session, name: string): Session {
    const session = this.repository.createSession();
    for (const attribute of previous.getAttributeNames()) {
      if (attribute === this.ATTR_OAUTH2_AUTHORIZATION_REQUEST) continue;
      if (attribute === PRINCIPAL_NAME_INDEX_NAME) continue;
      const value = previous.getAttribute(attribute);
      if (value !== null) session.setAttribute(attribute, value);
    }
    session.setAttribute(PRINCIPAL_NAME_INDEX_NAME, name);
    return session;
  }

  loginOAuth2Native = async (request: Request, handler: AuthorizedHandler): Promise<Response> => {
    invariant(this.oauth2Client, 'oauth2Client is not initialized');
    const { mark, setTiming } = timing({ enabled: this.timing });
    const { provider } = param(request, PATH.LOGIN_OAUTH2_NATIVE);
    const body: unknown = await request.json();
    // Whatever the app sends besides its credentials for `onAuthorized` (a referral code, ...).
    const attributes = bodyAttributes(body);
    if (!attributes) return Response.json(INVALID_ATTRIBUTES, { status: 400 });
    // Only the credentials go on to the provider client.
    const { attributes: _, ...credentials } = body as NativeCredential & { attributes?: unknown };
    const { code_verifier } = credentials as { code_verifier?: unknown };
    if (
      code_verifier !== undefined &&
      (typeof code_verifier !== 'string' || !CODE_VERIFIER_FORMAT.test(code_verifier))
    ) {
      return Response.json(INVALID_CODE_VERIFIER, { status: 400 });
    }
    const { clientId, userInfo, token } = await this.oauth2Client.loginOAuth2Native({
      provider,
      credentials,
    });
    mark('login_oauth2_native');

    const { nonce } = userInfo.data as { nonce?: string };
    if (nonce) {
      const value = await this.kv.getItem(this.getOauth2NonceKey(nonce));
      if (value !== provider) {
        const json = { error: 'invalid_request', error_description: 'nonce mismatch' };
        return Response.json(json, { status: 400 });
      }
      await this.kv.removeItem(this.getOauth2NonceKey(nonce));
      mark('check_nonce');
    }

    const principal = await this.authorize(handler, request, {
      provider,
      clientId,
      userInfo,
      token,
      attributes,
    });
    if (principal instanceof Response) return principal;
    mark('save_principal');

    const session = this.repository.createSession();
    session.setAttribute(PRINCIPAL_NAME_INDEX_NAME, principal.name);
    await this.repository.save(session);
    const response = new Response(JSON.stringify(principal), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const maxAge = session.getMaxInactiveInterval();
    setCookie(response, this.cookieName, session.getId(), { ...this.cookieOptions, maxAge });
    setTiming(response);

    return response;
  };

  loginOAuth2Onetap = async (
    request: Request,
    handler: AuthorizedHandler,
    provider = 'google'
  ): Promise<Response> => {
    invariant(this.oauth2Client, 'oauth2Client is not initialized');
    const { mark, setTiming } = timing({ enabled: this.timing });

    // should support application/x-www-form-urlencoded and application/json
    // Google's own form post carries no attributes; an app posting JSON may add them.
    let body: Record<string, string>;
    let attributes: Record<string, string> | null = {};
    if (request.headers.get('Content-Type')?.includes('application/x-www-form-urlencoded')) {
      const text = await request.text();
      body = Object.fromEntries(new URLSearchParams(text));
    } else if (request.headers.get('Content-Type')?.includes('application/json')) {
      const json: unknown = await request.json();
      attributes = bodyAttributes(json);
      body = json as Record<string, string>;
    } else {
      const json = { error: 'invalid_request', error_description: 'invalid content type' };
      return Response.json(json, { status: 400 });
    }

    if (!attributes) return Response.json(INVALID_ATTRIBUTES, { status: 400 });
    const parsed = googleOneTapSchema.parse(body);

    // Both the credential and the code are issued to the provider's web client.
    let principal: Principal;
    if (parsed.credential) {
      const { clientId, token, userInfo } = await this.oauth2Client.getTokenInfo({
        provider,
        credential: parsed.credential,
      });
      mark('verify_credential');

      // A credential is replayable until it expires, so it must carry a single-use nonce from
      // `oauth2Nonce`, which the front end passed to `prompt`. This replaces Google's
      // `g_csrf_token` double-submit cookie, which FedCM mode no longer sets.
      const { nonce } = userInfo.data as { nonce?: unknown };
      if (typeof nonce === 'string' && nonce) {
        const value = await this.kv.getItem(this.getOauth2NonceKey(nonce));
        if (value !== provider) {
          const json = { error: 'invalid_request', error_description: 'nonce mismatch' };
          return Response.json(json, { status: 401 });
        }
        await this.kv.removeItem(this.getOauth2NonceKey(nonce));
        mark('check_nonce');
      } else if (this.onetapRequireNonce) {
        const json = { error: 'invalid_request', error_description: 'nonce missing' };
        return Response.json(json, { status: 401 });
      }

      const result = await this.authorize(handler, request, {
        provider,
        clientId,
        userInfo,
        token,
        attributes,
      });
      if (result instanceof Response) return result;
      principal = result;
    } else if (parsed.code) {
      const { clientId, token } = await this.oauth2Client.exchangeAuthorizationCode({
        provider,
        code: parsed.code,
      });
      const userInfo = await this.oauth2Client.getUserInfo({ provider, clientId, token });
      const result = await this.authorize(handler, request, {
        provider,
        clientId,
        userInfo,
        token,
        attributes,
      });
      if (result instanceof Response) return result;
      principal = result;
    } else {
      throw new Error('invalid request');
    }

    mark('save_principal');

    const session = this.repository.createSession();
    session.setAttribute(PRINCIPAL_NAME_INDEX_NAME, principal.name);
    await this.repository.save(session);
    const response = new Response(JSON.stringify(principal), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const maxAge = session.getMaxInactiveInterval();
    setCookie(response, this.cookieName, session.getId(), { ...this.cookieOptions, maxAge });
    setTiming(response);

    return response;
  };

  sendEmailVerificationCode = async (
    request: Request,
    sender: (data: { email: string; verificationCode: string }) => Promise<void>
  ): Promise<Response> => {
    invariant(this.turnstileSecretKey, 'turnstileSecretKey is not configured');

    const { data, error } = valid(sendEmailVerificationCodeSchema, await request.json());
    if (error) return Response.json(error, { status: error.error.code });
    const { email, turnstileToken } = data;

    const result = await verifyTurnstileToken(this.turnstileSecretKey, turnstileToken);
    if (result.error) return Response.json(result.error, { status: result.error.error.code });

    // The cooldown is claimed before sending, so of concurrent requests exactly one sends. A failed
    // delivery releases it again: no code was stored, so an immediate retry gains an attacker
    // nothing, while keeping it would lock the user out of signing in for the whole cooldown.
    const cooldownKey = this.getEmailVerificationCooldownKey(email);
    if ((await this.kv.increment(cooldownKey, this.verificationResendCooldown)) > 1) {
      const error = resourceExhausted(
        'VERIFICATION_CODE_RESEND_TOO_SOON',
        'Verification code was sent recently'
      );
      return Response.json(error, { status: error.error.code });
    }

    try {
      // Sent before it is stored, so a failed delivery leaves the previous code usable.
      const verificationCode = randomInt(1_000_000).toString().padStart(6, '0');
      await sender({ email, verificationCode });
      // The new code gets the full attempt budget; the cooldown bounds how often that happens.
      // Reset before storing, so every comparison against the new code is counted.
      await this.kv.removeItem(this.getEmailVerificationAttemptsKey(email));
      await this.kv.setItem(
        this.getEmailVerificationCodeKey(email),
        verificationCode,
        EMAIL_VERIFICATION_CODE_TTL
      );
      return Response.json({});
    } catch (e) {
      console.error('Failed to send email verification code', e);
      await this.kv.removeItem(cooldownKey);
      return Response.json(invalidArgument('EMAIL_DELIVERY_FAILED'), { status: 400 });
    }
  };

  /**
   * Checks a code `sendEmailVerificationCode` mailed to `email` without signing anyone in, for a
   * host flow that only needs proof of the address (verifying or changing a signed-in user's
   * email). Same rules and storage as `loginEmail`, which calls it: a code is single-use, lives
   * `EMAIL_VERIFICATION_CODE_TTL` seconds, and is discarded after `verificationCode.maxAttempts`
   * wrong guesses. A verified code is consumed, so it cannot be used to sign in afterwards.
   */
  verifyEmailCode = async (
    email: string,
    verificationCode: string
  ): Promise<EmailCodeVerification> => {
    const key = this.getEmailVerificationCodeKey(email);
    const attemptsKey = this.getEmailVerificationAttemptsKey(email);
    const stored = await this.kv.getItem(key);
    if (typeof stored !== 'string') return { ok: false, error: 'INVALID_VERIFICATION_CODE' };

    // Count the attempt before comparing: the atomic increment hands every request, parallel ones
    // included, a distinct count, so at most maxAttempts comparisons are ever made against a code.
    const attempts = await this.kv.increment(attemptsKey, EMAIL_VERIFICATION_CODE_TTL);
    if (attempts > this.maxVerificationAttempts) {
      // Only the code is discarded. The counter stays until it expires (or a new code is sent):
      // removing it would hand requests that already read the code a fresh budget.
      await this.kv.removeItem(key);
      return { ok: false, error: 'VERIFICATION_CODE_ATTEMPTS_EXCEEDED' };
    }
    if (
      stored.length !== verificationCode.length ||
      !timingSafeEqual(Buffer.from(stored), Buffer.from(verificationCode))
    ) {
      return { ok: false, error: 'INVALID_VERIFICATION_CODE' };
    }
    await this.kv.removeItem(key);
    await this.kv.removeItem(attemptsKey);
    return { ok: true };
  };

  loginEmail = async (request: Request, handler: AuthorizedHandler): Promise<Response> => {
    const { data, error } = valid(loginEmailSchema, await request.json());
    if (error) return Response.json(error, { status: error.error.code });
    const { email, verificationCode, attributes } = data;

    const verified = await this.verifyEmailCode(email, verificationCode);
    if (!verified.ok) {
      const failure = invalidArgument(verified.error);
      return Response.json(failure, { status: failure.error.code });
    }
    const claims: StandardClaims = { sub: email, email, email_verified: true };
    const principal = await this.authorize(handler, request, {
      provider: 'EMAIL',
      userInfo: { claims, data: {} },
      attributes: attributes ?? {},
    });
    if (principal instanceof Response) return principal;

    // save session
    const session = this.repository.createSession();
    session.setAttribute(PRINCIPAL_NAME_INDEX_NAME, principal.name);
    await this.repository.save(session);
    const response = new Response(JSON.stringify(principal), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const maxAge = session.getMaxInactiveInterval();
    setCookie(response, this.cookieName, session.getId(), { ...this.cookieOptions, maxAge });

    return response;
  };

  /**
   * Step 1 of the desktop / native app sign-in handshake. The caller already
   * completed normal sign-in on the web (so a cookie session exists); this
   * issues a 5-minute single-use code that the web page hands off to the
   * desktop client via a loopback redirect.
   *
   * PKCE (RFC 7636, S256 only): the desktop generates a random `code_verifier`
   * before opening the browser, derives `code_challenge = base64url(sha256(verifier))`,
   * and threads the challenge through the URL → web page → here. We pin
   * the challenge to the code in KV; `desktopExchange` enforces that the
   * caller knows the matching verifier. This blocks an attacker who only
   * intercepts the auth code (browser history, malicious extension, packet
   * capture on loopback) from exchanging it.
   *
   * Requires an authenticated cookie session — anonymous callers get 401.
   * Throttling / abuse protection on this endpoint is the API layer's job
   * (rate-limit per principal); the SDK doesn't gate it because the
   * upstream sign-in flow already passed CAPTCHA / OAuth / verification.
   */
  desktopAuthorize = async (request: Request): Promise<Response> => {
    const principal = await this.getPrincipal(request);
    if (!principal) {
      const body = {
        error: {
          code: 401,
          status: 'UNAUTHENTICATED',
          message: 'sign in first',
          details: [],
        },
      };
      return Response.json(body, { status: 401 });
    }

    let body: { code_challenge?: unknown; code_challenge_method?: unknown };
    try {
      body = (await request.json()) as {
        code_challenge?: unknown;
        code_challenge_method?: unknown;
      };
    } catch {
      return Response.json(invalidArgument('INVALID_ARGUMENT'), { status: 400 });
    }

    const codeChallenge = typeof body.code_challenge === 'string' ? body.code_challenge : null;
    if (
      !codeChallenge ||
      body.code_challenge_method !== 'S256' ||
      !PKCE_FORMAT.test(codeChallenge)
    ) {
      return Response.json(invalidArgument('INVALID_ARGUMENT'), { status: 400 });
    }

    const code = randomUUID();
    const record: DesktopCodeRecord = { name: principal.name, cc: codeChallenge };
    await this.kv.setItem(this.getDesktopCodeKey(code), JSON.stringify(record), 5 * 60);

    return Response.json({ code });
  };

  /**
   * Step 2 of the desktop / native app sign-in handshake. The desktop
   * client hands back the auth code it received via the loopback callback,
   * and we mint a fresh session for it — independent of the web cookie
   * session that originally `authorize`'d the code, so logging out on
   * either side doesn't cascade to the other.
   *
   * Cookie attributes: defaults to `SameSite=None; Secure` so the cookie
   * survives cross-site fetches from the desktop renderer's `file://` /
   * `app://` origin. The configured base `cookieOptions` provide
   * everything else (`domain`, `path`, `httpOnly`, `maxAge`); the override
   * is targeted at the SameSite/Secure pair only. In a non-HTTPS dev
   * backend this combination is rejected by Chromium — see the desktop
   * sign-in PRD for workarounds.
   *
   * No CSRF check needed — the request carries no cookie, the auth code
   * itself is the credential, and KV's single-use removal blocks replay.
   */
  desktopExchange = async (request: Request): Promise<Response> => {
    let body: { code?: unknown; code_verifier?: unknown };
    try {
      body = (await request.json()) as { code?: unknown; code_verifier?: unknown };
    } catch {
      return Response.json(invalidArgument('INVALID_ARGUMENT'), { status: 400 });
    }

    const code = typeof body.code === 'string' ? body.code : null;
    const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : null;
    if (!code || !verifier || !PKCE_FORMAT.test(verifier)) {
      return Response.json(invalidArgument('INVALID_ARGUMENT'), { status: 400 });
    }

    const key = this.getDesktopCodeKey(code);
    const raw = await this.kv.getItem(key);
    if (typeof raw !== 'string') {
      return Response.json(invalidArgument('INVALID_DESKTOP_CODE'), { status: 400 });
    }
    let record: DesktopCodeRecord;
    try {
      record = JSON.parse(raw) as DesktopCodeRecord;
    } catch {
      // Malformed KV record (shouldn't happen with our own writes) — drop it
      // and surface as an invalid code; the caller can retry the whole flow.
      await this.kv.removeItem(key);
      return Response.json(invalidArgument('INVALID_DESKTOP_CODE'), { status: 400 });
    }

    // Verify PKCE: base64url(sha256(verifier)) === stored challenge.
    // Don't burn the code on a verifier mismatch — that would let an
    // attacker who races a network retry brick a legit exchange. The code
    // is single-use on success and 5-min TTL bounded; brute-forcing the
    // 256-bit verifier in that window is infeasible.
    const computed = createHash('sha256').update(verifier).digest();
    const stored = Buffer.from(record.cc, 'base64url');
    if (stored.length !== computed.length || !timingSafeEqual(computed, stored)) {
      return Response.json(invalidArgument('INVALID_DESKTOP_CODE'), { status: 400 });
    }

    // One-time use: remove BEFORE creating the session so a concurrent
    // duplicate exchange (e.g. retry after timeout) sees the code as
    // consumed even if our session save races it.
    await this.kv.removeItem(key);

    const session = this.repository.createSession();
    session.setAttribute(PRINCIPAL_NAME_INDEX_NAME, record.name);
    session.setAttribute('client_type', 'desktop');
    await this.repository.save(session);

    const response = Response.json({ ok: true });
    const maxAge = session.getMaxInactiveInterval();
    setCookie(response, this.cookieName, session.getId(), {
      ...this.cookieOptions,
      // Override sameSite/secure for desktop: the renderer's origin
      // (file:// / app://) is cross-site to the API, so SameSite=Lax/Strict
      // would block the cookie on subsequent fetches.
      sameSite: 'none',
      secure: true,
      maxAge,
    });
    return response;
  };

  sendPhoneVerificationCode = async (
    _request: Request,
    _sender: (data: { phone: string; verificationCode: string }) => Promise<void>
  ): Promise<Response> => {
    return Response.json({ error: 'not_implemented' }, { status: 501 });
  };

  loginPhone = async (_request: Request, _handler: AuthorizedHandler): Promise<Response> => {
    return Response.json({ error: 'not_implemented' }, { status: 501 });
  };

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

  isAuthenticated = async (request: Request): Promise<boolean> => {
    const sessionId = this.getSessionId(request);
    if (!sessionId) return false;
    const session = await this.repository.findById(sessionId);
    if (!session) return false;
    const principalName = session.getAttribute(PRINCIPAL_NAME_INDEX_NAME);
    if (!principalName) return false;
    await this.touch(session);
    return true;
  };

  getSession = async <T extends boolean>(
    request: Request,
    create: T
  ): Promise<T extends true ? Session : Session | null> => {
    const sessionId = this.getSessionId(request);
    if (!sessionId) {
      if (create) {
        const session = this.repository.createSession();
        await this.repository.save(session);
        return session;
      } else {
        return null as T extends true ? Session : Session | null;
      }
    }
    const session = await this.repository.findById(sessionId);
    if (!session) {
      if (create) {
        const session = this.repository.createSession();
        await this.repository.save(session);
        return session;
      } else {
        return null as T extends true ? Session : Session | null;
      }
    }
    return session;
  };

  deleteSession = async (sessionId: string): Promise<void> => {
    await this.repository.deleteById(sessionId);
  };

  getPrincipal = async (request: Request): Promise<Principal | null> => {
    const sessionId = this.getSessionId(request);
    if (!sessionId) return null;
    const session = await this.repository.findById(sessionId);
    if (!session) return null;
    const name = session.getAttribute(PRINCIPAL_NAME_INDEX_NAME);
    if (!name) return null;
    await this.touch(session);
    return { name: String(name) };
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
