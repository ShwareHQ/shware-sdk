import { Hono, Context } from 'hono';
import { setCookie, getCookie } from 'hono/cookie';
import { randomUUID } from 'crypto';
import { OAuth2 } from '../oauth2';
import { PRINCIPAL_NAME_INDEX_NAME, type SessionRepository } from '../session';
import type { OAuth2Config, OAuth2AuthorizationRequest } from '../oauth2';
import { CookieOptions } from 'hono/utils/cookie';
import type { Principal } from '../session/types';
import { OAuth2Token, StandardClaims } from '../client';

type Cookie = Omit<CookieOptions, 'expires' | 'maxAge'>;

export interface Config {
  cookie?: Cookie;
  repository: SessionRepository;
  oauth2: OAuth2Config;
  onLoggedChecked?: (principal: Principal) => void | Promise<void>;
  onAuthorized?: (
    c: Context,
    registrationId: string,
    claims: StandardClaims,
    token: OAuth2Token
  ) => void;
}

const SESSION_COOKIE_NAME = 'SESSION';
const OAUTH2_AUTHORIZATION_REQUEST_ATTR = 'oauth2AuthorizationRequest';
const defaultCookieOptions: Cookie = {
  path: '/',
  sameSite: 'None',
  secure: true,
  httpOnly: true,
};

export function createOAuth2App({ repository, ...config }: Config) {
  const app = new Hono();
  const oauth2 = new OAuth2(config.oauth2);

  app.get('/logged', async (c) => {
    const sessionId = getCookie(c, SESSION_COOKIE_NAME);
    if (!sessionId) return c.json({ data: false });
    const session = await repository.findById(sessionId);
    if (!session) return c.json({ data: false });

    // renew cookie
    setCookie(c, SESSION_COOKIE_NAME, session.getId(), {
      path: '/',
      sameSite: 'None',
      secure: true,
      httpOnly: true,
      maxAge: session.getMaxInactiveInterval(),
    });

    const name = session.getAttribute(PRINCIPAL_NAME_INDEX_NAME);
    session.setLastAccessedTime(Date.now());
    await repository.save(session);
    if (!name) return c.json({ data: false });

    await config.onLoggedChecked?.({ name: String(name) });
    return c.json({ data: true });
  });

  app.get('/oauth2/authorization/:registrationId', async (c) => {
    const registrationId = c.req.param('registrationId');
    const state = randomUUID();
    const codeVerifier = randomUUID();
    const uri = oauth2.createAuthorizationUri(registrationId, state, codeVerifier);
    const sessionId = getCookie(c, SESSION_COOKIE_NAME);
    const session = sessionId
      ? ((await repository.findById(sessionId)) ?? repository.createSession())
      : repository.createSession();

    const authorizationRequest: OAuth2AuthorizationRequest = {
      state,
      codeVerifier,
      registrationId,
      authorizationRequestUri: uri.href,
    };

    session.setAttribute(OAUTH2_AUTHORIZATION_REQUEST_ATTR, JSON.stringify(authorizationRequest));
    await repository.save(session);

    setCookie(c, SESSION_COOKIE_NAME, session.getId(), {
      ...defaultCookieOptions,
      ...config.cookie,
      maxAge: session.getMaxInactiveInterval(),
    });

    return c.redirect(uri.href, 302);
  });
}
