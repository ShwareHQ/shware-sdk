import { invariant } from '@shware/utils';
import { object, optional, string } from 'zod/v4-mini';
import { OAuth2Error } from './error';
import type {
  AuthorizationResponse,
  ClientSecret,
  NativeClient,
  NativeCredential,
  OAuth2ClientConfig,
  OAuth2Token,
  OidcToken,
  OneTapProvider,
  PkceParameters,
  Provider,
  ProviderConfig,
  WebClient,
} from './types';

export const oauth2RedirectQuerySchema = object({
  code: optional(string()),
  state: optional(string()),
  error: optional(string()),
  error_description: optional(string()),
  error_uri: optional(string()),
  // Apple's form_post: the user's name as JSON, first authorization only.
  user: optional(string()),
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
  private readonly config: OAuth2ClientConfig;
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

  /** The provider key comes from the request path, so an unknown one is the caller's error. */
  private async getProviderConfig(provider: string): Promise<ProviderConfig> {
    const providers =
      typeof this.config.providers === 'function'
        ? await this.config.providers()
        : this.config.providers;
    const config = Object.hasOwn(providers, provider) ? providers[provider] : undefined;
    if (!config) throw new OAuth2Error(400, 'invalid_request', `Unknown provider: ${provider}`);
    return config;
  }

  private defaultRedirectUri(provider: string) {
    return `${this.config.baseUri}/login/oauth2/code/${provider}`;
  }

  /** The redirect flow and One Tap sign in as the provider's web client. */
  private async getWebClient(provider: string) {
    const config = await this.getProviderConfig(provider);
    if (!config.web) {
      throw new OAuth2Error(400, 'invalid_request', `Provider ${provider} has no web client`);
    }
    return { implementation: config.provider, client: config.web };
  }

  /**
   * Any configured client of the provider, looked up by id: refresh and revoke use the client a
   * token was issued to, and the native login the one the app names. The web client counts too:
   * an Android app's server auth code and a Facebook app's tokens are issued to it.
   */
  private async getClient(provider: string, clientId: string) {
    const config = await this.getProviderConfig(provider);
    const client = [config.web, ...(config.native ?? [])].find((c) => c?.clientId === clientId);
    if (!client) {
      throw new OAuth2Error(400, 'invalid_client', `${clientId} is not a client of ${provider}`);
    }
    return { implementation: config.provider, client };
  }

  /**
   * The client a native login signs in as: the one the app names with `client_id`, which must be
   * configured; without one, the only native client, or the web client when there is no native
   * one. Several native clients and no `client_id` is ambiguous and refused rather than guessed.
   */
  private async getNativeClient(provider: string, clientId: string | undefined) {
    if (clientId !== undefined) return this.getClient(provider, clientId);
    const config = await this.getProviderConfig(provider);
    const native = config.native ?? [];
    const client: WebClient | NativeClient | undefined =
      native.length === 0 ? config.web : native.length === 1 ? native[0] : undefined;
    if (!client) {
      throw new OAuth2Error(400, 'invalid_request', `client_id is required for ${provider}`);
    }
    return { implementation: config.provider, client };
  }

  private async resolveSecret(secret: ClientSecret | undefined, clientId: string) {
    return typeof secret === 'function' ? secret(clientId) : secret;
  }

  async createAuthorizationUri({
    provider,
    state,
    pkce,
  }: {
    provider: string;
    state: string;
    pkce?: PkceParameters;
  }): Promise<URL> {
    const { implementation, client } = await this.getWebClient(provider);
    return implementation.createAuthorizationUri({
      pkce,
      state,
      scope: client.scope,
      clientId: client.clientId,
      redirectUri: client.redirectUri ?? this.defaultRedirectUri(provider),
    });
  }

  /** Exchanges a code issued to the provider's web client: the redirect flow and One Tap. */
  async exchangeAuthorizationCode({
    provider,
    code,
    pkce,
  }: {
    provider: string;
    code: string;
    pkce?: PkceParameters;
  }): Promise<{ clientId: string; token: OAuth2Token }> {
    const { implementation, client } = await this.getWebClient(provider);
    const { clientId } = client;
    const token = await implementation.exchangeAuthorizationCode({
      code,
      pkce,
      clientId,
      clientSecret: await this.resolveSecret(client.clientSecret, clientId),
      redirectUri: client.redirectUri ?? this.defaultRedirectUri(provider),
    });
    return { clientId, token };
  }

  /** `clientId` is the client the token was issued to, as `exchangeAuthorizationCode` returns it. */
  async getUserInfo({
    provider,
    clientId,
    token,
    response,
  }: {
    provider: string;
    clientId: string;
    token: OAuth2Token | OidcToken;
    response?: AuthorizationResponse;
  }) {
    const { implementation } = await this.getClient(provider, clientId);
    return implementation.getUserInfo(token, { clientId, response });
  }

  /** Verifies a Google One Tap / FedCM credential, which is issued to the web client. */
  async getTokenInfo({ provider, credential }: { provider: string; credential: string }) {
    const { implementation, client } = await this.getWebClient(provider);
    if (!isOneTapProvider(implementation)) {
      throw new OAuth2Error(400, 'invalid_request', `Provider ${provider} has no One Tap`);
    }
    const { clientId } = client;
    return { clientId, ...(await implementation.getTokenInfo(credential, clientId)) };
  }

  async refreshAccessToken({
    provider,
    clientId,
    refreshToken,
  }: {
    provider: string;
    clientId: string;
    refreshToken: string;
  }): Promise<OAuth2Token> {
    const { implementation, client } = await this.getClient(provider, clientId);
    invariant(implementation.refreshAccessToken, 'Provider does not support refreshAccessToken');
    const clientSecret = await this.resolveSecret(client.clientSecret, clientId);
    return implementation.refreshAccessToken({ refreshToken, clientId, clientSecret });
  }

  async revokeToken({
    provider,
    clientId,
    token,
  }: {
    provider: string;
    clientId: string;
    token: string;
  }) {
    const { implementation, client } = await this.getClient(provider, clientId);
    invariant(implementation.revokeToken, 'Provider does not support revokeToken');
    const clientSecret = await this.resolveSecret(client.clientSecret, clientId);
    await implementation.revokeToken({ token, clientId, clientSecret });
  }

  async loginOAuth2Native({
    provider,
    credentials,
    pkce,
  }: {
    provider: string;
    credentials: NativeCredential;
    pkce?: PkceParameters;
  }) {
    const { implementation, client } = await this.getNativeClient(provider, credentials.client_id);
    invariant(implementation.loginOAuth2Native, 'Provider does not support loginOAuth2Native');
    const { clientId } = client;

    const result = await implementation.loginOAuth2Native({
      clientId,
      clientSecret: await this.resolveSecret(client.clientSecret, clientId),
      redirectUri: client.redirectUri ?? this.defaultRedirectUri(provider),
      credentials,
      pkce,
    });
    return { clientId, ...result };
  }
}

function isOneTapProvider(provider: Provider): provider is OneTapProvider {
  return typeof (provider as Partial<OneTapProvider>).getTokenInfo === 'function';
}
