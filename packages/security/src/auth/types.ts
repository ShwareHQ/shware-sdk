import { Principal } from '../core';
import { UserInfo } from '../oauth2/types';
import { OAuth2Token } from '../oauth2/types';

export type LoggedHandler = (principal: Principal) => Promise<void>;
export type OAuth2AuthorizedHandler = (
  request: Request,
  registrationId: string,
  userInfo: UserInfo,
  token: OAuth2Token
) => Promise<Principal>;

export interface AuthHandler {
  logout: (request: Request) => Promise<Response>;
  logged: (request: Request, onLogged?: LoggedHandler) => Promise<Response>;

  oauth2Authorization: (request: Request) => Promise<Response>;
  loginOAuth2: (request: Request, onAuthorized: OAuth2AuthorizedHandler) => Promise<Response>;
}
