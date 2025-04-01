import invariant from 'tiny-invariant';
import { OAuth2Token, Provider } from '../types';
import { OAuth2Error } from '../error';
import { createAuthorizationUri, exchangeAuthorizationCode, verifyIdToken } from './common';

export function createGoogle(): Provider {
  return {
    authorizationUri: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUri: 'https://oauth2.googleapis.com/token',
    userInfoUri: 'https://www.googleapis.com/oauth2/v3/userinfo',
    userNameAttribute: 'sub',
    jwkSetUri: 'https://www.googleapis.com/oauth2/v3/certs',
    // https://developers.google.com/identity/protocols/oauth2/scopes#oauth2
    defaultScope: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'openid',
    ],
    createAuthorizationUri(params) {
      return createAuthorizationUri({
        ...params,
        scope: params.scope ?? this.defaultScope,
        authorizationUri: this.authorizationUri,
      });
    },
    async exchangeAuthorizationCode(params) {
      const response = await exchangeAuthorizationCode({ ...params, tokenUri: this.tokenUri });
      if (!response.ok) {
        const { error, error_description } = (await response.json()) as GoogleErrorResponse;
        throw new OAuth2Error(response.status, error, error_description);
      }
      return (await response.json()) as GoogleToken;
    },
    async getUserInfo({ id_token }) {
      invariant(id_token, 'id_token is required');
      invariant(this.jwkSetUri, 'jwkSetUri is required');
      const data = await verifyIdToken<GoogleUserInfo>(id_token, this.jwkSetUri);
      return {
        data,
        claims: {
          sub: data.sub,
          name: data.name,
          picture: data.picture,
          email: data.email,
          email_verified: data.email_verified,
          given_name: data.given_name,
          family_name: data.family_name,
          locale: data.locale,
        },
      };
    },
  };
}

export const google = createGoogle();

export interface GoogleUserInfo {
  aud: string;
  azp: string;
  email: string;
  email_verified: boolean;
  exp: number;
  family_name: string;
  given_name: string;
  hd?: string;
  iat: number;
  iss: string;
  jti?: string;
  locale?: string;
  name: string;
  nbf?: number;
  picture: string;
  sub: string;
}

export interface GoogleToken extends OAuth2Token {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  id_token: string;
  scope: string;
}

// android,ios has different client_id and redirect_uri
export type GoogleAppCredentials = {
  state: string;
  code: string;
  client_id: string;
  redirect_uri: string;
};

export interface GoogleErrorResponse {
  error:
    | 'invalid_request'
    | 'invalid_client'
    | 'invalid_grant'
    | 'invalid_token'
    | 'invalid_scope'
    | 'unauthorized_client'
    | 'unsupported_grant_type'
    | 'access_denied'
    | 'server_error';
  error_description: string;
}
