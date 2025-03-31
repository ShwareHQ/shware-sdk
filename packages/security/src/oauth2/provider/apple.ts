import invariant from 'tiny-invariant';
import { Provider } from '../types';
import { OAuth2Error } from '../error';
import { createAuthorizationUri, exchangeAuthorizationCode, verifyIdToken } from './common';

// ref: https://account.apple.com/.well-known/openid-configuration
export function apple(): Provider<AppleOAuth2Token, AppleUserInfo> {
  return {
    // important notice: response_mode=form_post is required for apple
    authorizationUri: 'https://appleid.apple.com/auth/authorize?response_mode=form_post',
    tokenUri: 'https://appleid.apple.com/auth/token',
    jwkSetUri: 'https://appleid.apple.com/auth/keys',
    userNameAttribute: 'sub',
    defaultScope: ['openid', 'name', 'email'],
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
        const { error } = (await response.json()) as AppleErrorResponse;
        throw new OAuth2Error(response.status, error);
      }
      return (await response.json()) as AppleOAuth2Token;
    },
    async getUserInfo({ id_token }) {
      invariant(id_token, 'id_token is required');
      invariant(this.jwkSetUri, 'jwkSetUri is required');
      const data = await verifyIdToken<AppleUserInfo>(id_token, this.jwkSetUri);
      return {
        data,
        claims: {
          sub: data.sub,
          name: data.name,
          email: data.email,
          email_verified: true,
          picture: data.picture,
          given_name: data.user?.name.firstName,
          family_name: data.user?.name.lastName,
        },
      };
    },
  };
}

// https://developer.apple.com/documentation/sign_in_with_apple/authenticating-users-with-sign-in-with-apple
export interface AppleUserInfo {
  sub: string;
  email: string;
  email_verified: true | 'true';
  is_private_email: boolean;
  real_user_status: number;
  name: string;
  picture: string;
  user?: {
    name: { firstName: string; lastName: string };
    email: string;
  };
}

// https://developer.apple.com/documentation/devicemanagement/implementing-the-oauth2-authentication-user-enrollment-flow
// https://developer.apple.com/documentation/sign_in_with_apple/generate_and_validate_tokens
export interface AppleOAuth2Token {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  id_token: string;
}

// https://developer.apple.com/documentation/sign_in_with_apple/errorresponse
export interface AppleErrorResponse {
  error:
    | 'invalid_request'
    | 'invalid_client'
    | 'invalid_grant'
    | 'unauthorized_client'
    | 'unsupported_grant_type'
    | 'invalid_scope';
}
