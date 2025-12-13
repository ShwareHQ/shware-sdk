import { useEffect, useRef } from 'react';
import { config } from '../setup/index';
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

  // send first_visit event when the page is loaded
  useEffect(() => {
    const key = 'first_visit_time';
    if (config.storage.getItem(key)) return;
    const properties = {
      page_path: pathname,
      page_title: document.title,
      page_referrer: document.referrer,
      page_location: window.location.href,
    };
    track('first_visit', properties, { enableThirdPartyTracking: false });
    config.storage.setItem(key, new Date().toISOString());
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
      page_path: pathname,
      page_title: document.title,
      page_referrer: document.referrer,
      page_location: window.location.href,
      previous_page_path: prevPathname ?? undefined,
      previous_page_path_duration: prevPathname ? Number(duration.toFixed(2)) : undefined,
    };

    track('page_view', properties, { enableThirdPartyTracking: false });

    // reset session
    session.current = { start: performance.now(), total: 0, isActive: true };
  }, [pathname]);
}
