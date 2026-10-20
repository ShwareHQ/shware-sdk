export { Auth, PATH } from './auth/index';
export { OAuth2Client, oauth2RedirectQuerySchema } from './oauth2/client';
export { OAuth2Error, type OAuth2ErrorType } from './oauth2/error';
export { RedisIndexedSessionRepository, RedisKVRepository } from './session/redis';
export { DBIndexedSessionRepository } from './session/db';
export { PRINCIPAL_NAME_INDEX_NAME } from './session/common';
export { PROVIDERS, type Provider } from './core/index';
export { OIDC_SCOPES } from './oauth2/types';
export { composeName, MAX_NAME_PART_LENGTH } from './oauth2/name';

export type { Principal, CsrfToken } from './core/index';
export type { DBAdapter } from './session/db';
export type { Namespace, SessionRepository, Session, KVRepository } from './session/types';
export type {
  AuthorizationResponse,
  ClientSecret,
  NativeClient,
  NativeCredential,
  OAuth2ClientConfig,
  OAuth2Token,
  OidcToken,
  OidcScope,
  PersonNameComponents,
  ProviderConfig,
  StandardClaims,
  UserInfo,
  WebClient,
} from './oauth2/types';
export type {
  AuthConfig,
  AuthService,
  Authorization,
  AuthorizedHandler,
  OAuth2AuthorizationOptions,
} from './auth/types';
