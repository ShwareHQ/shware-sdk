import invariant from 'tiny-invariant';
import { LoginOAuth2NativeParams, OAuth2Token, Provider } from '../types';
import { OAuth2Error } from '../error';
import { createAuthorizationUri, exchangeAuthorizationCode, verifyIdToken } from './common';

/**
 * ref: https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/
 * ref: https://developers.facebook.com/tools/explorer
 * */
export function createFacebookProvider(): Provider {
  return {
    authorizationUri: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUri: 'https://graph.facebook.com/v19.0/oauth/access_token',
    userInfoUri: 'https://graph.facebook.com/me',
    jwkSetUri: 'https://limited.facebook.com/.well-known/oauth/openid/jwks/',
    userNameAttribute: 'id',
    defaultScope: ['profile', 'email'],
    createAuthorizationUri({ pkce, ...params }) {
      return createAuthorizationUri({
        ...params,
        scope: params.scope ?? this.defaultScope,
        authorizationUri: this.authorizationUri,
      });
    },
    async exchangeAuthorizationCode({ pkce, ...params }) {
      const response = await exchangeAuthorizationCode({ ...params, tokenUri: this.tokenUri });
      if (!response.ok) {
        const { error } = (await response.json()) as FacebookErrorResponse;
        throw new OAuth2Error(response.status, 'invalid_request', error.message);
      }
      return (await response.json()) as FacebookToken;
    },
    async getUserInfo({ id_token, access_token }) {
      invariant(this.jwkSetUri, 'jwkSetUri is required');
      if (id_token) {
        const data = await verifyIdToken<FacebookDecodedIdToken>(id_token, this.jwkSetUri);
        return {
          data,
          claims: {
            sub: data.sub,
            name: data.name,
            picture: data.picture,
            email: data.email,
            email_verified: true,
          },
        };
      }
      invariant(access_token, 'access_token is required');
      invariant(this.userInfoUri, 'userInfoUri is required');

      const url = new URL(this.userInfoUri);
      const fields = ['id', 'name', 'email', 'picture.width(320).height(320)'];
      url.searchParams.append('access_token', access_token);
      url.searchParams.append('fields', fields.join(','));
      const headers = { Accept: 'application/json' };
      const response = await fetch(url.href, { headers });
      if (!response.ok) {
        throw new OAuth2Error(response.status, 'invalid_request', 'Failed to fetch user info');
      }
      const data = (await response.json()) as FacebookUserInfo;
      return {
        data,
        claims: {
          sub: data.id,
          name: data.name,
          email: data.email,
          picture: data.picture.data.url,
          email_verified: data.email_verified,
        },
      };
    },
    async loginOAuth2Native({ credentials }: LoginOAuth2NativeParams) {
      if (credentials.id_token || credentials.access_token) {
        const userInfo = await this.getUserInfo(credentials as unknown as OAuth2Token);
        const token: OAuth2Token = {
          token_type: 'bearer',
          access_token: credentials.access_token ?? '',
          id_token: credentials.id_token,
        };
        return { token, userInfo };
      } else {
        throw new OAuth2Error(400, 'invalid_request', 'id_token or access_token is required');
      }
    },
  };
}

export const facebook = createFacebookProvider();

export interface FacebookDecodedIdToken {
  sub: string;
  name: string;
  email: string;
  picture: string;
  nonce?: string;
}

export interface FacebookUserInfo {
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
  picture: {
    data: {
      url: string;
      width: number;
      height: number;
      is_silhouette: boolean;
    };
  };
}

export interface FacebookToken extends OAuth2Token {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  id_token?: string;
}

export type FacebookAppCredential =
  | { state: string; id_token: string } // platform=ios and tracking=limited
  | { state: string; access_token: string }; // tracking=enabled

interface FacebookErrorResponse {
  error: {
    message: string;
    type: 'OAuthException';
    code: number;
    error_subcode: number;
    fbtrace_id: string;
  };
}
