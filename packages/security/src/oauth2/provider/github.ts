import { invariant } from '@shware/utils';
import { OAuth2Error } from '../error';
import { OAuth2Token, Provider } from '../types';
import { createAuthorizationUri, exchangeAuthorizationCode } from './common';

export function createGithubProvider(): Provider {
  return {
    authorizationUri: 'https://github.com/login/oauth/authorize',
    tokenUri: 'https://github.com/login/oauth/access_token',
    userInfoUri: 'https://api.github.com/user',
    userNameAttribute: 'id',
    defaultScope: ['user:email'],
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
        const { error, error_description } = (await response.json()) as GithubErrorResponse;
        throw new OAuth2Error(response.status, error, error_description);
      }
      return (await response.json()) as GithubToken;
    },
    async getUserInfo({ access_token }) {
      invariant(access_token, 'access_token is required');
      invariant(this.userInfoUri, 'userInfoUri is required');
      const headers = { Accept: 'application/json', Authorization: `Bearer ${access_token}` };
      const response = await fetch(this.userInfoUri, { headers });
      if (!response.ok) {
        throw new OAuth2Error(response.status, 'invalid_request', 'Failed to fetch user info');
      }
      const data = (await response.json()) as GithubUserInfo;
      const emailResponse = await fetch('https://api.github.com/user/emails', { headers });
      if (!emailResponse.ok) {
        throw new OAuth2Error(
          emailResponse.status,
          'invalid_request',
          'Failed to fetch user email'
        );
      }
      const emails = (await emailResponse.json()) as GithubEmail[];
      data.email = emails.find((email) => email.primary)?.email || data.email;
      const email_verified = emails.find((email) => email.email === data.email)?.verified || false;
      return {
        data,
        claims: {
          sub: data.id,
          name: data.name || data.login,
          email_verified,
          email: data.email,
          picture: data.avatar_url,
          profile: data.html_url,
          website: data.html_url,
          updated_at: data.updated_at ? Date.parse(data.updated_at) : undefined,
        },
      };
    },
  };
}

export const github = createGithubProvider();

export interface GithubUserInfo {
  login: string;
  id: string;
  node_id: string;
  avatar_url: string;
  gravatar_id: string;
  url: string;
  html_url: string;
  followers_url: string;
  following_url: string;
  gists_url: string;
  starred_url: string;
  subscriptions_url: string;
  organizations_url: string;
  repos_url: string;
  events_url: string;
  received_events_url: string;
  type: string;
  site_admin: boolean;
  name: string;
  company: string;
  blog: string;
  location: string;
  email: string;
  hireable: boolean;
  bio: string;
  twitter_username: string;
  public_repos: string;
  public_gists: string;
  followers: string;
  following: string;
  created_at: string;
  updated_at: string;
  private_gists: string;
  total_private_repos: string;
  owned_private_repos: string;
  disk_usage: string;
  collaborators: string;
  two_factor_authentication: boolean;
  plan: {
    name: string;
    space: string;
    private_repos: string;
    collaborators: string;
  };
}

interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: 'public' | 'private';
}

export interface GithubToken extends OAuth2Token {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token: string;
}

interface GithubErrorResponse {
  error: string;
  error_description: string;
  error_uri: string;
}
