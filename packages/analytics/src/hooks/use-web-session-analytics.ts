/**
 * reference:
 * - Discover how long someone spends engaged on your website or app in Google Analytics](https://support.google.com/analytics/answer/11109416?hl=en)
 */
import { useCallback, useEffect, useRef } from 'react';
import { sendBeacon, track } from '../track/index';

const scrollGap = 500;
const scrollThreshold = 0.9;

export function useWebSessionAnalytics(pathname: string) {
  const isActive = useRef(true);
  const isFocused = useRef(true);
  const isVisible = useRef(true);

  const startTime = useRef(Date.now());
  const accumulatedTime = useRef(0);

  const hasSendScroll = useRef(false);
  const lastScrollTime = useRef(0);

  const updateAccumulator = useCallback(() => {
    const now = Date.now();
    if (isFocused.current && isVisible.current && isActive.current) {
      const delta = now - startTime.current;
      if (delta > 0) {
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

  useEffect(() => {
    hasSendScroll.current = false;
  }, [pathname]);

  useEffect(() => {
    isFocused.current = typeof document !== 'undefined' && document.hasFocus();
    isVisible.current = typeof document !== 'undefined' && document.visibilityState === 'visible';
    startTime.current = Date.now();

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

    const onScroll = () => {
      const now = Date.now();
      if (now - lastScrollTime.current < scrollGap) return;
      lastScrollTime.current = now;
      if (hasSendScroll.current) return;

      // only send scroll when the user has scrolled more than 90% of the page
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const windowHeight = window.innerHeight;
      const docHeight = document.documentElement.scrollHeight;
      if (docHeight === 0) return;
      const scrollPercent = (scrollTop + windowHeight) / docHeight;
      if (scrollPercent < scrollThreshold) return;
      hasSendScroll.current = true;

      sendScroll();
    };

    track('session_start', {}, { enableThirdPartyTracking: false });

    window.addEventListener('focus', onFocus, { passive: true });
    window.addEventListener('blur', onBlur, { passive: true });
    window.addEventListener('pageshow', onPageShow, { passive: true });
    window.addEventListener('pagehide', onPageHide, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
}
