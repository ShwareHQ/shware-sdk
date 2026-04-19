import { expiringStorage } from '@shware/utils';
import { parseCookie } from 'cookie';
import { useEffect } from 'react';
import { keys } from '../constants/storage';

// common practice ~90 days
const TTL_MS = 90 * 24 * 60 * 60 * 1000;

function setCookie(name: string, value: string, ttlInMs: number) {
  const d = new Date();
  d.setTime(d.getTime() + ttlInMs);
  const expires = `expires=${d.toUTCString()}`;
  document.cookie = `${name}=${value}; ${expires}; path=/; SameSite=Lax; Secure`;
}

/** Extract the raw fbclid portion from a formatted fbc string (fb.1.ts.FBCLID) */
function extractFbclid(fbc: string): string | undefined {
  // fb.<subdomainIndex>.<creationTime>.<fbclid>
  const parts = fbc.split('.');
  return parts.length >= 4 ? parts.slice(3).join('.') : undefined;
}

/**
 * Persist a click-id value across cookie + localStorage.
 * - cookie: readable by third-party SDKs (e.g. Meta Pixel)
 * - localStorage (via expiringStorage): survives Safari ITP JS-cookie caps
 *
 * If only one store has the value, sync it to the other.
 */
function persist(
  cookieName: string,
  storageKey: string,
  cookieValue: string | undefined,
  newValue: string | undefined
) {
  if (newValue) {
    setCookie(cookieName, newValue, TTL_MS);
    expiringStorage.setItem(storageKey, newValue, TTL_MS);
  } else {
    const stored = expiringStorage.getItem<string>(storageKey);
    if (cookieValue && !stored) {
      // cookie → localStorage: back up before ITP wipes the cookie
      expiringStorage.setItem(storageKey, cookieValue, TTL_MS);
    } else if (!cookieValue && stored) {
      // localStorage → cookie: restore so third-party SDKs (Meta Pixel) can read it
      setCookie(cookieName, stored, TTL_MS);
    }
  }
}

// todo: do not set tracking cookies before the user has granted consent where required.
// reference: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc/#3--store-clickid
// reference: https://watsspace.com/blog/meta-conversions-api-fbc-and-fbp-parameters/
export function useClickIdPersistence() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const parsed = parseCookie(document.cookie);

    // --- Meta fbc ---
    const fbclid = params.get('fbclid');
    const existingFbc = parsed._fbc ?? expiringStorage.getItem<string>(keys.fbc);
    // Only build a new fbc if the fbclid actually changed (preserve original creationTime otherwise).
    const fbclidChanged = fbclid && extractFbclid(existingFbc ?? '') !== fbclid;
    const newFbc = fbclidChanged ? `fb.1.${Date.now()}.${fbclid}` : undefined;

    persist('_fbc', keys.fbc, parsed._fbc, newFbc);

    // Also persist raw fbclid so the server-side Conversions API fallback
    // (fbc reconstruction from fbclid) works even after SPA navigation.
    if (fbclid) {
      expiringStorage.setItem(keys.fbclid, fbclid, TTL_MS);
    }

    // --- Reddit rdt_cid ---
    const rdt_cid = params.get('rdt_cid');
    persist('_rdt_cid', keys.rdt_cid, parsed._rdt_cid, rdt_cid ?? undefined);
  }, []);
}
