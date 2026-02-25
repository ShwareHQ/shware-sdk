import { type RefObject, useEffect, useEffectEvent, useRef } from 'react';
import { track } from '../track/index';
import type { EventName, TrackName, TrackProperties } from '../track/types';

export function useTrackImpression<R extends Element = Element, T extends EventName = EventName>(
  ref: RefObject<R>,
  name: TrackName<T>,
  properties?: TrackProperties<T>
) {
  const fired = useRef(false);

  const onTrack = useEffectEvent(() => {
    if (fired.current) return;
    track(name, properties);
    fired.current = true;
  });

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        onTrack();
        observer.disconnect();
      },
      { threshold: 0.5 }
    );

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref.current]);
}
