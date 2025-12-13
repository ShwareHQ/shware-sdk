/**
 * reference:
 * - Discover how long someone spends engaged on your website or app in Google Analytics](https://support.google.com/analytics/answer/11109416?hl=en)
 */
import { throttle } from '@shware/utils';
import { useCallback, useEffect, useRef } from 'react';
import { SESSION_TIMEOUT } from '../setup/session';
import { sendBeacon, track } from '../track/index';

/**
 * 1. send session_start event when the page is loaded
 * 2. send scroll event when the user scrolls more than 90% of the page
 * 3. send user_engagement event when the page is hidden or the user is not focused
 */
export function useWebSessionAnalytics(pathname: string) {
  const isActive = useRef(true);
  const isFocused = useRef(true);
  const isVisible = useRef(true);

  const startTime = useRef(Date.now());
  const accumulatedTime = useRef(0);

  const hasSendScroll = useRef(false);

  const updateAccumulator = useCallback(() => {
    const now = Date.now();
    if (isFocused.current && isVisible.current && isActive.current) {
      const delta = now - startTime.current;
      if (delta > 0 && delta < SESSION_TIMEOUT) {
        accumulatedTime.current += delta;
      }
    }
    startTime.current = now;
  }, []);

  const sendUserEngagement = useCallback(() => {
    updateAccumulator();
    const engagement_time_msec = accumulatedTime.current;
    accumulatedTime.current = 0;
    if (engagement_time_msec <= 0) return;
    sendBeacon('user_engagement', { engagement_time_msec });
  }, [updateAccumulator]);

  const sendScroll = useCallback(() => {
    updateAccumulator();
    const engagement_time_msec = accumulatedTime.current;
    accumulatedTime.current = 0;
    if (engagement_time_msec <= 0) return;
    track('scroll', { engagement_time_msec }, { enableThirdPartyTracking: false });
  }, [updateAccumulator]);

  // reset scroll state when the pathname changes, so we can send scroll when the user navigates to
  // a new page
  useEffect(() => {
    hasSendScroll.current = false;
  }, [pathname]);

  useEffect(() => {
    isFocused.current = typeof document !== 'undefined' && document.hasFocus();
    isVisible.current = typeof document !== 'undefined' && document.visibilityState === 'visible';
    startTime.current = Date.now();

    track('session_start', undefined, { enableThirdPartyTracking: false });

    const onFocus = () => {
      updateAccumulator();
      isFocused.current = true;
    };

    const onBlur = () => {
      updateAccumulator();
      isFocused.current = false;
    };

    const onPageShow = () => {
      updateAccumulator();
      isActive.current = true;
    };

    const onPageHide = () => {
      updateAccumulator();
      isActive.current = false;
      sendUserEngagement();
    };

    const onVisibilityChange = () => {
      updateAccumulator();
      if (document.visibilityState === 'visible') {
        isVisible.current = true;
      } else {
        isVisible.current = false;
        sendUserEngagement();
      }
    };

    const onScroll = throttle(() => {
      updateAccumulator();
      if (hasSendScroll.current) return;

      // only send scroll when the user has scrolled more than 90% of the page
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const windowHeight = window.innerHeight;
      const docHeight = document.documentElement.scrollHeight;
      if (docHeight === 0) return;
      const scrollPercent = (scrollTop + windowHeight) / docHeight;
      if (scrollPercent < 0.9) return;
      hasSendScroll.current = true;

      sendScroll();
    }, 500);

    const checkpointEvents = ['mousedown', 'keydown', 'touchstart'];
    const checkpoint = throttle(updateAccumulator, 1000);

    window.addEventListener('focus', onFocus, { passive: true });
    window.addEventListener('blur', onBlur, { passive: true });
    window.addEventListener('pageshow', onPageShow, { passive: true });
    window.addEventListener('pagehide', onPageHide, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });

    // save checkpoint
    checkpointEvents.forEach((event) => {
      window.addEventListener(event, checkpoint, { passive: true, capture: true });
    });

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pageshow', onPageShow);
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
}
