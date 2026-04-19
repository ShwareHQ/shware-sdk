import { useEffect, useEffectEvent, useMemo } from 'react';
import { type DebounceOptions, debounce } from '../debounce';
import { useLatestRef } from './use-latest-ref';

/**
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
      debounce((...args: Args) => fnRef.current(...args), delay, { maxWait, leading, trailing }),
    [delay, maxWait, leading, trailing]
  );

  const onVisibility = useEffectEvent(() => {
    if (document.visibilityState === 'hidden') debounced.flush();
  });

  useEffect(() => {
    if (!flushOnExit) return;
    if (typeof document === 'undefined') return;

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
