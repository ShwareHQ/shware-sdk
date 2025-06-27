interface ClientConfigError extends Error {
  message: string;
  stack?: string;
  type: 'unknown' | 'popup_closed' | 'popup_failed_to_open';
}

interface OverridableTokenClientConfig {
  scope?: string;
  include_granted_scopes?: boolean;
  prompt?: string;
  enable_granular_consent?: boolean;
  enable_serial_consent?: boolean;
  login_hint?: string;
  hint?: string;
  state?: string;
}

interface TokenClient {
  requestAccessToken: (overrideConfig?: OverridableTokenClientConfig) => void;
}

interface CodeClient {
  requestCode: () => void;
}

interface TokenResponse {
  access_token: string;
  expires_in: string;
  hd: string;
  prompt: string;
  token_type: string;
  scope: string;
  state: string;
  error: string;
  error_description: string;
  error_uri: string;
}

interface CodeResponse {
  code: string;
  scope: string;
  state: string;
  error: string;
  error_description: string;
  error_uri: string;
}

interface TokenClientConfig {
  client_id: string;
  scope: string;
  include_granted_scopes?: boolean;
  prompt?: '' | 'none' | 'consent' | 'select_account';
  enable_granular_consent?: boolean;
  enable_serial_consent?: boolean;
  login_hint?: string;
  hint?: string;
  hd?: string;
  hosted_domain?: string;
  state?: string;
  callback: (tokenResponse: TokenResponse) => void;
  error_callback?: (error: ClientConfigError) => void;
}

interface CodeClientConfig {
  client_id: string;
  scope: string;
  include_granted_scopes?: boolean;
  redirect_uri?: string;
  state?: string;
  enable_granular_consent?: boolean;
  enable_serial_consent?: boolean;
  login_hint?: string;
  hint?: string;
  hd?: string;
  hosted_domain?: string;
  ux_mode?: 'popup' | 'redirect';
  select_account?: boolean;
  callback?: (response: CodeResponse) => void;
  error_callback?: (error: ClientConfigError) => void;
}

interface RevocationResponse {
  successful: boolean;
  error?: string;
}

interface Credential {
  id: string;
  password: string;
}

export interface CredentialResponse {
  credential: string;
  select_by: string;
}

export interface IdConfiguration {
  client_id: string;
  auto_select?: boolean;
  login_uri?: string;
  cancel_on_tap_outside?: boolean;
  prompt_parent_id?: string;
  nonce?: string;
  context?: 'signin' | 'signup' | 'use';
  state_cookie_domain?: string;
  ux_mode?: 'popup' | 'redirect';
  allowed_parent_origin?: string | string[];
  itp_support?: boolean;
  login_hint?: string;
  hd?: string;
  use_fedcm_for_prompt?: boolean;
  callback?: (response: CredentialResponse) => void;
  native_callback?: (response: CredentialResponse) => void;
  intermediate_iframe_close_callback?: () => void;
}
/**
 * ref: https://developers.google.com/identity/gsi/web/guides/fedcm-migration?s=dc&utm_source=devtools&utm_campaign=stable#display_moment
 */
export interface PromptMomentNotification {
  /** @deprecated */
  isDisplayMoment(): boolean;

  /** @deprecated */
  isDisplayed(): boolean;

  /** @deprecated */
  isNotDisplayed(): boolean;

  /** @deprecated */
  getNotDisplayedReason():
    | 'browser_not_supported'
    | 'invalid_client'
    | 'missing_client_id'
    | 'opt_out_or_no_session'
    | 'secure_http_required'
    | 'suppressed_by_user'
    | 'unregistered_origin'
    | 'unknown_reason';

  /** @deprecated */
  getSkippedReason(): 'auto_cancel' | 'user_cancel' | 'tap_outside' | 'issuing_failed';

  isSkippedMoment(): boolean;
  isDismissedMoment(): boolean;
  getDismissedReason(): 'credential_returned' | 'cancel_called' | 'flow_restarted';
  getMomentType(): 'display' | 'skipped' | 'dismissed';
}

interface GsiButtonConfiguration {
  type: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'small' | 'medium' | 'large';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: number;
  locale?: string;
  state?: string;
  click_listener?: () => void;
}

export interface GoogleAccounts {
  oauth2: {
    initCodeClient(config: CodeClientConfig): CodeClient;
    initTokenClient(config: TokenClientConfig): TokenClient;
    hasGrantedAllScopes(
      tokenResponse: TokenResponse,
      firstScope: string,
      ...restScopes: string[]
    ): boolean;
    hasGrantedAnyScope(
      tokenResponse: TokenResponse,
      firstScope: string,
      ...restScopes: string[]
    ): boolean;
    revoke(accessToken: string, done: () => void): void;
  };
  id: {
    initialize(idConfig: IdConfiguration): void;
    prompt(momentListener?: (promptMomentNotification: PromptMomentNotification) => void): void;
    renderButton(parent: HTMLElement, options: GsiButtonConfiguration): void;
    disableAutoSelect(): void;
    storeCredential(credential: Credential, callback?: () => void): void;
    cancel(): void;
    revoke(hint: string, callback?: (response: RevocationResponse) => void): void;
  };
}
