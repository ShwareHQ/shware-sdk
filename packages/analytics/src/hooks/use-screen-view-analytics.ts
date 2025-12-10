import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { track } from '../track/index';
import { usePrevious } from './use-previous';

export function useScreenViewAnalytics() {
  const pathname = usePathname();
  const prevPathname = usePrevious(pathname);
  const session = useRef({ start: performance.now(), total: 0, isActive: true });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      // when returning to the foreground from the background
      if (state === 'active' && !session.current.isActive) {
        session.current.start = performance.now();
        session.current.isActive = true;
      }
      // when entering the background
      else if (state !== 'active' && session.current.isActive) {
        session.current.total += (performance.now() - session.current.start) / 1000;
        session.current.isActive = false;
      }
    });

    return () => subscription.remove();
  }, []);

  // when the screen is switched, the duration of the previous screen is recorded
  useEffect(() => {
    if (!prevPathname) {
      session.current = { start: performance.now(), total: 0, isActive: true };
    }

    let duration = session.current.total;
    if (session.current.isActive) {
      duration += (performance.now() - session.current.start) / 1000;
    }

    track('screen_view', {
      screen_name: pathname,
      screen_class: pathname,
      previous_screen_class: prevPathname ?? undefined,
      previous_screen_class_duration: prevPathname ? Number(duration.toFixed(2)) : undefined,
    });

    // reset session
    session.current = { start: performance.now(), total: 0, isActive: true };
  }, [pathname]);
}
