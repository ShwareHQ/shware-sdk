interface CreateAuthorizationUriParams {
  state: string;
  clientId: string;
  redirectUri: string;
  scope: string[] | undefined;
  codeVerifier?: string;
}

export interface CodeExchangeParams {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface RefreshTokenParams {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface RevokeTokenParams {
  token: string;
  clientId: string;
  clientSecret: string;
}

export interface OAuth2Token {
  access_token?: string;
  token_type?: 'Bearer' | 'bearer' | string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

// https://openid.net/specs/openid-connect-core-1_0.html#StandardClaims
export interface StandardClaims {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  middle_name?: string;
  nickname?: string;
  preferred_username?: string;
  profile?: string;
  picture?: string;
  website?: string;
  email?: string;
  email_verified?: boolean;
  gender?: 'female' | 'male' | string;
  birthdate?: string; // ISO 8601-1 [ISO8601‑1] YYYY-MM-DD format.
  zoneinfo?: string; // IANA Time Zone Database [IANA.time‑zones]
  locale?: string; // BCP47 [RFC5646] language tag.
  phone_number?: string; // E.164
  phone_number_verified?: boolean;
  address?: {
    formatted: string;
    street_address: string;
    locality: string;
    region: string;
    postal_code: string;
    country: string;
  }; // [RFC8259] JSON object
  updated_at?: number;
}

export interface Provider<T extends Record<string, any> = Record<string, any>> {
  /** Authorization URI for the provider. */
  authorizationUri: string;

  /** Token URI for the provider. */
  tokenUri: string;

  tokenRevokeUri?: string;

  /** User info URI for the provider. */
  userInfoUri?: string;

  /** User info authentication method for the provider. */
  userInfoAuthenticationMethod?: string;

  /**
   * Name of the attribute that will be used to extract the username from the call to 'userInfoUri'.
   * */
  userNameAttribute?: string;

  /** JWK set URI for the provider */
  jwkSetUri?: string;

  /**
   * URI that can either be an OpenID Connect discovery endpoint or an OAuth 2.0 Authorization
   * Server Metadata endpoint defined by RFC 8414.
   * */
  issuerUri?: string;

  /** Default scopes for the provider. */
  defaultScope: string[];

  /** step 1: generate authorization uri and redirect user to it */
  createAuthorizationUri: (params: CreateAuthorizationUriParams) => URL;

  /** step 2: exchange code for token */
  exchangeAuthorizationCode: (params: CodeExchangeParams) => Promise<OAuth2Token>;

  /** step 3: get user info */
  getUserInfo: (token: OAuth2Token) => Promise<{ claims: StandardClaims; data: T }>;

  /** others: refresh access token */
  refreshAccessToken?: (params: RefreshTokenParams) => Promise<OAuth2Token>;

  /** others: revoke token */
  revokeToken?: (params: RevokeTokenParams) => Promise<void>;
}

export interface Registration {
  /**
   * Reference to the OAuth 2.0 provider to use. May reference an element from the 'provider'
   * property or used one of the commonly used providers (google, github, facebook, okta).
   * */
  provider?: string;

  /** Client ID for the registration. */
  clientId: string;

  /** Client secret of the registration. */
  clientSecret: string;

  /** Client authentication method. May be left blank when using a pre-defined provider. */
  clientAuthenticationMethod?: string;

  /** Authorization grant type. May be left blank when using a pre-defined provider. */
  authorizationGrantType?:
    | 'authorization_code' // default
    | 'client_credentials'
    | 'device_code'
    | 'jwt_bearer'
    // Deprecated. The latest OAuth 2.0 Security Best Current Practice disallows the use of the
    // Resource Owner Password Credentials grant.
    | 'password'
    | 'refresh_token'
    | 'token_exchange';

  /** Redirect URI. May be left blank when using a pre-defined provider. */
  redirectUri?: string;

  /** Authorization scopes. When left blank the provider's default scopes, if any, will be used. */
  scope?: string[];

  /** Client name. May be left blank when using a pre-defined provider. */
  clientName?: string;
}

export interface OAuth2ClientConfig {
  baseUri: string;
  errorUri: string;
  provider: { [name: string]: Provider | undefined };
  registration: { [name: string]: Registration | undefined };
}
