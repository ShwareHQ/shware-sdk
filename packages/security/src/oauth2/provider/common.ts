import jwt from 'jsonwebtoken';
import { OAuth2Error } from '../error';
import { CodeExchangeParams, OAuth2Token, PkceParameters } from '../types';

export function createAuthorizationUri(options: {
  state: string;
  scope: string[];
  clientId: string;
  redirectUri: string;
  authorizationUri: string;
  pkce?: Omit<PkceParameters, 'code_verifier'>;
}) {
  const url = new URL(options.authorizationUri);
  url.searchParams.append('response_type', 'code');
  url.searchParams.append('client_id', options.clientId);
  url.searchParams.append('state', options.state);
  url.searchParams.append('scope', options.scope.join(' '));
  url.searchParams.append('redirect_uri', options.redirectUri);
  if (options.pkce) {
    url.searchParams.append('code_challenge_method', options.pkce.code_challenge_method);
    url.searchParams.append('code_challenge', options.pkce.code_challenge);
  }
  return url;
}

interface Params extends CodeExchangeParams {
  tokenUri: string;
  authentication?: 'basic' | 'post';
}

export async function exchangeAuthorizationCode(params: Params) {
  const body = new URLSearchParams();
  body.append('code', params.code);
  body.append('redirect_uri', params.redirectUri);
  body.append('grant_type', 'authorization_code');
  if (params.pkce) body.append('code_verifier', params.pkce.code_verifier);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (params.authentication === 'basic') {
    const token = Buffer.from(`${params.clientId}:${params.clientSecret}`).toString('base64');
    headers.Authorization = `Basic ${token}`;
  } else {
    body.append('client_id', params.clientId);
    body.append('client_secret', params.clientSecret);
  }

  return fetch(params.tokenUri, { method: 'POST', headers, body });
}

interface RefreshTokenParams {
  tokenUri: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  authentication?: 'basic' | 'post';
}

export async function refreshAccessToken(params: RefreshTokenParams) {
  const body = new URLSearchParams();
  body.append('grant_type', 'refresh_token');
  body.append('refresh_token', params.refreshToken);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (params.authentication === 'basic') {
    const token = Buffer.from(`${params.clientId}:${params.clientSecret}`).toString('base64');
    headers.Authorization = `Basic ${token}`;
  } else {
    body.append('client_id', params.clientId);
    body.append('client_secret', params.clientSecret);
  }

  const response = await fetch(params.tokenUri, { method: 'POST', headers, body });
  if (!response.ok) {
    const error = await response.json();
    console.error('Refresh token error:', error);
    throw new OAuth2Error(response.status, 'invalid_request', 'Failed to refresh token');
  }
  return (await response.json()) as OAuth2Token;
}

interface RevokeTokenParams {
  token: string;
  clientId: string;
  clientSecret: string;
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
    const token = Buffer.from(`${params.clientId}:${params.clientSecret}`).toString('base64');
    headers.Authorization = `Basic ${token}`;
  } else {
    body.append('client_id', params.clientId);
    body.append('client_secret', params.clientSecret);
  }

  const response = await fetch(params.tokenRevokeUri, { method: 'POST', headers, body });
  if (!response.ok) {
    const error = await response.json();
    console.error('Refresh token error:', error);
    throw new OAuth2Error(response.status, 'invalid_request', 'Failed to revoke token');
  }
}

interface JWKSet {
  keys: { kty: string; kid: string; use: string; alg: string; n: string; e: string }[];
}

const cache = new Map<string, JWKSet>();

async function getJWK(kid: string, jwkSetUri: string) {
  let jwkSet: JWKSet;
  if (cache.has(jwkSetUri)) {
    jwkSet = cache.get(jwkSetUri)!;
  } else {
    const response = await fetch(jwkSetUri);
    if (!response.ok) throw new OAuth2Error(response.status, 'server_error', 'Failed to fetch JWK');
    jwkSet = (await response.json()) as JWKSet;
    cache.set(jwkSetUri, jwkSet);
  }

  const jwk = jwkSet.keys.find((key) => key.kid === kid);
  if (!jwk) throw new OAuth2Error(400, 'invalid_request', `JWK not found for kid: ${kid}`);
  return jwk;
}

export async function verifyIdToken<T>(idToken: string, jwkSetUri: string) {
  const header = jwt.decode(idToken, { complete: true });
  if (!header?.header.kid) {
    throw new OAuth2Error(400, 'invalid_request', 'kid not found in id_token header');
  }
  try {
    const key = await getJWK(header.header.kid, jwkSetUri);
    return jwt.verify(idToken, { key, format: 'jwk' }) as T;
  } catch (e) {
    throw new OAuth2Error(400, 'invalid_request', 'Failed to verify id_token');
  }
}
