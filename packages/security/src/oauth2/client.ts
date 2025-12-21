import { invariant } from '@shware/utils';
import { object, optional, string } from 'zod/v4-mini';
import {
  NativeCredential,
  OAuth2ClientConfig,
  OAuth2Token,
  OidcToken,
  PkceParameters,
} from './types';

export const oauth2RedirectQuerySchema = object({
  code: optional(string()),
  state: optional(string()),
  error: optional(string()),
  error_description: optional(string()),
  error_uri: optional(string()),
});

export const googleOneTapSchema = object({
  // login_uri
  code: optional(string()),
  state: optional(string()),
  error: optional(string()),
  error_description: optional(string()),
  error_uri: optional(string()),
  nonce: optional(string()),
  g_csrf_token: optional(string()),
  hd: optional(string()),
  // callback
  credential: optional(string()),
});

export class OAuth2Client {
  private config: OAuth2ClientConfig;
  constructor(config: OAuth2ClientConfig) {
    this.config = config;
  }

  get baseUri() {
    return this.config.baseUri;
  }

  get successUri() {
    return this.config.successUri;
  }

  get errorUri() {
    return this.config.errorUri;
  }

  private async getClientConfig(registrationId: string) {
    const registrations =
      typeof this.config.registration === 'function'
        ? await this.config.registration()
        : this.config.registration;

    const registration = registrations[registrationId];
    invariant(registration, `Registration ${registrationId} not found`);

    const provider = this.config.provider[registration.provider ?? registrationId];
    invariant(provider, `Provider ${registration.provider ?? registrationId} not found`);
    return { registration, provider };
  }

  async createAuthorizationUri({
    registrationId,
    state,
    pkce,
  }: {
    registrationId: string;
    state: string;
    pkce?: PkceParameters;
  }): Promise<URL> {
    const { provider, registration } = await this.getClientConfig(registrationId);

    const { baseUri } = this.config;
    const { scope, clientId, redirectUri } = registration;
    return provider.createAuthorizationUri({
      pkce,
      state,
      scope,
      clientId,
      redirectUri: redirectUri ?? `${baseUri}/login/oauth2/code/${registrationId}`,
    });
  }

  async exchangeAuthorizationCode({
    registrationId,
    code,
    pkce,
  }: {
    registrationId: string;
    code: string;
    pkce?: PkceParameters;
  }): Promise<OAuth2Token> {
    const { provider, registration } = await this.getClientConfig(registrationId);

    const { baseUri } = this.config;
    const { clientId, clientSecret, redirectUri } = registration;
    return provider.exchangeAuthorizationCode({
      code,
      pkce,
      clientId,
      clientSecret,
      redirectUri: redirectUri ?? `${baseUri}/login/oauth2/code/${registrationId}`,
    });
  }

  async getUserInfo({
    registrationId,
    token,
  }: {
    registrationId: string;
    token: OAuth2Token | OidcToken;
  }) {
    const { provider } = await this.getClientConfig(registrationId);
    return provider.getUserInfo(token);
  }

  async refreshAccessToken({
    registrationId,
    refreshToken,
  }: {
    registrationId: string;
    refreshToken: string;
  }): Promise<OAuth2Token> {
    const { provider, registration } = await this.getClientConfig(registrationId);
    const { clientId, clientSecret } = registration;

    invariant(provider.refreshAccessToken, 'Provider does not support refreshAccessToken');
    return provider.refreshAccessToken({ refreshToken, clientId, clientSecret });
  }

  async revokeToken(registrationId: string, token: string) {
    const { provider, registration } = await this.getClientConfig(registrationId);
    const { clientId, clientSecret } = registration;

    invariant(provider.revokeToken, 'Provider does not support revokeToken');
    await provider.revokeToken({ token, clientId, clientSecret });
  }

  async loginOAuth2Native({
    registrationId,
    credentials,
    pkce,
  }: {
    registrationId: string;
    credentials: NativeCredential;
    pkce?: PkceParameters;
  }) {
    const { provider, registration } = await this.getClientConfig(registrationId);
    invariant(provider.loginOAuth2Native, 'Provider does not support loginOAuth2Native');
    const { baseUri } = this.config;
    const { clientId, clientSecret, redirectUri } = registration;

    return provider.loginOAuth2Native({
      clientId,
      clientSecret,
      redirectUri: redirectUri ?? `${baseUri}/login/oauth2/code/${registrationId}`,
      credentials,
      pkce,
    });
  }
}
