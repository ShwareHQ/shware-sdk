import { z } from 'zod';
import invariant from 'tiny-invariant';
import { OAuth2ClientConfig, OAuth2Token } from './types';

export const oauth2RedirectQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
  error_uri: z.string().optional(),
});

export class OAuth2Client {
  private config: OAuth2ClientConfig;
  constructor(config: OAuth2ClientConfig) {
    this.config = config;
  }

  get baseUri() {
    return this.config.baseUri;
  }

  get errorUri() {
    return this.config.errorUri;
  }

  getClientConfig(registrationId: string) {
    const registration = this.config.registration[registrationId];
    invariant(registration, `Registration ${registrationId} not found`);
    const provider = this.config.provider[registration.provider ?? registrationId];
    invariant(provider, `Provider ${registration.provider ?? registrationId} not found`);
    return { registration, provider };
  }

  createAuthorizationUri(registrationId: string, state: string, codeVerifier?: string): URL {
    const { provider, registration } = this.getClientConfig(registrationId);

    const { baseUri } = this.config;
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

    const { baseUri } = this.config;
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
