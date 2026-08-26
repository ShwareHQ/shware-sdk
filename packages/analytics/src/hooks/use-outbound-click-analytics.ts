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
      if (!anchor?.href) return;

      try {
        const url = new URL(anchor.href, window.location.origin);

        // Check if it's an external link (different hostname)
        if (url.hostname !== window.location.hostname) {
          track('click', {
            outbound: true,
            link_id: anchor.id || '',
            link_url: anchor.href,
            // An anchor can wrap a whole card, so its text runs to kilobytes of markup content
            // that no report ever looks at. 100 characters is what GA4 keeps of a text event
            // parameter, and the transport limit is well above it either way.
            link_text: anchor.textContent.trim().slice(0, 512),
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
