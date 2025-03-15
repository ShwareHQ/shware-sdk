export interface JWTClaims {
  iss: string;
  azp: string;
  aud: string;
  sub: string;
  iat: number;
  exp: number;
  at_hash: string;
}

export interface GoogleExchangeResponse {
  access_token: string;
  id_token: string;
  expires_in: number;
  token_type: 'Bearer' | string;
  scope: string;
  refresh_token: string;
  locale?: string;
}

export interface GoogleUserinfo extends JWTClaims {
  name: string;
  picture: string;
  given_name: string;
  family_name: string;
  email: string;
  email_verified: boolean;
}

/**
 * ref: https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/
 * */
export interface FacebookUserInfo {
  id: string;
  name: string;
  picture: { data: { url: string; width: number; height: number; is_silhouette: boolean } };
}
