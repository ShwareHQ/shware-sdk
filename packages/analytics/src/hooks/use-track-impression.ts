import { type RefCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { track } from '../track/index';
import type { EventName, TrackName, TrackProperties } from '../track/types';

export function useTrackImpression<T extends EventName = EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>
): RefCallback<Element> {
  const fired = useRef(false);
  const [node, setNode] = useState<Element | null>(null);

  const onTrack = useEffectEvent(() => {
    if (fired.current) return;
    track(name, properties);
    fired.current = true;
  });

  useEffect(() => {
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        onTrack();
        observer.disconnect();
      },
      { threshold: 0.5 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  // A callback ref (contravariant in the element type) instead of a RefObject:
  // it attaches to any element without an R type parameter, so `name` stays the
  // only inference site and explicit type arguments are never needed. It also
  // observes elements that mount late, which the previous [ref.current] effect
  // dependency missed.
  return setNode;
}
