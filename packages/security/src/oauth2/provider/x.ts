import invariant from 'tiny-invariant';
import { OAuth2Token, Provider } from '../types';
import { OAuth2Error } from '../error';
import {
  createAuthorizationUri,
  exchangeAuthorizationCode,
  refreshAccessToken,
  revokeToken,
} from './common';

export interface XOptions {
  userFields?: UserField[];
}

const defaultUserFields = [
  'id',
  'name',
  'profile_image_url',
  'url',
  'username',
  'location',
  'verified',
];

export function createXProvider(options?: XOptions): Provider {
  return {
    authorizationUri: 'https://x.com/i/oauth2/authorize',
    tokenUri: 'https://api.x.com/2/oauth2/token',
    tokenRevokeUri: 'https://api.x.com/2/oauth2/revoke',
    // https://docs.x.com/x-api/users/user-lookup-me
    userInfoUri: 'https://api.x.com/2/users/me',
    defaultScope: ['users.read', 'tweet.read', 'offline.access'],
    createAuthorizationUri(params) {
      if (!params.pkce) throw new Error('pkce is required for x');
      return createAuthorizationUri({
        ...params,
        scope: params.scope ?? this.defaultScope,
        authorizationUri: this.authorizationUri,
      });
    },
    async exchangeAuthorizationCode(params) {
      if (!params.pkce) throw new Error('pkce is required for x');
      const response = await exchangeAuthorizationCode({
        ...params,
        tokenUri: this.tokenUri,
        authentication: 'basic',
      });
      if (!response.ok) {
        const { error, error_description } = (await response.json()) as XErrorResponse;
        throw new OAuth2Error(response.status, error, error_description);
      }
      return (await response.json()) as XToken;
    },
    async getUserInfo({ access_token }) {
      invariant(access_token, 'access_token is required');
      invariant(this.userInfoUri, 'userInfoUri is required');

      const userFields = options?.userFields ?? defaultUserFields;
      const headers = { Accept: 'application/json', Authorization: `Bearer ${access_token}` };

      const url = new URL(this.userInfoUri);
      userFields.forEach((field) => url.searchParams.append('user.fields', field));

      const response = await fetch(this.userInfoUri, { headers });
      if (!response.ok) {
        const { errors } = (await response.json()) as XAPIErrorResponse;
        throw new OAuth2Error(
          response.status,
          'invalid_request',
          'Failed to fetch user info: ' + (errors.at(0)?.detail ?? errors.at(0)?.title)
        );
      }
      const profile = (await response.json()) as XUserInfo;
      return {
        data: profile,
        claims: {
          sub: profile.data.id,
          name: profile.data.name,
          picture: profile.data.profile_image_url,
          email: profile.data.email,
          email_verified: profile.data.verified || false,
          preferred_username: profile.data.username,
          profile: `https://x.com/${profile.data.username}`,
          website: profile.data.url,
        },
      };
    },
    async refreshAccessToken(params) {
      const response = await refreshAccessToken({
        ...params,
        tokenUri: this.tokenUri,
        authentication: 'basic',
      });
      if (!response.ok) {
        const { error, error_description } = (await response.json()) as XErrorResponse;
        throw new OAuth2Error(response.status, error, error_description);
      }
      return (await response.json()) as XToken;
    },
    async revokeToken(params) {
      invariant(this.tokenRevokeUri, 'tokenRevokeUri is required');
      return revokeToken({
        ...params,
        tokenRevokeUri: this.tokenRevokeUri,
        authentication: 'basic',
      });
    },
  };
}

export const x = createXProvider();

type UserField =
  | 'affiliation'
  | 'connection_status'
  | 'created_at'
  | 'description'
  | 'entities'
  | 'id'
  | 'is_identity_verified'
  | 'location'
  | 'most_recent_tweet_id'
  | 'name'
  | 'parody'
  | 'pinned_tweet_id'
  | 'profile_banner_url'
  | 'profile_image_url'
  | 'protected'
  | 'public_metrics'
  | 'receives_your_dm'
  | 'subscription'
  | 'subscription_type'
  | 'url'
  | 'username'
  | 'verified'
  | 'verified_followers_count'
  | 'verified_type'
  | 'withheld';

export interface XUser {
  id: string;
  name: string;
  email?: string;
  username: string;
  location?: string;
  entities?: {
    url: { urls: UrlEntity[] };
    description: {
      hashtags: HashtagEntity[];
      cashtags: HashtagEntity[];
      mentions: MentionEntity[];
    };
  };
  verified?: boolean;
  description?: string;
  url?: string;
  profile_image_url?: string;
  protected?: boolean;
  pinned_tweet_id?: string;
  created_at?: string;
}

export interface XUserInfo {
  data: XUser;
  includes?: { tweets?: { id: string; text: string }[]; users?: XUser[] };
}

// prettier-ignore
type UrlEntity = { start: number; end: number; url: string; display_url: string; expanded_url: string; }
type HashtagEntity = { start: number; end: number; tag: string };
type MentionEntity = { start: number; end: string; username: string };

export interface XToken extends OAuth2Token {
  token_type: string;
  expires_in: number;
  access_token: string;
  scope: string;
  refresh_token: string;
}

type XErrorResponse = { error: string; error_description: string };
type XAPIErrorResponse = {
  errors: { title: string; type: string; detail?: string; status?: number }[];
};
