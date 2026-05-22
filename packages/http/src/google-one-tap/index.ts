import type {
  ClientConfigError,
  CodeResponse,
  CredentialResponse,
  GoogleAccounts,
  PromptMomentNotification,
} from './types';

declare global {
  interface Window {
    google: {
      accounts: GoogleAccounts;
    };
  }
}

export type Props = {
  /**
   * Opaque nonce string forwarded as-is to Google. Google echoes it back in
   * the ID Token's `nonce` claim per the OIDC spec; the caller is responsible
   * for any hashing/encoding required by its verifier.
   */
  nonce?: string;
  client_id: string;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  use_fedcm_for_prompt?: boolean;
};

export type PromptMoment = {
  skipped: boolean;
  dismissed: boolean;
  dismissedReason: ReturnType<PromptMomentNotification['getDismissedReason']>;
};

/**
 * Why prompt() could not run One Tap, so the caller can decide to fall back
 * to requestCode().
 * - `fedcm_unsupported`: browser has no FedCM (Safari/Firefox/pre-117 Chrome).
 * - `script_load_failed`: the GSI script failed to load (network/CSP).
 * - `prompt_error`: GIS threw synchronously while initializing/prompting.
 */
export type UnsupportedReason = 'fedcm_unsupported' | 'script_load_failed' | 'prompt_error';

export type PromptResult =
  | { authorized: true; credential: CredentialResponse }
  | { authorized: false; moment: PromptMoment }
  | { authorized: false; unsupported: true; reason: UnsupportedReason };

let script: HTMLScriptElement | null = null;

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (script) {
      if (window.google?.accounts?.id) {
        resolve();
      } else {
        script.addEventListener('load', () => resolve());
        script.addEventListener('error', () => {
          script = null; // allow a later call to recreate the element instead of hanging
          reject(new Error('Failed to load Google One Tap script'));
        });
      }
      return;
    }

    script = document.createElement('script');
    script.id = 'google-one-tap';
    script.async = true;
    script.defer = true;
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = () => resolve();
    script.onerror = () => {
      script = null; // allow a later call to recreate the element instead of hanging
      reject(new Error('Failed to load Google One Tap script'));
    };

    document.head.appendChild(script);
  });
}

/** FedCM feature detection — `IdentityCredential` is absent on Safari, Firefox and pre-117 Chrome. */
function isFedcmSupported(): boolean {
  return typeof window !== 'undefined' && 'IdentityCredential' in window;
}

/** debug: chrome://settings/content/federatedIdentityApi */
export async function prompt({
  nonce,
  client_id,
  auto_select = false,
  use_fedcm_for_prompt = true,
  cancel_on_tap_outside = false,
}: Props): Promise<PromptResult> {
  // FedCM is mandatory for One Tap on capable browsers (GIS completed the
  // migration in early 2025) and there is no viable legacy fallback anymore.
  // When the caller wants FedCM but the browser lacks it, bail early instead
  // of letting GIS throw an async `NotSupportedError: Missing request type`
  // from navigator.credentials.get. Callers should fall back to requestCode().
  if (use_fedcm_for_prompt !== false && !isFedcmSupported()) {
    return { authorized: false, unsupported: true, reason: 'fedcm_unsupported' };
  }

  try {
    await loadScript();
  } catch {
    return { authorized: false, unsupported: true, reason: 'script_load_failed' };
  }

  return new Promise<PromptResult>((resolve) => {
    let settled = false;
    const settle = (result: PromptResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      window.google.accounts.id.initialize({
        ux_mode: 'popup',
        context: 'signin',
        auto_select,
        nonce,
        client_id,
        use_fedcm_for_prompt,
        cancel_on_tap_outside,
        callback: (credential) => settle({ authorized: true, credential }),
        native_callback: (credential) => settle({ authorized: true, credential }),
      });

      window.google.accounts.id.prompt((notification) => {
        if (settled) return;

        const skipped = notification.isSkippedMoment();
        const dismissed = notification.isDismissedMoment();
        const dismissedReason = notification.getDismissedReason();

        if (skipped || (dismissed && dismissedReason !== 'credential_returned')) {
          settle({
            authorized: false,
            moment: { skipped, dismissed, dismissedReason },
          });
        }
      });
    } catch {
      settle({ authorized: false, unsupported: true, reason: 'prompt_error' });
    }
  });
}

export type CodeProps = {
  client_id: string;
  /**
   * Space-delimited OAuth scopes. Defaults to OpenID Connect scopes so the
   * backend can exchange the code for an ID token, mirroring One Tap's intent.
   */
  scope?: string;
  /** 'popup' resolves the returned promise; 'redirect' navigates away and never resolves. */
  ux_mode?: 'popup' | 'redirect';
  /** Required when ux_mode is 'redirect'; for 'popup' Google uses postMessage. */
  redirect_uri?: string;
  state?: string;
  login_hint?: string;
  hd?: string;
};

export type CodeResult =
  | { ok: true; response: CodeResponse }
  | { ok: false; error: ClientConfigError | CodeResponse };

/**
 * OAuth 2.0 authorization-code fallback for environments where One Tap / FedCM
 * is unavailable (i.e. prompt() resolved with `unsupported: true`). It reuses
 * the same GSI script, so there is no extra dependency.
 *
 * Unlike One Tap it returns an authorization `code` for the backend to
 * exchange, not an ID token, and it must be triggered by a user gesture or the
 * popup may be blocked.
 */
export async function requestCode({
  client_id,
  scope = 'openid email profile',
  ux_mode = 'popup',
  redirect_uri,
  state,
  login_hint,
  hd,
}: CodeProps): Promise<CodeResult> {
  await loadScript();

  return new Promise<CodeResult>((resolve) => {
    let settled = false;
    const settle = (result: CodeResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const client = window.google.accounts.oauth2.initCodeClient({
      client_id,
      scope,
      ux_mode,
      redirect_uri,
      state,
      login_hint,
      hd,
      callback: (response) =>
        settle(response.code ? { ok: true, response } : { ok: false, error: response }),
      error_callback: (error) => settle({ ok: false, error }),
    });

    client.requestCode();
  });
}
