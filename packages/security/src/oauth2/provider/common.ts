import { createRemoteJWKSet, jwtVerify } from 'jose';
import { OAuth2Error } from '../error';
import type { ExchangeCodeParams, PkceParameters, RefreshTokenParams } from '../types';

export function createAuthorizationUri(options: {
  state: string;
  scope: string[];
  clientId: string;
  redirectUri: string;
  authorizationUri: string;
  pkce?: Omit<PkceParameters, 'code_verifier'>;
  nonce?: string;
}) {
  const url = new URL(options.authorizationUri);
  url.searchParams.append('response_type', 'code');
  url.searchParams.append('client_id', options.clientId);
  url.searchParams.append('state', options.state);
  if (options.nonce) url.searchParams.append('nonce', options.nonce);
  url.searchParams.append('scope', options.scope.join(' '));
  url.searchParams.append('redirect_uri', options.redirectUri);
  if (options.pkce) {
    url.searchParams.append('code_challenge_method', options.pkce.code_challenge_method);
    url.searchParams.append('code_challenge', options.pkce.code_challenge);
  }
  return url;
}

export async function exchangeAuthorizationCode(
  params: ExchangeCodeParams & {
    tokenUri: string;
    authentication?: 'basic' | 'post';
    /** Extra request headers some providers require, e.g. GitHub's `User-Agent`. */
    headers?: Record<string, string>;
  }
) {
  const body = new URLSearchParams();
  body.append('code', params.code);
  body.append('redirect_uri', params.redirectUri);
  body.append('grant_type', 'authorization_code');
  if (params.pkce) body.append('code_verifier', params.pkce.code_verifier);

  const headers: Record<string, string> = {
    ...params.headers,
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (params.authentication === 'basic') {
    const token = Buffer.from(`${params.clientId}:${params.clientSecret ?? ''}`).toString('base64');
    headers.Authorization = `Basic ${token}`;
  } else {
    body.append('client_id', params.clientId);
    // Public clients (Google's installed-app clients, PKCE-only clients) have no secret.
    if (params.clientSecret) body.append('client_secret', params.clientSecret);
  }

  return fetch(params.tokenUri, { method: 'POST', headers, body });
}

export async function refreshAccessToken(
  params: RefreshTokenParams & {
    tokenUri: string;
    authentication?: 'basic' | 'post';
  }
) {
  const body = new URLSearchParams();
  body.append('grant_type', 'refresh_token');
  body.append('refresh_token', params.refreshToken);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (params.authentication === 'basic') {
    const token = Buffer.from(`${params.clientId}:${params.clientSecret ?? ''}`).toString('base64');
    headers.Authorization = `Basic ${token}`;
  } else {
    body.append('client_id', params.clientId);
    if (params.clientSecret) body.append('client_secret', params.clientSecret);
  }

  return fetch(params.tokenUri, { method: 'POST', headers, body });
}

interface RevokeTokenParams {
  token: string;
  clientId: string;
  clientSecret?: string;
  tokenRevokeUri: string;
  authentication?: 'basic' | 'post';
}

export async function revokeToken(params: RevokeTokenParams) {
  const body = new URLSearchParams();
  body.append('token', params.token);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (params.authentication === 'basic') {
    const token = Buffer.from(`${params.clientId}:${params.clientSecret ?? ''}`).toString('base64');
    headers.Authorization = `Basic ${token}`;
  } else {
    body.append('client_id', params.clientId);
    if (params.clientSecret) body.append('client_secret', params.clientSecret);
  }

  const response = await fetch(params.tokenRevokeUri, { method: 'POST', headers, body });
  if (!response.ok) {
    const error = await response.json();
    console.error('Revoke token error:', error);
    throw new OAuth2Error(response.status, 'invalid_request', 'Failed to revoke token');
  }
}

export interface VerifyIdTokenOptions {
  jwkSetUri: string;
  /** The `iss` values the provider signs with; anything else is refused. */
  issuer: string | string[];
  /**
   * The client the token must be issued to. An id token proves who the user is only to the client
   * it names in `aud`: any other app on the same identity provider can obtain a validly signed one
   * for the same user, so a token for a foreign client must never sign anyone in here.
   */
  audience: string;
}

/**
 * One key set per JWKS endpoint for the life of the process: jose caches the fetched keys,
 * refetches on an unknown `kid` (with a cooldown) and when they go stale, so a set created per
 * call would refetch the keys for every id token.
 */
const jwkSets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function remoteJWKSet(jwkSetUri: string) {
  let jwks = jwkSets.get(jwkSetUri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwkSetUri));
    jwkSets.set(jwkSetUri, jwks);
  }
  return jwks;
}

export async function verifyIdToken<T>(idToken: string, options: VerifyIdTokenOptions) {
  const { jwkSetUri, issuer, audience } = options;
  try {
    const jwks = remoteJWKSet(jwkSetUri);
    const { payload } = await jwtVerify(idToken, jwks, { issuer, audience });
    return payload as T;
  } catch (error) {
    console.error('Failed to verify id_token', error);
    // The token is the grant here: one for another audience or issuer is an invalid grant, not a
    // malformed request.
    throw new OAuth2Error(400, 'invalid_grant', 'Failed to verify id_token');
  }
}
