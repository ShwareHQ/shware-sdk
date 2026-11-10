import { useEffect } from 'react';
import { track } from '../track/index';

/**
 * The registrable domain (eTLD+1) of `hostname`, found the way gtag's `cookie_domain: 'auto'`
 * finds it: a cookie is tried on each suffix from the shortest up, and the first one the browser
 * accepts is the domain — browsers refuse public suffixes (`com`, `co.uk`), so no suffix list is
 * needed (gtag's `cookie_domain: 'auto'` walks the same list). A hostname without dots
 * (`localhost`) or one no suffix accepts (an IP address) is its own domain, as a host-only cookie
 * would be. `probe` tries one suffix and says whether the cookie stuck.
 */
export function registrableDomain(
  hostname: string,
  probe: (domain: string) => boolean = canSetCookieOn
): string {
  const labels = hostname.split('.');
  if (labels.length < 2 || /^[\d.]+$/.test(hostname)) return hostname;
  for (let i = labels.length - 2; i >= 0; i -= 1) {
    const candidate = labels.slice(i).join('.');
    if (probe(candidate)) return candidate;
  }
  return hostname;
}

/**
 * Whether the browser accepts a cookie for `domain`, read back by a value made for this one probe:
 * a cookie of the same name the site already holds can then neither pass the check for a refused
 * suffix nor hide the probe (gtag writes its real cookie this way and keeps it; this one is a
 * throwaway, deleted at once).
 */
function canSetCookieOn(domain: string): boolean {
  const name = '_sa_d';
  const value = Math.random().toString(36).slice(2);
  try {
    document.cookie = `${name}=${value}; domain=${domain}; path=/; SameSite=Lax`;
    const stuck = document.cookie.split('; ').includes(`${name}=${value}`);
    if (stuck) document.cookie = `${name}=; domain=${domain}; path=/; max-age=0; SameSite=Lax`;
    return stuck;
  } catch {
    return false;
  }
}

/**
 * Whether a link leads away from the site, by GA4's definition of an outbound click: an http(s)
 * link to a host that is not the site's registrable domain or a subdomain of it. `mailto:`,
 * `tel:` and the like are not outbound clicks (GA4 never counts them), and `www.` → `app.` is
 * not leaving the site.
 */
export function isOutboundLink(url: URL, siteDomain: string): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname;
  return host !== siteDomain && !host.endsWith(`.${siteDomain}`);
}

/**
 * Tracks outbound link clicks - when a user clicks a link that leads away from the site to
 * another website (see `isOutboundLink`).
 */
export function useOutboundClickAnalytics() {
  useEffect(() => {
    const siteDomain = registrableDomain(window.location.hostname);
    const onClick = (event: MouseEvent) => {
      // Find the closest anchor element from the clicked target
      const target = event.target as HTMLElement;
      const anchor = target.closest('a');
      if (!anchor?.href) return;

      try {
        const url = new URL(anchor.href, window.location.origin);
        if (!isOutboundLink(url, siteDomain)) return;
        track('click', {
          outbound: true,
          link_id: anchor.id || '',
          link_url: anchor.href,
          // An anchor can wrap a whole card, so its text runs to kilobytes of markup content
          // that no report ever looks at. GA4 keeps 100 characters of a text event parameter;
          // 512 leaves room for the whole label of a long button while staying well under the
          // transport limit.
          link_text: anchor.textContent.trim().slice(0, 512),
          link_domain: url.hostname,
          link_classes: anchor.className || '',
        });
      } catch {
        // Invalid URL, ignore
      }
    };

    document.addEventListener('click', onClick, { passive: true, capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  }, []);
}
