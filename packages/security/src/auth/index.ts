import { createHash, randomUUID } from 'crypto';
import invariant from 'tiny-invariant';
import { PRINCIPAL_NAME_INDEX_NAME, type SessionRepository } from '../session/index';
import {
  param,
  query,
  getCookie,
  setCookie,
  deleteCookie,
  type CookieOptions,
} from '../utils/http';
import { OAuth2Client, oauth2RedirectQuerySchema } from '../oauth2/client';
import { OAuth2ErrorType } from '../oauth2/error';
import type {
  NativeCredentials,
  OAuth2AuthorizationRequest,
  PkceParameters,
} from '../oauth2/types';
import type {
  AuthConfig,
  AuthService,
  LoggedHandler,
  OAuth2AuthorizedHandler,
  OAuth2State,
} from './types';
import { timing } from '../utils/timing';

export class Auth implements AuthService {
  private readonly timing: boolean;

  private readonly cookieName;
  private readonly cookieOptions: CookieOptions;
  private readonly repository: SessionRepository;
  private readonly oauth2Client: OAuth2Client | null;
  private readonly ATTR_OAUTH2_AUTHORIZATION_REQUEST = 'oauth2AuthorizationRequest';

  public readonly PATH_CSRF = '/csrf' as const;
  public readonly PATH_LOGOUT = '/logout' as const;
  public readonly PATH_LOGGED = '/logged' as const;

  public readonly PATH_OAUTH2_STATE = '/oauth2/state/:registrationId' as const;
  public readonly PATH_OAUTH2_AUTHORIZATION = '/oauth2/authorization/:registrationId' as const;
  public readonly PATH_LOGIN_OAUTH2_CODE = '/login/oauth2/code/:registrationId' as const;
  public readonly PATH_LOGIN_OAUTH2_NATIVE = '/login/oauth2/native/:registrationId' as const;

  public readonly PATH_CLEANUP_EXPIRED_SESSIONS = '/sessions/expired/cleanup' as const;

  constructor({ repository, oauth2, cookie, timing }: AuthConfig) {
    this.timing = timing ?? false;
    this.repository = repository;
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

  oauth2State = async (request: Request): Promise<Response> => {
    const { registrationId } = param(request, this.PATH_OAUTH2_STATE);
    invariant(this.oauth2Client, 'oauth2Client is not initialized');
    const state = randomUUID();
    const nonce = randomUUID();
    const pkce = this.createPkceParameters();
    const value: OAuth2State = { state, nonce, registrationId, ...pkce };
    await this.repository.setItem(this.getOauth2StateKey(state), value, 10 * 60);
    return Response.json({
      state,
      nonce,
      code_challenge: pkce.code_challenge,
      code_challenge_method: pkce.code_challenge_method,
    });
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
    const credentials = (await request.json()) as NativeCredentials;
    const key = this.getOauth2StateKey(credentials.state);
    const cached = await this.repository.getItem<OAuth2State>(key);
    if (!cached) {
      const json = { error: 'invalid_request', error_description: 'oauth2 state not found' };
      return Response.json(json, { status: 400 });
    }
    if (cached.registrationId !== registrationId) {
      const json = { error: 'invalid_request', error_description: 'registration mismatch' };
      return Response.json(json, { status: 400 });
    }
    mark('validate_state');

    const pkce = {
      code_verifier: cached.code_verifier,
      code_challenge: cached.code_challenge,
      code_challenge_method: cached.code_challenge_method,
    };

    const { userInfo, token } = await this.oauth2Client.loginOAuth2Native({
      registrationId,
      credentials,
      pkce,
    });
    mark('login_oauth2_native');

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

  cleanupExpiredSessions = async (cleanupCount?: number): Promise<Response> => {
    await this.repository.cleanupExpiredSessions(cleanupCount);
    return Response.json({});
  };
}
