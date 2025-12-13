import { throttle } from '@shware/utils';
import { useEffect, useRef } from 'react';
import { config } from '../setup/index';
import { session } from '../setup/session';
import { sendBeacon, track } from '../track/index';
import { usePrevious } from './use-previous';

function sendFirstVisit(pathname: string) {
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
}

function sendUserEngagement() {
  const engagement_time_msec = session.flush();
  if (engagement_time_msec <= 0) return;
  sendBeacon('user_engagement', { engagement_time_msec });
}

function sendScroll() {
  const engagement_time_msec = session.flush();
  if (engagement_time_msec <= 0) return;
  track('scroll', { engagement_time_msec }, { enableThirdPartyTracking: false });
}

function getScrollPercent() {
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const windowHeight = window.innerHeight;
  const docHeight = document.documentElement.scrollHeight;
  if (docHeight === 0) return 0;
  return ((scrollTop + windowHeight) * 100) / docHeight;
}

function onPageHide() {
  session.pagehide();
  sendUserEngagement();
}

function onVisibilityChange() {
  session.visibilitychange(document.visibilityState);
  if (document.visibilityState === 'hidden') {
    sendUserEngagement();
  }
}

/**
 * 1. send session_start event when the page is loaded
 * 2. send scroll event when the user scrolls more than 90% of the page
 * 3. send user_engagement event when the page is hidden or the user is not focused
 */
export function useWebAnalytics(pathname: string) {
  const prevPathname = usePrevious(pathname);

  // reset state when the pathname changes and send scroll when the user navigates to a new page
  const hasSendScroll = useRef(false);
  useEffect(() => {
    hasSendScroll.current = false;
  }, [pathname]);

  useEffect(() => {
    sendFirstVisit(pathname);
    track('session_start', undefined, { enableThirdPartyTracking: false });

    const onScroll = throttle(() => {
      session.updateAccumulator();
      if (hasSendScroll.current) return;
      // only send scroll when the user has scrolled more than 90% of the page
      if (getScrollPercent() < 90) return;
      hasSendScroll.current = true;
      sendScroll();
    }, 500);

    const checkpointEvents = ['mousedown', 'keydown', 'touchstart'];
    const checkpoint = throttle(session.updateAccumulator, 1000);

    window.addEventListener('focus', session.focus, { passive: true });
    window.addEventListener('blur', session.blur, { passive: true });
    window.addEventListener('pageshow', session.pageshow, { passive: true });
    window.addEventListener('pagehide', onPageHide, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });

    // save checkpoint
    checkpointEvents.forEach((event) => {
      window.addEventListener(event, checkpoint, { passive: true, capture: true });
    });

    return () => {
      window.removeEventListener('focus', session.focus);
      window.removeEventListener('blur', session.blur);
      window.removeEventListener('pageshow', session.pageshow);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibilityChange);

      checkpointEvents.forEach((event) => {
        window.removeEventListener(event, checkpoint);
      });

      onScroll.cancel();
      checkpoint.cancel();
    };
  }, []);

  useEffect(() => {
    const properties = {
      page_path: pathname,
      page_title: document.title,
      page_referrer: document.referrer,
      page_location: window.location.href,
      previous_page_path: prevPathname ?? undefined,
      engagement_time_msec: prevPathname ? session.flush() : undefined,
    };

    track('page_view', properties, { enableThirdPartyTracking: false });
  }, [pathname]);
}
