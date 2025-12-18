import { throttle } from '@shware/utils';
import { useEffect, useRef } from 'react';
import { keys } from '../constants/storage';
import { config } from '../setup/index';
import { session } from '../setup/session';
import { sendBeacon, track } from '../track/index';
import { usePrevious } from './use-previous';

function sendFirstVisit(pathname: string) {
  if (config.storage.getItem(keys.first_visit_time)) return;
  track('first_visit', {
    page_path: pathname,
    page_title: document.title,
    page_referrer: document.referrer,
    page_location: window.location.href,
  });
  config.storage.setItem(keys.first_visit_time, new Date().toISOString());
}

function sendUserEngagement(trigger: 'pagehide' | 'visibilitychange') {
  const engagement_time_msec = session.flush();
  if (engagement_time_msec <= 0) return;
  sendBeacon('user_engagement', { engagement_time_msec, trigger });
}

function sendScroll() {
  const engagement_time_msec = session.flush();
  if (engagement_time_msec <= 0) return;
  track('scroll', { engagement_time_msec });
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
  sendUserEngagement('pagehide');
}

function onVisibilityChange() {
  session.visibilitychange(document.visibilityState);
  if (document.visibilityState === 'hidden') {
    sendUserEngagement('visibilitychange');
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
    track('session_start', undefined);

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

    window.addEventListener('focus', session.focus);
    window.addEventListener('blur', session.blur);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pageshow', session.pageshow);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);

    // save checkpoint
    checkpointEvents.forEach((e) => {
      window.addEventListener(e, checkpoint, { passive: true, capture: true });
    });

    return () => {
      window.removeEventListener('focus', session.focus);
      window.removeEventListener('blur', session.blur);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pageshow', session.pageshow);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      checkpointEvents.forEach((e) => window.removeEventListener(e, checkpoint));

      onScroll.cancel();
      checkpoint.cancel();
    };
  }, []);

  useEffect(() => {
    track('page_view', {
      page_path: pathname,
      page_title: document.title,
      page_referrer: document.referrer,
      page_location: window.location.href,
      previous_page_path: prevPathname ?? undefined,
      engagement_time_msec: prevPathname ? session.flush() : undefined,
    });
  }, [pathname]);
}
