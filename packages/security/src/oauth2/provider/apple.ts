import { invariant } from '@shware/utils';
import { OAuth2Error } from '../error';
import {
  type AppleUser,
  cleanNamePart,
  cleanPersonName,
  nameClaims,
  parseAppleUser,
} from '../name';
import type {
  LoginOAuth2NativeParams,
  NativeCredential,
  OAuth2Token,
  PersonNameComponents,
  Provider,
  UserInfo,
} from '../types';
import { createAuthorizationUri, exchangeAuthorizationCode, verifyIdToken } from './common';

// ref: https://account.apple.com/.well-known/openid-configuration
export function createAppleProvider(): Provider {
  return {
    // important notice: response_mode=form_post is required for apple
    authorizationUri: 'https://appleid.apple.com/auth/authorize?response_mode=form_post',
    tokenUri: 'https://appleid.apple.com/auth/token',
    jwkSetUri: 'https://appleid.apple.com/auth/keys',
    userNameAttribute: 'sub',
    defaultScope: ['openid', 'name', 'email'],
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
        const { error } = (await response.json()) as AppleErrorResponse;
        throw new OAuth2Error(response.status, error);
      }
      return (await response.json()) as AppleToken;
    },
    async getUserInfo({ id_token }, response) {
      invariant(id_token, 'id_token is required');
      invariant(this.jwkSetUri, 'jwkSetUri is required');
      const token = await verifyIdToken<AppleIdToken>(id_token, this.jwkSetUri);
      // Apple's id token never carries a name; on the first authorization of the web flow the
      // name comes in the form_post `user` instead, unsigned, so only its name parts are used
      // and the signed id token's email always wins over the one beside them.
      const user = parseAppleUser(response?.user);
      const data: AppleUserInfo = user ? { ...token, user } : token;
      return {
        data,
        claims: {
          sub: token.sub,
          email: token.email,
          email_verified: true,
          ...nameClaims({
            given_name: user?.name?.firstName,
            family_name: user?.name?.lastName,
          }),
        },
      };
    },
    async loginOAuth2Native({ pkce: _, credentials, ...params }: LoginOAuth2NativeParams) {
      invariant(credentials.code, 'code is required');
      const { tokenUri } = this;
      const { code } = credentials;
      const response = await exchangeAuthorizationCode({ code, tokenUri, ...params });
      if (!response.ok) {
        const { error } = (await response.json()) as AppleErrorResponse;
        throw new OAuth2Error(response.status, error);
      }
      const token = (await response.json()) as AppleToken;
      const { data, claims } = await this.getUserInfo(token);
      // The app gets the name from Apple on the first authorization only and passes it along in
      // the login body. Standard fields win over the platform's components they mirror.
      const full_name = cleanPersonName(credentials.full_name);
      const name = nameClaims({
        given_name: cleanNamePart(credentials.given_name) ?? full_name?.givenName ?? undefined,
        family_name: cleanNamePart(credentials.family_name) ?? full_name?.familyName ?? undefined,
        middle_name: cleanNamePart(credentials.middle_name) ?? full_name?.middleName ?? undefined,
        nickname: cleanNamePart(credentials.nickname) ?? full_name?.nickname ?? undefined,
      });
      const userInfo: UserInfo<AppleUserInfo> = {
        data: full_name ? { ...(data as AppleUserInfo), full_name } : (data as AppleUserInfo),
        claims: { ...claims, ...name },
      };
      return { token, userInfo };
    },
  };
}

export const apple = createAppleProvider();

// Claims of Apple's id token. It carries no name or picture, not even on the first authorization.
// https://developer.apple.com/documentation/signinwithapple/authenticating-users-with-sign-in-with-apple
export interface AppleIdToken {
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  sub: string;
  email: string;
  email_verified: true | 'true';
  is_private_email: boolean;
  /** Native flow, first authorization only: 0 unsupported, 1 unknown, 2 likely real. */
  real_user_status?: number;
  nonce?: string;
  nonce_supported?: boolean;
}

/**
 * `userInfo.data` of an Apple login: the id token's claims, plus the unsigned name the client
 * passed on the first authorization, cleaned (see `nameClaims` for the standard claims made of it).
 */
export interface AppleUserInfo extends AppleIdToken {
  /** Web flow: Apple's form_post `user`, as Apple names it. */
  user?: AppleUser;
  /** Native flow: the login body's `full_name`, which alone keeps `namePrefix` / `nameSuffix`. */
  full_name?: PersonNameComponents;
}

// https://developer.apple.com/documentation/devicemanagement/implementing-the-oauth2-authentication-user-enrollment-flow
// https://developer.apple.com/documentation/sign_in_with_apple/generate_and_validate_tokens
export interface AppleToken extends OAuth2Token {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  id_token: string;
}

export interface AppleNativeCredential extends NativeCredential {
  state: string;
  code: string;
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
