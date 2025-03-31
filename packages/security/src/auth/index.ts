import { randomUUID } from 'crypto';
import { PRINCIPAL_NAME_INDEX_NAME, SessionRepository } from '../session';
import {
  param,
  query,
  getCookie,
  setCookie,
  deleteCookie,
  type CookieOptions,
} from '../utils/http';
import { OAuth2AuthorizationRequest, OAuth2Token, UserInfo } from '../oauth2/types';
import { OAuth2ClientConfig } from '../oauth2/types';
import { OAuth2Client, oauth2RedirectQuerySchema } from '../oauth2/client';
import type { Principal } from '../core';

export class Auth {
  private readonly cookieName: string = 'SESSION';
  private readonly cookieOptions: CookieOptions;
  private readonly repository: SessionRepository;
  private readonly oauth2Client: OAuth2Client;

  public readonly PATH_CSRF = '/csrf' as const;
  public readonly PATH_LOGOUT = '/logout' as const;
  public readonly PATH_LOGGED = '/logged' as const;

  public readonly PATH_OAUTH2_AUTHORIZATION = '/oauth2/authorization/:registrationId' as const;
  public readonly PATH_OAUTH2_REDIRECT = '/login/oauth2/code/:registrationId' as const;

  public readonly ATTR_OAUTH2_AUTHORIZATION_REQUEST = 'oauth2AuthorizationRequest';

  constructor(
    repository: SessionRepository,
    oauth2ClientConfig: OAuth2ClientConfig,
    cookieOptions?: CookieOptions
  ) {
    this.repository = repository;
    this.cookieOptions = {
      path: '/',
      sameSite: 'none',
      secure: true,
      httpOnly: true,
      ...cookieOptions,
    };
    this.oauth2Client = new OAuth2Client(oauth2ClientConfig);
  }

  logged = async (
    request: Request,
    onLogged?: (principal: Principal) => void | Promise<void>
  ): Promise<Response> => {
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

    const response = Response.redirect(uri.href, 302);
    const maxAge = session.getMaxInactiveInterval();
    setCookie(response, this.cookieName, session.getId(), { ...this.cookieOptions, maxAge });
    return response;
  };

  private redirect = (error: string): Response => {
    return Response.redirect(`${this.oauth2Client.errorUri}?error=${error}`, 302);
  };

  loginOAuth2 = async (
    request: Request,
    onAuthorized: (
      request: Request,
      registrationId: string,
      userInfo: UserInfo,
      token: OAuth2Token
    ) => Principal | Promise<Principal>
  ): Promise<Response> => {
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

    // 3. validate redirect query
    const { registrationId } = param(request, this.PATH_OAUTH2_REDIRECT);
    const parsed = oauth2RedirectQuerySchema.safeParse(query(request));
    if (!parsed.success) {
      return this.redirect('INVALID_OAUTH2_REDIRECT_QUERY');
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

    const response = Response.redirect(this.oauth2Client.baseUri, 302);
    const maxAge = session.getMaxInactiveInterval();
    setCookie(response, this.cookieName, session.getId(), { ...this.cookieOptions, maxAge });
    return response;
  };

  logout = async (request: Request): Promise<Response> => {
    const sessionId = getCookie(request, this.cookieName);
    if (sessionId) await this.repository.deleteById(sessionId);
    const response = Response.json({});
    deleteCookie(response, this.cookieName);
    return response;
  };
}
