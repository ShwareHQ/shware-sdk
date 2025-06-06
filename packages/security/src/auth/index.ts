import { createHash, randomUUID } from 'crypto';
import invariant from 'tiny-invariant';
import { PRINCIPAL_NAME_INDEX_NAME } from '../session/common';
import { param, query, getCookie, setCookie, deleteCookie } from '../utils/http';
import { OAuth2Client, oauth2RedirectQuerySchema } from '../oauth2/client';
import { OAuth2ErrorType } from '../oauth2/error';
import { timing } from '../utils/timing';
import { google } from '../oauth2/provider/index';
import type { CookieOptions } from '../utils/http';
import type { KVRepository, Session, SessionRepository } from '../session/types';
import type { NativeCredential, OAuth2AuthorizationRequest, PkceParameters } from '../oauth2/types';
import type { AuthConfig, AuthService, LoggedHandler, OAuth2AuthorizedHandler } from './types';
import type { Principal } from '../core';

export class Auth implements AuthService {
  private readonly timing: boolean;
  private readonly cookieName;
  private readonly cookieOptions: CookieOptions;
  private readonly kv: KVRepository;
  private readonly repository: SessionRepository;

  private readonly oauth2Client: OAuth2Client | null;
  private readonly ATTR_OAUTH2_AUTHORIZATION_REQUEST = 'oauth2AuthorizationRequest';

  public readonly PATH_CSRF = '/csrf' as const;
  public readonly PATH_LOGOUT = '/logout' as const;
  public readonly PATH_LOGGED = '/logged' as const;

  public readonly PATH_OAUTH2_STATE = '/oauth2/state/:registrationId' as const;
  public readonly PATH_OAUTH2_NONCE = '/oauth2/nonce/:registrationId' as const;
  public readonly PATH_OAUTH2_AUTHORIZATION = '/oauth2/authorization/:registrationId' as const;
  public readonly PATH_LOGIN_OAUTH2_CODE = '/login/oauth2/code/:registrationId' as const;
  public readonly PATH_LOGIN_OAUTH2_NATIVE = '/login/oauth2/native/:registrationId' as const;
  public readonly PATH_LOGIN_OAUTH2_ONETAP = '/login/oauth2/onetap/google' as const;

  public readonly PATH_CLEANUP_EXPIRED_SESSIONS = '/sessions/expired/cleanup' as const;

  constructor({ sessionRepository, kvRepository, oauth2, cookie, timing }: AuthConfig) {
    this.timing = timing ?? false;
    this.kv = kvRepository;
    this.repository = sessionRepository;
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

  logout = async (request: Request): Promise<Response> => {
    const sessionId = getCookie(request, this.cookieName);
    if (sessionId) await this.repository.deleteById(sessionId);
    const response = Response.json({});
    deleteCookie(response, this.cookieName);
    return response;
  };

  logged = async (request: Request, onLogged?: LoggedHandler): Promise<Response> => {
    // 1. get session from cookie
    const sessionId = getCookie(request, this.cookieName);
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

  oauth2State = async (request: Request): Promise<Response> => {
    const { registrationId } = param(request, this.PATH_OAUTH2_STATE);
    const state = randomUUID();
    await this.kv.setItem(this.getOauth2StateKey(state), registrationId, 10 * 60);
    return Response.json({ state });
  };

  oauth2Nonce = async (request: Request): Promise<Response> => {
    const { registrationId } = param(request, this.PATH_OAUTH2_NONCE);
    const nonce = randomUUID();
    await this.kv.setItem(this.getOauth2NonceKey(nonce), registrationId, 10 * 60);
    return Response.json({ nonce });
  };

  oauth2Authorization = async (request: Request): Promise<Response> => {
    invariant(this.oauth2Client, 'oauth2Client is not initialized');
    const { mark, setTiming } = timing({ enabled: this.timing });
    const { registrationId } = param(request, this.PATH_OAUTH2_AUTHORIZATION);
    const state = randomUUID();
    const pkce = this.createPkceParameters();
    const uri = this.oauth2Client.createAuthorizationUri({ registrationId, state, pkce });
    const sessionId = getCookie(request, this.cookieName);
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

  loginOAuth2Code = async (
    request: Request,
    onAuthorized: OAuth2AuthorizedHandler
  ): Promise<Response> => {
    invariant(this.oauth2Client, 'oauth2Client is not initialized');
    const { mark, setTiming } = timing({ enabled: this.timing });

    // 1. get session from cookie
    const sessionId = getCookie(request, this.cookieName);
    const session = sessionId ? await this.repository.findById(sessionId) : null;
    if (!session) {
      return this.redirect('invalid_request', 'session not found');
    }
    mark('load_session');

    // 2. get cached authorization request from session
    const json = session.getAttribute(this.ATTR_OAUTH2_AUTHORIZATION_REQUEST) as string | null;
    if (!json) {
      return this.redirect('invalid_request', 'authorization request not  found');
    }
    const cached: OAuth2AuthorizationRequest = JSON.parse(json);

    // 3. validate redirect query/formdata
    const { registrationId } = param(request, this.PATH_LOGIN_OAUTH2_CODE);
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
    const principal = await onAuthorized(request, registrationId, userInfo, token);
    mark('save_principal');

    // 6. update session
    session.setLastAccessedTime(Date.now());
    session.removeAttribute(this.ATTR_OAUTH2_AUTHORIZATION_REQUEST);
    session.setAttribute(PRINCIPAL_NAME_INDEX_NAME, principal.name);
    await this.repository.save(session);
    mark('update_session');

    const response = new Response(null, {
      status: 302,
      headers: { location: this.oauth2Client.successUri },
    });
    const maxAge = session.getMaxInactiveInterval();
    setCookie(response, this.cookieName, session.getId(), { ...this.cookieOptions, maxAge });
    setTiming(response);

    return response;
  };

  loginOAuth2Native = async (
    request: Request,
    onAuthorized: OAuth2AuthorizedHandler
  ): Promise<Response> => {
    invariant(this.oauth2Client, 'oauth2Client is not initialized');
    const { mark, setTiming } = timing({ enabled: this.timing });
    const { registrationId } = param(request, this.PATH_LOGIN_OAUTH2_NATIVE);
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

    const principal = await onAuthorized(request, registrationId, userInfo, token);
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
    onAuthorized: OAuth2AuthorizedHandler
  ): Promise<Response> => {
    const { mark, setTiming } = timing({ enabled: this.timing });
    // should support application/x-www-form-urlencoded and application/json
    let body: Record<string, string>;
    if (request.headers.get('Content-Type') === 'application/x-www-form-urlencoded') {
      const text = await request.text();
      body = Object.fromEntries(new URLSearchParams(text));
    } else if (request.headers.get('Content-Type') === 'application/json') {
      body = (await request.json()) as Record<string, string>;
    } else {
      const json = { error: 'invalid_request', error_description: 'invalid content type' };
      return Response.json(json, { status: 400 });
    }

    const csrf_cookie = getCookie(request, 'g_csrf_token');
    if (csrf_cookie) {
      const csrf_request = body['g_csrf_token'];
      if (!csrf_request || csrf_cookie !== csrf_request) {
        const json = { error: 'invalid_request', error_description: 'invalid csrf token' };
        return Response.json(json, { status: 400 });
      }
    }
    const { token, userInfo } = await google.getTokenInfo(body['credential']);
    const principal = await onAuthorized(request, 'google', userInfo, token);
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

  kick = async (principal: Principal): Promise<void> => {
    const sessions = await this.repository.findByPrincipalName(principal.name);
    for (const sessionId of sessions.keys()) {
      await this.repository.deleteById(sessionId);
    }
  };

  isAuthenticated = async (request: Request): Promise<boolean> => {
    const sessionId = getCookie(request, this.cookieName);
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
    const sessionId = getCookie(request, this.cookieName);
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
    const sessionId = getCookie(request, this.cookieName);
    if (!sessionId) return null;
    const session = await this.repository.findById(sessionId);
    if (!session) return null;
    const name = session.getAttribute(PRINCIPAL_NAME_INDEX_NAME);
    if (!name) return null;
    return { name: String(name) };
  };

  cleanupExpiredSessions = async (cleanupCount?: number): Promise<Response> => {
    await this.repository.cleanupExpiredSessions(cleanupCount);
    return Response.json({});
  };
}
