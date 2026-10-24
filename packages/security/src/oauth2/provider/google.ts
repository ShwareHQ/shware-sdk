import { invariant } from '@shware/utils';
import { OAuth2Error } from '../error';
import type {
  LoginOAuth2NativeParams,
  NativeCredential,
  OAuth2Token,
  OneTapProvider,
} from '../types';
import { createAuthorizationUri, exchangeAuthorizationCode, verifyIdToken } from './common';

/** Google signs id tokens with either `iss`, the URL or the bare host. */
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

function claims(data: GoogleUserInfo) {
  return {
    sub: data.sub,
    name: data.name,
    picture: data.picture,
    email: data.email,
    email_verified: data.email_verified,
    given_name: data.given_name,
    family_name: data.family_name,
    locale: data.locale,
  };
}

export function createGoogleProvider(): OneTapProvider {
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
    async getUserInfo({ id_token }, { clientId }) {
      invariant(id_token, 'id_token is required');
      invariant(this.jwkSetUri, 'jwkSetUri is required');
      const data = await verifyIdToken<GoogleUserInfo>(id_token, {
        jwkSetUri: this.jwkSetUri,
        issuer: GOOGLE_ISSUERS,
        audience: clientId,
      });
      return { data, claims: claims(data) };
    },
    async loginOAuth2Native({ pkce, credentials, ...params }: LoginOAuth2NativeParams) {
      invariant(credentials.code, 'code is required');
      const { code } = credentials;
      const { tokenUri } = this;
      // An app signs in as its own installed-app client (the iOS / Android client id, custom-scheme
      // redirect), and Google only exchanges a code for the client it was issued to, so the exchange
      // runs as the client the app names, which the OAuth2 client has already checked is one of this
      // provider's configured clients. Installed-app clients have no secret. The redirect URI is the
      // one the app used, which only the app knows. So is the PKCE verifier, when the app sent a
      // challenge: Google then refuses the code without it.
      const { redirect_uri = params.redirectUri } = credentials;
      const response = await exchangeAuthorizationCode({
        code,
        pkce,
        tokenUri,
        clientId: params.clientId,
        clientSecret: params.clientSecret,
        redirectUri: redirect_uri,
      });
      if (!response.ok) {
        const { error, error_description } = (await response.json()) as GoogleErrorResponse;
        throw new OAuth2Error(response.status, error, error_description);
      }
      const token = (await response.json()) as GoogleToken;
      const userInfo = await this.getUserInfo(token, { clientId: params.clientId });
      return { token, userInfo };
    },
    async getTokenInfo(id_token: string, clientId: string) {
      invariant(id_token, 'id_token is required');
      invariant(this.jwkSetUri, 'jwkSetUri is required');
      // One Tap and FedCM issue the credential to the web client.
      const data = await verifyIdToken<GoogleUserInfo>(id_token, {
        jwkSetUri: this.jwkSetUri,
        issuer: GOOGLE_ISSUERS,
        audience: clientId,
      });
      return {
        token: {
          id_token,
          access_token: '',
          token_type: '',
          expires_in: 0,
          refresh_token: '',
          scope: '',
        },
        userInfo: { data, claims: claims(data) },
      };
    },
  };
}

export const google = createGoogleProvider();

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
  nonce?: string;
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
export interface GoogleAppCredential extends NativeCredential {
  state: string;
  code: string;
  client_id: string;
  redirect_uri: string;
}

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
