import { useEffect, useRef } from 'react';
import { cache } from '../setup/index';
import { sendBeacon, track } from '../track';

export function useSessionAnalytics() {
  const launched = useRef(false);

  useEffect(() => {
    if (launched.current) return;
    launched.current = true;
    const properties = { session_id: cache.session.id };
    track('session_start', properties, { enableThirdPartyTracking: false });
  }, []);

  useEffect(() => {
    const onBeforeUnload = () => {
      const started_at = cache.session.startedAt;
      const ended_at = new Date().toISOString();
      const ms = new Date(ended_at).getTime() - new Date(started_at).getTime();
      const duration = Number((ms / 1000).toFixed(2));
      sendBeacon('session_end', { duration, session_id: cache.session.id, started_at, ended_at });
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
}
