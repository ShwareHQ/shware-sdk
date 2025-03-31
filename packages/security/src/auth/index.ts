import { randomUUID } from 'crypto';
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
import type { OAuth2AuthorizationRequest } from '../oauth2/types';
import type { AuthConfig, AuthService, LoggedHandler, OAuth2AuthorizedHandler } from './types';

export class Auth implements AuthService {
  private readonly cookieName;
  private readonly cookieOptions: CookieOptions;
  private readonly repository: SessionRepository;
  private readonly oauth2Client: OAuth2Client | null;

  public readonly PATH_CSRF = '/csrf' as const;
  public readonly PATH_LOGOUT = '/logout' as const;
  public readonly PATH_LOGGED = '/logged' as const;

  public readonly PATH_OAUTH2_AUTHORIZATION = '/oauth2/authorization/:registrationId' as const;
  public readonly PATH_OAUTH2_REDIRECT = '/login/oauth2/code/:registrationId' as const;

  public readonly ATTR_OAUTH2_AUTHORIZATION_REQUEST = 'oauth2AuthorizationRequest';

  constructor({ repository, oauth2, cookie }: AuthConfig) {
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

  oauth2Authorization = async (request: Request): Promise<Response> => {
    invariant(this.oauth2Client, 'oauth2Client is not initialized');
    const { registrationId } = param(request, this.PATH_OAUTH2_AUTHORIZATION);
    const state = randomUUID();
    const codeVerifier = randomUUID();
    const uri = this.oauth2Client.createAuthorizationUri(registrationId, state, codeVerifier);
    const sessionId = getCookie(request, this.cookieName);
    const session = sessionId
      ? ((await this.repository.findById(sessionId)) ?? this.repository.createSession())
      : this.repository.createSession();

    const authorizationRequest: OAuth2AuthorizationRequest = {
      state,
      codeVerifier,
      registrationId,
      authorizationRequestUri: uri.href,
    };

    const value = JSON.stringify(authorizationRequest);
    session.setAttribute(this.ATTR_OAUTH2_AUTHORIZATION_REQUEST, value);
    await this.repository.save(session);

    const response = new Response(null, { status: 302, headers: { location: uri.href } });
    const maxAge = session.getMaxInactiveInterval();
    setCookie(response, this.cookieName, session.getId(), { ...this.cookieOptions, maxAge });
    return response;
  };

  private redirect = (error: string): Response => {
    invariant(this.oauth2Client, 'oauth2Client is not initialized');
    return Response.redirect(`${this.oauth2Client.errorUri}?error=${error}`, 302);
  };

  loginOAuth2 = async (
    request: Request,
    onAuthorized: OAuth2AuthorizedHandler
  ): Promise<Response> => {
    invariant(this.oauth2Client, 'oauth2Client is not initialized');

    // 1. get session from cookie
    const sessionId = getCookie(request, this.cookieName);
    const session = sessionId ? await this.repository.findById(sessionId) : null;
    if (!session) {
      return this.redirect('OAUTH2_AUTHORIZATION_SESSION_NOT_FOUND');
    }

    // 2. get cached authorization request from session
    const json = session.getAttribute(this.ATTR_OAUTH2_AUTHORIZATION_REQUEST) as string | null;
    if (!json) {
      return this.redirect('OAUTH2_AUTHORIZATION_REQUEST_NOT_FOUND');
    }
    const cached: OAuth2AuthorizationRequest = JSON.parse(json);

    // 3. validate redirect query/formdata
    const { registrationId } = param(request, this.PATH_OAUTH2_REDIRECT);
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
      return this.redirect('INVALID_OAUTH2_REDIRECT_QUERY');
    }
    if (!parsed.data.code || !parsed.data.state) {
      console.error('oauth2 redirect error:', parsed.data);
      return this.redirect('OAUTH2_AUTHORIZATION_ERROR');
    }
    if (parsed.data.state !== cached.state) {
      return this.redirect('INVALID_OAUTH2_REDIRECT_STATE');
    }
    if (registrationId !== cached.registrationId) {
      return this.redirect('INVALID_OAUTH2_REDIRECT_REGISTRATION_ID');
    }

    // 4. exchange authorization code for token and get user info
    const { code } = parsed.data;
    const { codeVerifier } = cached;
    const token = await this.oauth2Client.exchangeAuthorizationCode(
      registrationId,
      code,
      codeVerifier
    );
    const userInfo = await this.oauth2Client.getUserInfo(registrationId, token);

    // 5. create or update principal
    const principal = await onAuthorized(request, registrationId, userInfo, token);

    // 6. update session
    session.setLastAccessedTime(Date.now());
    session.removeAttribute(this.ATTR_OAUTH2_AUTHORIZATION_REQUEST);
    session.setAttribute(PRINCIPAL_NAME_INDEX_NAME, principal.name);
    await this.repository.save(session);

    const response = new Response(null, {
      status: 302,
      headers: { location: this.oauth2Client.baseUri },
    });
    const maxAge = session.getMaxInactiveInterval();
    setCookie(response, this.cookieName, session.getId(), { ...this.cookieOptions, maxAge });
    return response;
  };
}
