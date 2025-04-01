import type { Principal } from '../core';
import type { OAuth2Token, OAuth2ClientConfig, PkceParameters, UserInfo } from '../oauth2/types';
import type { SessionRepository } from '../session';
import type { CookieOptions } from '../utils/http';

export type LoggedHandler = (principal: Principal) => Promise<void>;
export type OAuth2AuthorizedHandler = (
  request: Request,
  registrationId: string,
  userInfo: UserInfo,
  token: OAuth2Token
) => Promise<Principal>;

export interface OAuth2State extends PkceParameters {
  state: string;
  nonce: string;
  registrationId: string;
}

export interface AuthConfig {
  timing?: boolean;
  repository: SessionRepository;
  cookie?: CookieOptions & { name?: string };
  oauth2?: {
    client?: OAuth2ClientConfig;
  };
}

export interface AuthService {
  logout: (request: Request) => Promise<Response>;
  logged: (request: Request, onLogged?: LoggedHandler) => Promise<Response>;

  oauth2State: (request: Request) => Promise<Response>;
  oauth2Authorization: (request: Request) => Promise<Response>;
  loginOAuth2Code: (request: Request, onAuthorized: OAuth2AuthorizedHandler) => Promise<Response>;
  loginOAuth2Native: (request: Request, onAuthorized: OAuth2AuthorizedHandler) => Promise<Response>;
}
