import { expiringStorage } from '@shware/utils';
import { useEffect } from 'react';
import { keys } from '../constants/storage';

function setCookie(name: string, value: string, ttlInMs: number) {
  const d = new Date();
  d.setTime(d.getTime() + ttlInMs);
  const expires = `expires=${d.toUTCString()}`;
  document.cookie = `${name}=${value}; ${expires}; path=/; SameSite=Lax; Secure`;
}

// todo: do not set tracking cookies before the user has granted consent where required.
// reference: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc/#3--store-clickid
// reference: https://watsspace.com/blog/meta-conversions-api-fbc-and-fbp-parameters/
export function useClickIdPersistence() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fbclid = params.get('fbclid');
    const rdt_cid = params.get('rdt_cid');

    // common practice ~90 days
    const ttlMs = 90 * 24 * 60 * 60 * 1000;

    if (fbclid) {
      const fbc = `fb.1.${Date.now()}.${fbclid}`;
      setCookie('_fbc', fbc, ttlMs);
      expiringStorage.setItem(keys.fbc, fbc, ttlMs);
    }

    if (rdt_cid) {
      setCookie('_rdt_cid', rdt_cid, ttlMs);
      expiringStorage.setItem(keys.rdt_cid, rdt_cid, ttlMs);
    }
  }, []);
}
