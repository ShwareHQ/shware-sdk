import { useEffect, useEffectEvent, useMemo } from 'react';
import { type DebounceOptions, debounce } from '../debounce';
import { useLatestRef } from './use-latest-ref';

/**
 * Retains the latest render-time callback and exit policy without restarting pending work.
 * Synchronous updates preserve calls from layout effects and ref callbacks. Like useLatestRef,
 * this can expose uncommitted values during concurrent rendering; it is not a committed-only snapshot.
 * flushOnExit: flush the debounced callback when the component unmounts, default is false
 */
export function useDebouncedCallback<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delay: number,
  options: DebounceOptions & { flushOnExit?: boolean } = {}
) {
  const { maxWait, leading, trailing, flushOnExit = false } = options;

  const fnRef = useLatestRef(fn);
  const flushOnExitRef = useLatestRef(flushOnExit);

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
