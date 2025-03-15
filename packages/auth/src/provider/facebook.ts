import invariant from 'tiny-invariant';
import { Provider } from '../client';
import { OAuth2Error } from '../error';
import { createAuthorizationUri, exchangeAuthorizationCode, verifyIdToken } from './common';

/**
 * ref: https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/
 * ref: https://developers.facebook.com/tools/explorer
 * */
export function facebook(): Provider<FacebookUserInfo | FacebookDecodedIdToken> {
  return {
    authorizationUri: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUri: 'https://graph.facebook.com/v19.0/oauth/access_token',
    userInfoUri: 'https://graph.facebook.com/me',
    jwkSetUri: 'https://limited.facebook.com/.well-known/oauth/openid/jwks/',
    userNameAttribute: 'id',
    defaultScope: ['profile', 'email'],
    createAuthorizationUri({ codeVerifier, ...params }) {
      return createAuthorizationUri({
        ...params,
        scope: params.scope ?? this.defaultScope,
        authorizationUri: this.authorizationUri,
      });
    },
    async exchangeAuthorizationCode({ codeVerifier, ...params }) {
      const response = await exchangeAuthorizationCode({ ...params, tokenUri: this.tokenUri });
      if (!response.ok) {
        const { error } = (await response.json()) as FacebookErrorResponse;
        throw new OAuth2Error(response.status, 'invalid_request', error.message);
      }
      return (await response.json()) as FacebookOAuth2Token;
    },
    async getUserInfo({ id_token, access_token }) {
      invariant(this.jwkSetUri, 'jwkSetUri is required');
      if (id_token) {
        const data = await verifyIdToken<FacebookDecodedIdToken>(id_token, this.jwkSetUri);
        return {
          data,
          user: {
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
        user: {
          sub: data.id,
          name: data.name,
          email: data.email,
          picture: data.picture.data.url,
          email_verified: data.email_verified,
        },
      };
    },
  };
}

export interface FacebookDecodedIdToken {
  sub: string;
  name: string;
  email: string;
  picture: string;
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

interface FacebookOAuth2Token {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
}

interface FacebookErrorResponse {
  error: {
    message: string;
    type: 'OAuthException';
    code: number;
    error_subcode: number;
    fbtrace_id: string;
  };
}
