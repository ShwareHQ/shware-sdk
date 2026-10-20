import { createHmac } from 'node:crypto';
import { invariant } from '@shware/utils';
import { OAuth2Error } from '../error';
import type { LoginOAuth2NativeParams, OAuth2Token, Provider, UserInfo } from '../types';
import { createAuthorizationUri, exchangeAuthorizationCode, verifyIdToken } from './common';

/**
 * `iss` of Limited Login id tokens, per https://limited.facebook.com/.well-known/openid-configuration/
 * (their `aud` is the app id).
 */
const FACEBOOK_ISSUER = 'https://www.facebook.com';

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
    createAuthorizationUri({ pkce: _, ...params }) {
      return createAuthorizationUri({
        ...params,
        scope: params.scope ?? this.defaultScope,
        authorizationUri: this.authorizationUri,
      });
    },
    async exchangeAuthorizationCode({ pkce: _, ...params }) {
      const response = await exchangeAuthorizationCode({ ...params, tokenUri: this.tokenUri });
      if (!response.ok) {
        const { error } = (await response.json()) as FacebookErrorResponse;
        throw new OAuth2Error(response.status, 'invalid_request', error.message);
      }
      return (await response.json()) as FacebookToken;
    },
    async getUserInfo({ id_token, access_token }, { clientId }) {
      invariant(this.jwkSetUri, 'jwkSetUri is required');
      if (id_token) {
        const data = await verifyIdToken<FacebookDecodedIdToken>(id_token, {
          jwkSetUri: this.jwkSetUri,
          issuer: FACEBOOK_ISSUER,
          audience: clientId,
        });
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
      return fetchUserInfo(this.userInfoUri, access_token);
    },
    async loginOAuth2Native({ clientId, clientSecret, credentials }: LoginOAuth2NativeParams) {
      const { id_token, access_token } = credentials;
      let userInfo: UserInfo;
      if (id_token) {
        // Limited Login: the id token's `aud` must be this app.
        userInfo = await this.getUserInfo(
          { token_type: 'bearer', access_token: '', id_token },
          {
            clientId,
          }
        );
      } else if (access_token) {
        // The Graph API serves any app's user access token, so `/me` alone would accept a token a
        // foreign app obtained for the same user. With `appsecret_proof` Facebook refuses tokens
        // not issued to the app whose secret signed the proof, binding the token to this client.
        if (!clientSecret) {
          throw new OAuth2Error(400, 'invalid_client', 'access_token login needs the app secret');
        }
        invariant(this.userInfoUri, 'userInfoUri is required');
        const proof = createHmac('sha256', clientSecret).update(access_token).digest('hex');
        userInfo = await fetchUserInfo(this.userInfoUri, access_token, proof);
      } else {
        throw new OAuth2Error(400, 'invalid_request', 'id_token or access_token is required');
      }
      const token: OAuth2Token = {
        token_type: 'bearer',
        access_token: access_token ?? '',
        id_token,
      };
      return { token, userInfo };
    },
  };
}

export const facebook = createFacebookProvider();

async function fetchUserInfo(
  userInfoUri: string,
  accessToken: string,
  appSecretProof?: string
): Promise<UserInfo<FacebookUserInfo>> {
  const url = new URL(userInfoUri);
  const fields = ['id', 'name', 'email', 'picture.width(320).height(320)'];
  url.searchParams.append('access_token', accessToken);
  url.searchParams.append('fields', fields.join(','));
  if (appSecretProof) url.searchParams.append('appsecret_proof', appSecretProof);
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
}

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
