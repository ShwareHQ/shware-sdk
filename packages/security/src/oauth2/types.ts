// reference: https://datatracker.ietf.org/doc/html/rfc7636
export interface PkceParameters {
  code_verifier: string;
  code_challenge: string;
  code_challenge_method: 'S256' | 'plain';
}

export interface OAuth2AuthorizationRequest {
  state: string;
  registrationId: string;
  authorizationRequestUri: string;
  additionalParameters: PkceParameters;
  /**
   * What the host attached when the flow started (`oauth2Authorization` options), kept on the
   * server and handed back to `onAuthorized` once the callback checks out. Never sent to the
   * provider, unlike `additionalParameters`. Absent on requests stored before this field existed.
   */
  attributes?: Record<string, string>;
}

interface CreateAuthorizationUriParams {
  state: string;
  clientId: string;
  redirectUri: string;
  scope: string[] | undefined;
  pkce?: Omit<PkceParameters, 'code_verifier'>;
}

export interface ExchangeCodeParams {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  pkce?: Omit<PkceParameters, 'code_challenge' | 'code_challenge_method'>;
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

export interface LoginOAuth2NativeParams {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  pkce?: PkceParameters;
  credentials: NativeCredential;
}

// reference: https://datatracker.ietf.org/doc/html/rfc6749#section-5.1
export interface OAuth2Token {
  /**
   * REQUIRED.
   * The access token issued by the authorization server.
   */
  access_token: string;

  /**
   * REQUIRED.
   * The type of the token issued as described in Section 7.1.  Value is case insensitive.
   */
  token_type: 'Bearer' | 'bearer' | 'mac' | (string & {});

  /**
   * RECOMMENDED.
   * The lifetime in seconds of the access token. For example, the value "3600" denotes that the
   * access token will expire in one hour from the time the response was generated. If omitted, the
   * authorization server SHOULD provide the expiration time via other means or document the default
   * value.
   */
  expires_in?: number;

  /**
   * OPTIONAL.
   * The refresh token, which can be used to obtain new access tokens using the same authorization
   * grant as described in Section 6.
   */
  refresh_token?: string;

  /**
   * OPTIONAL.
   * If identical to the scope requested by the client; otherwise, REQUIRED. The scope of the
   * access token as described by Section 3.3.
   */
  scope?: string;

  id_token?: string;

  [key: string]: unknown;
}

export interface OidcToken extends OAuth2Token {
  id_token: string;
}

export type NativeCredential = {
  state?: string;
  code?: string;
  client_id?: string;
  redirect_uri?: string;
  id_token?: string;
  access_token?: string;
  /**
   * The user's name as the platform hands it to the app, for providers whose id token carries none
   * (Apple sends it on the first authorization only): iOS
   * `ASAuthorizationAppleIDCredential.fullName`, expo-apple-authentication's `credential.fullName`.
   * The snake_case fields above are OAuth / OIDC protocol parameters; this one is not, it is the
   * platform's object passed through unchanged, so it keeps the platform's own name and apps send
   * `fullName: credential.fullName` as is. Unsigned client input: the provider cleans each part and
   * ignores anything that is not a string. Parts with a standard claim become `given_name`,
   * `family_name`, `middle_name` and `nickname`; `namePrefix` / `nameSuffix` have none and are kept
   * in `userInfo.data.fullName` only.
   */
  fullName?: PersonNameComponents;
};

/** iOS `PersonNameComponents` as JSON; every part may be missing or `null`. */
export interface PersonNameComponents {
  givenName?: string | null;
  familyName?: string | null;
  middleName?: string | null;
  namePrefix?: string | null;
  nameSuffix?: string | null;
  nickname?: string | null;
}

/**
 * Fields of the authorization response besides `code` and `state` that a provider uses to fill in
 * the user info: Apple posts the user's name as `user` (JSON) with the first authorization only,
 * since its id token never carries one. Unsigned, so treated as untrusted input.
 */
export interface AuthorizationResponse {
  user?: string;
}

export const OIDC_SCOPES = [
  'openid',
  'profile',
  'email',
  'phone',
  'address',
  'offline_access',
] as const;

export type OidcScope = (typeof OIDC_SCOPES)[number];

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
  gender?: 'female' | 'male' | (string & {});
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

export interface UserInfo<T = unknown> {
  claims: StandardClaims;
  data: T;
}

export interface Provider {
  /** Authorization URI for the provider. */
  authorizationUri: string;

  /** Token URI for the provider. */
  tokenUri: string;

  /** Token revoke URI for the provider. */
  tokenRevokeUri?: string;

  /** Token refresh URI for the provider. */
  tokenRefreshUri?: string;

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
  exchangeAuthorizationCode: (params: ExchangeCodeParams) => Promise<OAuth2Token>;

  /**
   * step 3: get user info; `response` holds what the authorization response carried besides the
   * code, for the providers that send user data there (Apple).
   */
  getUserInfo: (token: OAuth2Token, response?: AuthorizationResponse) => Promise<UserInfo>;

  /** others: refresh access token */
  refreshAccessToken?: (params: RefreshTokenParams) => Promise<OAuth2Token>;

  /** others: revoke token */
  revokeToken?: (params: RevokeTokenParams) => Promise<void>;

  loginOAuth2Native?: (
    params: LoginOAuth2NativeParams
  ) => Promise<{ token: OAuth2Token; userInfo: UserInfo }>;
}

export interface OneTapProvider extends Provider {
  getTokenInfo: (id_token: string) => Promise<{ token: OAuth2Token; userInfo: UserInfo }>;
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
  successUri: string;
  provider: { [name: string]: Provider | undefined };
  registration:
    | { [name: string]: Registration | undefined }
    | (() => Promise<{ [name: string]: Registration | undefined }>);
}
