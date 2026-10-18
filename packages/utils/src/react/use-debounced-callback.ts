import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef } from 'react';
import { type DebounceOptions, debounce } from '../debounce';

/**
 * Uses the latest committed callback for events and timers without restarting the queue.
 * Call after commit, rather than from a child's ref or layout effect during its parent's commit.
 * flushOnExit: flush the debounced callback when the component unmounts, default is false
 */
export function useDebouncedCallback<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delay: number,
  options: DebounceOptions & { flushOnExit?: boolean } = {}
) {
  const { maxWait, leading, trailing, flushOnExit = false } = options;

  const fnRef = useRef(fn);
  const flushOnExitRef = useRef(flushOnExit);
  useLayoutEffect(() => {
    fnRef.current = fn;
    flushOnExitRef.current = flushOnExit;
  }, [fn, flushOnExit]);

  const debounced = useMemo(
    () =>
      // oxlint-disable-next-line react/refs -- debounce stores this callback; construction never invokes it.
      debounce((...args: Args) => fnRef.current(...args), delay, { maxWait, leading, trailing }),
    [delay, maxWait, leading, trailing]
  );

  const onVisibility = useEffectEvent(() => {
    if (document.visibilityState === 'hidden') debounced.flush();
  });

  useEffect(() => {
    if (!flushOnExit) return undefined;
    if (typeof document === 'undefined') return undefined;

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [flushOnExit]);

  useEffect(() => {
    return () => {
      if (flushOnExitRef.current) debounced.flush();
      debounced.cancel();
    };
  }, [debounced]);

  return debounced;
}
