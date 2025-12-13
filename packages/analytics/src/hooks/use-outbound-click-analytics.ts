import { useEffect } from 'react';
import { track } from '../track/index';

/**
 * Tracks outbound link clicks - when a user clicks a link that leads away
 * from the current domain to another website.
 */
export function useOutboundClickAnalytics() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // Find the closest anchor element from the clicked target
      const target = event.target as HTMLElement;
      const anchor = target.closest('a');
      if (!anchor || !anchor.href) return;

      try {
        const url = new URL(anchor.href, window.location.origin);

        // Check if it's an external link (different hostname)
        if (url.hostname !== window.location.hostname) {
          track('click', {
            outbound: true,
            link_id: anchor.id || '',
            link_url: anchor.href,
            link_text: anchor.textContent?.trim() || '',
            link_domain: url.hostname,
            link_classes: anchor.className || '',
          });
        }
      } catch {
        // Invalid URL, ignore
      }
    };

    document.addEventListener('click', onClick, { passive: true, capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  }, []);
}
