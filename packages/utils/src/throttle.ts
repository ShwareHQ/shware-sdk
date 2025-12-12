type Procedure = (...args: never[]) => unknown;

/**
 * leading: Whether to execute immediately at the start (default true)
 * trailing: Whether to execute once after timeout ends (default true)
 */
type ThrottleOptions = {
  leading?: boolean;
  trailing?: boolean;
};

export interface ThrottledFunction<F extends Procedure> {
  (...args: Parameters<F>): void;
  /** For cleaning up timers, essential for React useEffect cleanup */
  cancel: () => void;
}

export function throttle<F extends Procedure>(
  func: F,
  wait: number,
  options: ThrottleOptions = {}
): ThrottledFunction<F> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let previous = 0;
  let lastArgs: Parameters<F> | null = null;
  let lastThis: ThisParameterType<F>;

  const { leading = true, trailing = true } = options;

  const throttled = function (this: ThisParameterType<F>, ...args: Parameters<F>) {
    const now = Date.now();

    // If it's the first trigger and leading is false, set previous to now.
    // This way, remaining will equal wait, thus going into the timer logic below.
    if (!previous && !leading) previous = now;

    const remaining = wait - (now - previous);

    // Always save the latest args and context for trailing call
    lastArgs = args;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastThis = this;

    // 1. If enough time has passed (remaining <= 0)
    // 2. Or if the system time changes (remaining > wait)
    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }

      previous = now;
      lastArgs = null;
      func.apply(this, args);
    }
    // 3. If still within wait period, no timer exists, and trailing is enabled
    else if (!timeout && trailing) {
      timeout = setTimeout(() => {
        previous = leading === false ? 0 : Date.now();
        timeout = null;
        // Use the latest saved args
        if (lastArgs) {
          func.apply(lastThis, lastArgs);
          lastArgs = null;
        }
      }, remaining);
    }
  };

  // Cancel method to clear timer, useful when component unmounts
  throttled.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    previous = 0;
    lastArgs = null;
  };

  return throttled;
}
