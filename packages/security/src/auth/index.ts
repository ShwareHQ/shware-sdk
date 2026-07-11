import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { invariant } from '@shware/utils';
import { type Principal, Provider } from '../core/index';
import { loginEmailSchema, sendEmailVerificationCodeSchema } from '../email/schema';
import { OAuth2Client, googleOneTapSchema, oauth2RedirectQuerySchema } from '../oauth2/client';
import type { OAuth2ErrorType } from '../oauth2/error';
import { google } from '../oauth2/provider/index';
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
import { invalidArgument, valid, verifyTurnstileToken } from '../utils/valid';
import type { AuthConfig, AuthService, AuthorizedHandler, LoggedHandler } from './types';

// PKCE per RFC 7636: code_verifier / code_challenge are 43-128 chars from
// the unreserved set. We restrict to base64url (drops "." and "~") since
// that's what S256 produces and what callers should be sending; rejecting
// the rest shrinks the accepted input shape without losing legit clients.
// A 32-byte random verifier base64url-encodes to exactly 43 chars.
const PKCE_FORMAT = /^[A-Za-z0-9_-]{43,128}$/;

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

  OAUTH2_STATE: '/oauth2/state/:registrationId',
  OAUTH2_NONCE: '/oauth2/nonce/:registrationId',
  OAUTH2_AUTHORIZATION: '/oauth2/authorization/:registrationId',
  LOGIN_OAUTH2_CODE: '/login/oauth2/code/:registrationId',
  LOGIN_OAUTH2_NATIVE: '/login/oauth2/native/:registrationId',
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

export class Auth implements AuthService {
  private readonly timing: boolean;
  private readonly cookieName;
  private readonly cookieOptions: CookieOptions;
  private readonly kv: KVRepository;
  private readonly repository: SessionRepository;
  private readonly turnstileSecretKey?: string;
  private readonly oauth2Client: OAuth2Client | null;
  private readonly ATTR_OAUTH2_AUTHORIZATION_REQUEST = 'oauth2AuthorizationRequest';

  constructor({
    sessionRepository,
    kvRepository,
    turnstileSecretKey,
    oauth2,
    cookie,
    timing,
  }: AuthConfig) {
    this.timing = timing ?? false;
    this.kv = kvRepository;
    this.repository = sessionRepository;
    this.turnstileSecretKey = turnstileSecretKey;
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
    deleteCookie(response, this.cookieName);
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

  private getPhoneVerificationCodeKey(phone: string) {
    return `phone:verification:${phone}`;
  }

  private getDesktopCodeKey(code: string) {
    return `desktop:code:${code}`;
  }

  oauth2State = async (request: Request): Promise<Response> => {
    const { registrationId } = param(request, PATH.OAUTH2_STATE);
    const state = randomUUID();
    await this.kv.setItem(this.getOauth2StateKey(state), registrationId, 10 * 60);
    return Response.json({ state });
  };

  oauth2Nonce = async (request: Request): Promise<Response> => {
    const { registrationId } = param(request, PATH.OAUTH2_NONCE);
    const nonce = randomUUID();
    await this.kv.setItem(this.getOauth2NonceKey(nonce), registrationId, 10 * 60);
    return Response.json({ nonce });
  };

  oauth2Authorization = async (request: Request): Promise<Response> => {
    invariant(this.oauth2Client, 'oauth2Client is not initialized');
    const { mark, setTiming } = timing({ enabled: this.timing });
    const { registrationId } = param(request, PATH.OAUTH2_AUTHORIZATION);
    const state = randomUUID();
    const pkce = this.createPkceParameters();
    const uri = await this.oauth2Client.createAuthorizationUri({ registrationId, state, pkce });
    const sessionId = this.getSessionId(request);
    const session = sessionId
      ? ((await this.repository.findById(sessionId)) ?? this.repository.createSession())
      : this.repository.createSession();
    mark('fetch_session');

    const authorizationRequest: OAuth2AuthorizationRequest = {
      state,
      registrationId,
      authorizationRequestUri: uri.href,
      additionalParameters: pkce,
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

  private redirect = (error: OAuth2ErrorType, description?: string): Response => {
    invariant(this.oauth2Client, 'oauth2Client is not initialized');
    const uri = new URL(this.oauth2Client.errorUri);
    uri.searchParams.set('error', error);
    if (description) uri.searchParams.set('error_description', description);
    return Response.redirect(uri.href, 302);
  };

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
    const { registrationId } = param(request, PATH.LOGIN_OAUTH2_CODE);
    let data: Record<string, string>;
    // apple redirect: response_mode=form_post
    if (
      request.method === 'POST' &&
      request.headers.get('content-type')?.toLowerCase() === 'application/x-www-form-urlencoded'
    ) {
      const params = new URLSearchParams(await request.text());
      data = Object.fromEntries(params.entries());
    } else {
      data = query(request);
    }

    const parsed = oauth2RedirectQuerySchema.safeParse(data);
    if (!parsed.success) {
      return this.redirect('invalid_request', 'invalid redirect query');
    }
    if (!parsed.data.code || !parsed.data.state) {
      return this.redirect('invalid_request', 'invalid redirect query');
    }
    if (parsed.data.state !== cached.state) {
      return this.redirect('invalid_request', 'redirect state mismatch');
    }
    if (registrationId !== cached.registrationId) {
      return this.redirect('invalid_request', 'redirect registration mismatch');
    }
    mark('validate_session');

    // 4. exchange authorization code for token and get user info
    const { code } = parsed.data;

    const token = await this.oauth2Client.exchangeAuthorizationCode({
      registrationId,
      code,
      pkce: cached.additionalParameters,
    });
    const userInfo = await this.oauth2Client.getUserInfo({ registrationId, token });
    mark('exchange_code');

    // 5. create or update principal
    const principal = await handler(request, registrationId, userInfo, token);
    mark('save_principal');

    // 6. update session
    session.setLastAccessedTime(Date.now());
    session.removeAttribute(this.ATTR_OAUTH2_AUTHORIZATION_REQUEST);
    session.setAttribute(PRINCIPAL_NAME_INDEX_NAME, principal.name);
    await this.repository.save(session);
    mark('update_session');

    const uri = new URL(this.oauth2Client.successUri);
    uri.searchParams.set('status', 'success');
    uri.searchParams.set('registrationId', registrationId);

    const response = new Response(null, { status: 302, headers: { location: uri.href } });
    const maxAge = session.getMaxInactiveInterval();
    setCookie(response, this.cookieName, session.getId(), { ...this.cookieOptions, maxAge });
    setTiming(response);

    return response;
  };

  loginOAuth2Native = async (request: Request, handler: AuthorizedHandler): Promise<Response> => {
    invariant(this.oauth2Client, 'oauth2Client is not initialized');
    const { mark, setTiming } = timing({ enabled: this.timing });
    const { registrationId } = param(request, PATH.LOGIN_OAUTH2_NATIVE);
    const credentials = (await request.json()) as NativeCredential;
    const { userInfo, token } = await this.oauth2Client.loginOAuth2Native({
      registrationId,
      credentials,
    });
    mark('login_oauth2_native');

    const { nonce } = userInfo.data as { nonce?: string };
    if (nonce) {
      const value = await this.kv.getItem(this.getOauth2NonceKey(nonce));
      if (value !== registrationId) {
        const json = { error: 'invalid_request', error_description: 'nonce mismatch' };
        return Response.json(json, { status: 400 });
      }
      await this.kv.removeItem(this.getOauth2NonceKey(nonce));
      mark('check_nonce');
    }

    const principal = await handler(request, registrationId, userInfo, token);
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
    registrationId = 'google'
  ): Promise<Response> => {
    invariant(this.oauth2Client, 'oauth2Client is not initialized');
    const { mark, setTiming } = timing({ enabled: this.timing });

    // should support application/x-www-form-urlencoded and application/json
    let body: Record<string, string>;
    if (request.headers.get('Content-Type')?.includes('application/x-www-form-urlencoded')) {
      const text = await request.text();
      body = Object.fromEntries(new URLSearchParams(text));
    } else if (request.headers.get('Content-Type')?.includes('application/json')) {
      body = (await request.json()) as Record<string, string>;
    } else {
      const json = { error: 'invalid_request', error_description: 'invalid content type' };
      return Response.json(json, { status: 400 });
    }

    const parsed = googleOneTapSchema.parse(body);

    // csrf token is not supported in FedCM mode
    // const csrf_cookie = getCookie(request, 'g_csrf_token');
    // const csrf_request = parsed.g_csrf_token;
    // if (!csrf_request || csrf_cookie !== csrf_request) {
    //   const json = { error: 'invalid_request', error_description: 'invalid csrf token' };
    //   return Response.json(json, { status: 400 });
    // }

    let principal: Principal;
    if (parsed.credential) {
      const { token, userInfo } = await google.getTokenInfo(parsed.credential);
      principal = await handler(request, registrationId, userInfo, token);
    } else if (parsed.code) {
      const token = await this.oauth2Client.exchangeAuthorizationCode({
        registrationId,
        code: parsed.code,
      });
      const userInfo = await this.oauth2Client.getUserInfo({ registrationId, token });
      principal = await handler(request, registrationId, userInfo, token);
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

    try {
      const verificationCode = randomInt(1_000_000).toString().padStart(6, '0');
      await sender({ email, verificationCode });
      await this.kv.setItem(this.getEmailVerificationCodeKey(email), verificationCode, 10 * 60);
      return Response.json({});
    } catch (e) {
      console.error('Failed to send email verification code', e);
      return Response.json(invalidArgument('EMAIL_DELIVERY_FAILED'), { status: 400 });
    }
  };

  loginEmail = async (request: Request, handler: AuthorizedHandler): Promise<Response> => {
    const { data, error } = valid(loginEmailSchema, await request.json());
    if (error) return Response.json(error, { status: error.error.code });
    const { email, verificationCode } = data;

    const key = this.getEmailVerificationCodeKey(email);
    const stored = await this.kv.getItem(key);
    if (
      typeof stored !== 'string' ||
      stored.length !== verificationCode.length ||
      !timingSafeEqual(Buffer.from(stored), Buffer.from(verificationCode))
    ) {
      return Response.json(invalidArgument('INVALID_VERIFICATION_CODE'), { status: 400 });
    }
    await this.kv.removeItem(key);
    const claims: StandardClaims = { sub: email, email, email_verified: true };
    const principal = await handler(request, 'EMAIL', { claims, data: {} });

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

  isAuthenticated = async (request: Request): Promise<boolean> => {
    const sessionId = this.getSessionId(request);
    if (!sessionId) return false;
    const session = await this.repository.findById(sessionId);
    if (!session) return false;
    const principalName = session.getAttribute(PRINCIPAL_NAME_INDEX_NAME);
    if (!principalName) return false;
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
