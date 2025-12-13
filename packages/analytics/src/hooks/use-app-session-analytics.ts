import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { track } from '../track/index';

export function useAppSessionAnalytics() {
  const isActive = useRef(true);
  const startTime = useRef(Date.now());
  const accumulatedTime = useRef(0);

  const updateAccumulator = useCallback(() => {
    const now = Date.now();
    if (isActive.current) {
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
    track('user_engagement', { engagement_time_msec }, { enableThirdPartyTracking: false });
  }, [updateAccumulator]);

  useEffect(() => {
    track('session_start', undefined, { enableThirdPartyTracking: false });

    const subscription = AppState.addEventListener('change', (state) => {
      updateAccumulator();
      // when returning to the foreground from the background
      if (state === 'active' && !isActive.current) {
        isActive.current = true;
      }
      // when entering the background
      else if (state !== 'active' && isActive.current) {
        isActive.current = false;
        sendUserEngagement();
      }
    });

    return () => subscription.remove();
  }, []);
}
