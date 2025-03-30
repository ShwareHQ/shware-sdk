import invariant from 'tiny-invariant';
import { OAuth2ClientConfig, OAuth2Token } from './client';

export interface OAuth2Config {
  client: OAuth2ClientConfig;
}

export class OAuth2 {
  private config: OAuth2Config;
  constructor(config: OAuth2Config) {
    this.config = config;
  }

  get clientBaseUri() {
    return this.config.client.baseUri;
  }

  get clientErrorUri() {
    return this.config.client.errorUri;
  }

  getClientConfig(registrationId: string) {
    const registration = this.config.client.registration[registrationId];
    invariant(registration, `Registration ${registrationId} not found`);
    const provider = this.config.client.provider[registration.provider ?? registrationId];
    invariant(provider, `Provider ${registration.provider ?? registrationId} not found`);
    return { registration, provider };
  }

  createAuthorizationUri(registrationId: string, state: string, codeVerifier?: string): URL {
    const { provider, registration } = this.getClientConfig(registrationId);

    const { baseUri } = this.config.client;
    const { scope, clientId, redirectUri } = registration;
    return provider.createAuthorizationUri({
      state,
      scope,
      clientId,
      codeVerifier,
      redirectUri: redirectUri ?? `${baseUri}/login/oauth2/code/${registrationId}`,
    });
  }

  async exchangeAuthorizationCode(
    registrationId: string,
    code: string,
    codeVerifier?: string
  ): Promise<OAuth2Token> {
    const { provider, registration } = this.getClientConfig(registrationId);

    const { baseUri } = this.config.client;
    const { clientId, clientSecret, redirectUri } = registration;
    return provider.exchangeAuthorizationCode({
      code,
      codeVerifier,
      clientId,
      clientSecret,
      redirectUri: redirectUri ?? `${baseUri}/login/oauth2/code/${registrationId}`,
    });
  }

  async getUserInfo(registrationId: string, token: OAuth2Token) {
    const { provider } = this.getClientConfig(registrationId);
    return provider.getUserInfo(token);
  }

  async refreshAccessToken(registrationId: string, refreshToken: string): Promise<OAuth2Token> {
    const { provider, registration } = this.getClientConfig(registrationId);
    const { clientId, clientSecret } = registration;

    invariant(provider.refreshAccessToken, 'Provider does not support refreshAccessToken');
    return provider.refreshAccessToken({ refreshToken, clientId, clientSecret });
  }

  async revokeToken(registrationId: string, token: string) {
    const { provider, registration } = this.getClientConfig(registrationId);
    const { clientId, clientSecret } = registration;

    invariant(provider.revokeToken, 'Provider does not support revokeToken');
    await provider.revokeToken({ token, clientId, clientSecret });
  }
}
