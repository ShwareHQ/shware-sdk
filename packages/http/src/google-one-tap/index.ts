import type { GoogleAccounts, CredentialResponse } from './types';

declare global {
  interface Window {
    google: {
      accounts: GoogleAccounts;
    };
  }
}

export type Props = {
  clientId: string;
  callback: (response: CredentialResponse) => void | Promise<void>;
};

/** debug: chrome://settings/content/federatedIdentityApi */
export function prompt({ clientId, callback }: Props) {
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
      auto_select: false,
      client_id: clientId,
      use_fedcm_for_prompt: true,
      cancel_on_tap_outside: false,
      callback,
    });
    window.google?.accounts?.id?.prompt();
  };

  document.head.appendChild(script);
}
