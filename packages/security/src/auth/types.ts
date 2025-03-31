import { Principal } from '../core';
import { OAuth2ClientConfig, UserInfo } from '../oauth2/types';
import { OAuth2Token } from '../oauth2/types';
import { SessionRepository } from '../session';
import { CookieOptions } from '../utils/http';

export type LoggedHandler = (principal: Principal) => Promise<void>;
export type OAuth2AuthorizedHandler = (
  request: Request,
  registrationId: string,
  userInfo: UserInfo,
  token: OAuth2Token
) => Promise<Principal>;

export interface AuthConfig {
  repository: SessionRepository;
  cookie?: CookieOptions & { name?: string };
  oauth2?: {
    client?: OAuth2ClientConfig;
  };
}

export interface AuthService {
  logout: (request: Request) => Promise<Response>;
  logged: (request: Request, onLogged?: LoggedHandler) => Promise<Response>;

  oauth2Authorization: (request: Request) => Promise<Response>;
  loginOAuth2: (request: Request, onAuthorized: OAuth2AuthorizedHandler) => Promise<Response>;
}
