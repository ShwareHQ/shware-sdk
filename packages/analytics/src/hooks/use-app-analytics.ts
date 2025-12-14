import { useEffect } from 'react';
import { AppState } from 'react-native';
import { config } from '../setup/index';
import { session } from '../setup/session';
import { track } from '../track/index';
import { usePrevious } from './use-previous';

function sendFirstOpen(pathname: string) {
  const key = 'first_open_time';
  if (config.storage.getItem(key)) return;
  track('first_open', { screen_name: pathname, screen_class: pathname });
  config.storage.setItem(key, new Date().toISOString());
}

function sendUserEngagement() {
  const engagement_time_msec = session.flush();
  if (engagement_time_msec <= 0) return;
  track('user_engagement', { engagement_time_msec, trigger: 'background' });
}

export function useAppAnalytics(pathname: string) {
  const prevPathname = usePrevious(pathname);

  useEffect(() => {
    sendFirstOpen(pathname);
    track('session_start', undefined);

    const subscription = AppState.addEventListener('change', (state) => {
      session.updateAccumulator();
      // when returning to the foreground from the background
      if (state === 'active' && !session.isActive()) {
        session.updateActive(true);
      }
      // when entering the background
      else if (state !== 'active' && session.isActive()) {
        session.updateActive(false);
        sendUserEngagement();
      }
    });

    return () => subscription.remove();
  }, []);

  // when the screen is switched, the engagement time of the previous screen is recorded
  useEffect(() => {
    track('screen_view', {
      screen_name: pathname,
      screen_class: pathname,
      previous_screen_class: prevPathname ?? undefined,
      engagement_time_msec: prevPathname ? session.flush() : undefined,
    });
  }, [pathname]);
}
