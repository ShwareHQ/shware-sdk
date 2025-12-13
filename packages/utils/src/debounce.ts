type Procedure = (...args: never[]) => unknown;

type DebounceOptions = {
  /**
   * Specify invoking on the leading edge of the timeout.
   * @default false
   */
  leading?: boolean;
  /**
   * Specify invoking on the trailing edge of the timeout.
   * @default true
   */
  trailing?: boolean;
  /**
   * The maximum time func is allowed to be delayed before it's invoked.
   * Only works when leading is false.
   */
  maxWait?: number;
};

export interface DebouncedFunction<F extends Procedure, R = ReturnType<F>> {
  (this: ThisParameterType<F>, ...args: Parameters<F>): R | undefined;
  /** Cancels any pending invocation */
  cancel: () => void;
  /** Immediately invokes any pending function call */
  flush: () => R | undefined;
}

export function debounce<F extends Procedure>(
  func: F,
  wait: number,
  options: DebounceOptions = {}
): DebouncedFunction<F> {
  const { leading = false, trailing = true, maxWait } = options;

  let timeout: ReturnType<typeof setTimeout> | null = null;
  let maxTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<F> | null = null;
  let lastThis: ThisParameterType<F> | null = null;
  let lastCallTime: number | undefined;
  let result: ReturnType<F> | undefined;

  // Check if maxWait is valid
  const hasMaxWait = maxWait !== undefined && maxWait >= 0;
  const maxWaitMs = hasMaxWait ? Math.max(maxWait, wait) : undefined;

  function invokeFunc(): ReturnType<F> | undefined {
    const args = lastArgs;
    const thisArg = lastThis;

    lastArgs = null;
    lastThis = null;

    if (args) {
      result = func.apply(thisArg, args) as ReturnType<F>;
    }
    return result;
  }

  function startTimer(pendingFunc: () => void, waitTime: number) {
    return setTimeout(pendingFunc, waitTime);
  }

  function cancelTimer() {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    if (maxTimeout) {
      clearTimeout(maxTimeout);
      maxTimeout = null;
    }
  }

  function remainingWait(time: number): number {
    const timeSinceLastCall = lastCallTime !== undefined ? time - lastCallTime : 0;
    return Math.max(0, wait - timeSinceLastCall);
  }

  function shouldInvoke(time: number): boolean {
    if (lastCallTime === undefined) {
      return true;
    }
    const timeSinceLastCall = time - lastCallTime;
    // Either this is the first call, activity has stopped and we're at the trailing edge,
    // or the wait time has been exceeded
    return timeSinceLastCall >= wait || timeSinceLastCall < 0;
  }

  function timerExpired() {
    const time = Date.now();

    if (shouldInvoke(time)) {
      return trailingEdge();
    }

    // Restart the timer
    timeout = startTimer(timerExpired, remainingWait(time));
  }

  function maxTimerExpired() {
    // Force invoke when maxWait is exceeded
    if (lastArgs) {
      cancelTimer();
      return invokeFunc();
    }
    maxTimeout = null;
  }

  function leadingEdge(): ReturnType<F> | undefined {
    // Start the timer for the trailing edge
    timeout = startTimer(timerExpired, wait);

    // Start maxWait timer if configured
    if (hasMaxWait && maxWaitMs !== undefined && !maxTimeout) {
      maxTimeout = startTimer(maxTimerExpired, maxWaitMs);
    }

    // Invoke the leading edge
    if (leading) {
      return invokeFunc();
    }
    return result;
  }

  function trailingEdge(): ReturnType<F> | undefined {
    timeout = null;
    maxTimeout = null;

    // Only invoke if we have lastArgs (meaning the function was called at least once)
    if (trailing && lastArgs) {
      return invokeFunc();
    }

    lastArgs = null;
    lastThis = null;
    return result;
  }

  const debounced = function (
    this: ThisParameterType<F>,
    ...args: Parameters<F>
  ): ReturnType<F> | undefined {
    const time = Date.now();
    const isInvoking = shouldInvoke(time);

    lastArgs = args;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastThis = this;
    lastCallTime = time;

    if (isInvoking) {
      // First call or after wait period
      if (timeout === null) {
        return leadingEdge();
      }

      // Handle maxWait scenario when leading is false
      if (hasMaxWait) {
        // Reset the standard debounce timer
        cancelTimer();
        timeout = startTimer(timerExpired, wait);

        // Start maxWait timer
        if (maxWaitMs !== undefined) {
          maxTimeout = startTimer(maxTimerExpired, maxWaitMs);
        }
      }
    }

    // Ensure timer is set
    if (timeout === null) {
      timeout = startTimer(timerExpired, wait);
    }

    return result;
  };

  debounced.cancel = () => {
    cancelTimer();
    lastArgs = null;
    lastThis = null;
    lastCallTime = undefined;
  };

  debounced.flush = (): ReturnType<F> | undefined => {
    if (timeout === null && maxTimeout === null) {
      return result;
    }
    return trailingEdge();
  };

  return debounced;
}
