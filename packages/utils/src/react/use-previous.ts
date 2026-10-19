import { useEffect, useRef } from 'react';

/**
 * Returns a snapshot of the value saved by the previous committed render's effect.
 * Initially undefined. Each effect setup saves the current value for a later render,
 * even when unchanged; the returned value is a render-time snapshot, not a live ref.
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  });
  // oxlint-disable-next-line react/refs -- Intentional render snapshot; the effect updates the stored value.
  return ref.current;
}
