import { useEffect, useRef } from 'react';
import { track } from '../track/index';
import { usePrevious } from './use-previous';

export function usePageViewAnalytics(pathname: string) {
  const prevPathname = usePrevious(pathname);
  const session = useRef({ start: performance.now(), total: 0, isActive: true });

  useEffect(() => {
    const handler = () => {
      if (document.hidden) {
        session.current.total += (performance.now() - session.current.start) / 1000;
        session.current.isActive = false;
      } else {
        session.current.start = performance.now();
        session.current.isActive = true;
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  useEffect(() => {
    if (!prevPathname) {
      session.current = { start: performance.now(), total: 0, isActive: true };
    }

    let duration = session.current.total;
    if (session.current.isActive) {
      duration += (performance.now() - session.current.start) / 1000;
    }

    const properties = {
      pathname,
      referrer: document.referrer,
      previous_pathname: prevPathname ?? undefined,
      previous_pathname_duration: prevPathname ? Number(duration.toFixed(2)) : undefined,
    };

    track('page_view', properties, { enableThirdPartyTracking: false });

    // reset session
    session.current = { start: performance.now(), total: 0, isActive: true };
  }, [pathname]);
}
