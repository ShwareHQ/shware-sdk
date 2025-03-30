import { Hono } from 'hono';
import { setCookie, getCookie } from 'hono/cookie';
import { randomUUID } from 'crypto';
import { OAuth2Client } from '../oauth2/client';
import { PRINCIPAL_NAME_INDEX_NAME, type SessionRepository } from '../session';
import { oauth2RedirectQuerySchema } from '../oauth2/schema';
import type { Env, Context } from 'hono';
import type { CookieOptions } from 'hono/utils/cookie';
import type { Principal } from '../core';
import type {
  OAuth2Token,
  OAuth2ClientConfig,
  OAuth2AuthorizationRequest,
  StandardClaims,
} from '../oauth2/types';

type CookieConfig = Omit<CookieOptions, 'expires' | 'maxAge'> & { cookieName?: string };

export interface Config {
  cookie?: CookieConfig;
  sessionRepository: SessionRepository;
  oauth2: {
    client: OAuth2ClientConfig & {
      onAuthorized: (
        c: Context,
        registrationId: string,
        claims: StandardClaims,
        token: OAuth2Token
      ) => Principal | Promise<Principal>;
    };
  };
  onLoggedChecked?: (principal: Principal) => void | Promise<void>;
}

const OAUTH2_AUTHORIZATION_REQUEST_ATTR = 'oauth2AuthorizationRequest';

export function createAuthApp<E extends Env = Env>(
  app: Hono<E>,
  { sessionRepository: sessionRepository, ...config }: Config
) {
  const client = new OAuth2Client(config.oauth2.client);
  const { cookieName, ...cookieConfig }: CookieConfig = {
    cookieName: 'SESSION',
    path: '/',
    sameSite: 'None',
    secure: true,
    httpOnly: true,
    ...config.cookie,
  };

  app.get('/logged', async (c) => {
    const sessionId = getCookie(c, cookieName);
    if (!sessionId) return c.json({ data: false });
    const session = await sessionRepository.findById(sessionId);
    if (!session) return c.json({ data: false });

    // renew cookie
    setCookie(c, cookieName, session.getId(), {
      ...cookieConfig,
      maxAge: session.getMaxInactiveInterval(),
    });

    const name = session.getAttribute(PRINCIPAL_NAME_INDEX_NAME);
    session.setLastAccessedTime(Date.now());
    await sessionRepository.save(session);
    if (!name) return c.json({ data: false });

    await config.onLoggedChecked?.({ name: String(name) });
    return c.json({ data: true });
  });

  app.get('/oauth2/authorization/:registrationId', async (c) => {
    const registrationId = c.req.param('registrationId');
    const state = randomUUID();
    const codeVerifier = randomUUID();
    const uri = client.createAuthorizationUri(registrationId, state, codeVerifier);
    const sessionId = getCookie(c, cookieName);
    const session = sessionId
      ? ((await sessionRepository.findById(sessionId)) ?? sessionRepository.createSession())
      : sessionRepository.createSession();

    const authorizationRequest: OAuth2AuthorizationRequest = {
      state,
      codeVerifier,
      registrationId,
      authorizationRequestUri: uri.href,
    };

    session.setAttribute(OAUTH2_AUTHORIZATION_REQUEST_ATTR, JSON.stringify(authorizationRequest));
    await sessionRepository.save(session);

    setCookie(c, cookieName, session.getId(), {
      ...cookieConfig,
      maxAge: session.getMaxInactiveInterval(),
    });

    return c.redirect(uri.href, 302);
  });

  function redirect(c: Context, error: string) {
    return c.redirect(`${config.oauth2.client.errorUri}?error=${error}`, 302);
  }

  app.get('/login/oauth2/code/:registrationId', async (c) => {
    // 1. get session from cookie
    const sessionId = getCookie(c, cookieName);
    const session = sessionId ? await sessionRepository.findById(sessionId) : null;
    if (!session) {
      return redirect(c, 'OAUTH2_AUTHORIZATION_SESSION_NOT_FOUND');
    }

    // 2. get authorization request from session
    const json = session.getAttribute(OAUTH2_AUTHORIZATION_REQUEST_ATTR) as string | null;
    if (!json) {
      return redirect(c, 'OAUTH2_AUTHORIZATION_REQUEST_NOT_FOUND');
    }

    // 3. validate redirect query
    const cached: OAuth2AuthorizationRequest = JSON.parse(json);
    const registrationId = c.req.param('registrationId');

    const parsed = oauth2RedirectQuerySchema.safeParse(c.req.query());
    if (
      !parsed.success ||
      parsed.data.state !== cached.state ||
      registrationId !== cached.registrationId
    ) {
      return redirect(c, 'INVALID_OAUTH2_REDIRECT_QUERY');
    }

    // 4. exchange authorization code for token
    const { code } = parsed.data;
    const { codeVerifier } = cached;
    const token = await client.exchangeAuthorizationCode(registrationId, code, codeVerifier);
    const { claims } = await client.getUserInfo(registrationId, token);

    // 5. create or update principal
    const principal = await config.oauth2.client.onAuthorized(c, registrationId, claims, token);

    // 6. update session
    session.setLastAccessedTime(Date.now());
    session.removeAttribute(OAUTH2_AUTHORIZATION_REQUEST_ATTR);
    session.setAttribute(PRINCIPAL_NAME_INDEX_NAME, principal.name);
    await sessionRepository.save(session);

    setCookie(c, cookieName, session.getId(), {
      ...cookieConfig,
      maxAge: session.getMaxInactiveInterval(),
    });

    return c.redirect(config.oauth2.client.baseUri, 302);
  });
}
