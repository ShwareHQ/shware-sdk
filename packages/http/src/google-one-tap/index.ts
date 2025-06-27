import { useEffect, useRef, useState } from 'react';
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
export function useGoogleOneTap({ clientId, callback }: Props) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(callback);
  ref.current = callback;

  useEffect(() => {
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
        callback: ref.current,
      });
      setLoaded(true);
    };

    document.head.appendChild(script);

    return () => {
      setLoaded(false);
      script.remove();
    };
  }, [clientId]);

  return {
    loaded,
    prompt: () => window.google?.accounts?.id?.prompt(),
    cancel: () => window.google?.accounts?.id?.cancel(),
  };
}
