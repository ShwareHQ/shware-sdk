import type { CredentialResponse, GoogleAccounts, PromptMomentNotification } from './types';

declare global {
  interface Window {
    google: {
      accounts: GoogleAccounts;
    };
  }
}

export type Props = {
  client_id: string;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  use_fedcm_for_prompt?: boolean;
};

export type PromptMoment = {
  skipped: boolean;
  dismissed: boolean;
  momentType: ReturnType<PromptMomentNotification['getMomentType']>;
  dismissedReason: ReturnType<PromptMomentNotification['getDismissedReason']>;
};

export type PromptResult =
  | { authorized: true; credential: CredentialResponse }
  | { authorized: false; moment: PromptMoment };

let script: HTMLScriptElement | null = null;

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (script) {
      if (window.google?.accounts?.id) {
        resolve();
      } else {
        script.addEventListener('load', () => resolve());
        script.addEventListener('error', () =>
          reject(new Error('Failed to load Google One Tap script'))
        );
      }
      return;
    }

    script = document.createElement('script');
    script.id = 'google-one-tap';
    script.async = true;
    script.defer = true;
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google One Tap script'));

    document.head.appendChild(script);
  });
}

/** debug: chrome://settings/content/federatedIdentityApi */
export async function prompt({
  client_id,
  auto_select = false,
  use_fedcm_for_prompt = true,
  cancel_on_tap_outside = false,
}: Props): Promise<PromptResult> {
  await loadScript();

  return new Promise<PromptResult>((resolve) => {
    let settled = false;

    window.google.accounts.id.initialize({
      ux_mode: 'popup',
      context: 'signin',
      auto_select,
      client_id,
      use_fedcm_for_prompt,
      cancel_on_tap_outside,
      callback: (credential) => {
        if (settled) return;
        settled = true;
        resolve({ authorized: true, credential });
      },
      native_callback: (credential) => {
        if (settled) return;
        settled = true;
        resolve({ authorized: true, credential });
      },
    });

    window.google.accounts.id.prompt((notification) => {
      if (settled) return;

      if (
        notification.isSkippedMoment() ||
        (notification.isDismissedMoment() &&
          notification.getDismissedReason() !== 'credential_returned')
      ) {
        settled = true;
        resolve({
          authorized: false,
          moment: {
            momentType: notification.getMomentType(),
            skipped: notification.isSkippedMoment(),
            dismissed: notification.isDismissedMoment(),
            dismissedReason: notification.getDismissedReason(),
          },
        });
      }
    });
  });
}
