import type { CredentialResponse, GoogleAccounts } from './types';

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
  callback: (response: CredentialResponse) => void | Promise<void>;
};

/** debug: chrome://settings/content/federatedIdentityApi */
export function prompt({
  client_id,
  auto_select = false,
  use_fedcm_for_prompt = true,
  cancel_on_tap_outside = false,
  callback,
}: Props) {
  const scriptId = 'google-one-tap';
  const script = document.createElement('script');
  script.id = scriptId;
  script.async = true;
  script.defer = true;
  script.src = 'https://accounts.google.com/gsi/client';
  script.onload = () => {
    window.google.accounts.id.initialize({
      ux_mode: 'popup',
      context: 'signin',
      auto_select,
      client_id,
      use_fedcm_for_prompt,
      cancel_on_tap_outside,
      callback,
      native_callback: callback,
    });
    window.google?.accounts?.id?.prompt();
  };

  document.head.appendChild(script);
}
