type Procedure = (...args: never[]) => unknown;

export type DebounceOptions = {
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
   * The maximum time func is allowed to be delayed before it's invoked, counted from the last
   * invocation (or the first call of a burst). While calls keep coming, func is invoked at least
   * once every `maxWait`. Applies with `leading` too. Clamped to at least `wait`.
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

  // Same model as lodash: one timer, plus the time of the last call and of the last invocation.
  // maxWait is enforced by comparing "time since the last invocation" against it, both when the
  // timer fires and when a new call arrives, so a continuous stream of calls still invokes func
  // every maxWait instead of only once.
  const maxing = maxWait !== undefined && maxWait >= 0;
  const maxWaitMs = maxing ? Math.max(maxWait, wait) : 0;

  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<F> | null = null;
  let lastThis: ThisParameterType<F> | null = null;
  let lastCallTime: number | undefined;
  let lastInvokeTime = 0;
  let result: ReturnType<F> | undefined;

  function invokeFunc(time: number): ReturnType<F> | undefined {
    const args = lastArgs;
    const thisArg = lastThis;

    lastArgs = null;
    lastThis = null;
    lastInvokeTime = time;

    if (args) {
      result = func.apply(thisArg, args) as ReturnType<F>;
    }
    return result;
  }

  function remainingWait(time: number): number {
    const timeSinceLastCall = time - (lastCallTime ?? time);
    const timeSinceLastInvoke = time - lastInvokeTime;
    const timeWaiting = wait - timeSinceLastCall;
    return maxing ? Math.min(timeWaiting, maxWaitMs - timeSinceLastInvoke) : timeWaiting;
  }

  function shouldInvoke(time: number): boolean {
    if (lastCallTime === undefined) return true; // first call
    const timeSinceLastCall = time - lastCallTime;
    const timeSinceLastInvoke = time - lastInvokeTime;
    // Activity stopped for `wait`, the clock went backwards, or maxWait has elapsed.
    return (
      timeSinceLastCall >= wait ||
      timeSinceLastCall < 0 ||
      (maxing && timeSinceLastInvoke >= maxWaitMs)
    );
  }

  function timerExpired() {
    const time = Date.now();
    if (shouldInvoke(time)) {
      trailingEdge(time);
      return;
    }
    timeout = setTimeout(timerExpired, remainingWait(time));
  }

  function leadingEdge(time: number): ReturnType<F> | undefined {
    // Start the maxWait window and the trailing-edge timer.
    lastInvokeTime = time;
    timeout = setTimeout(timerExpired, wait);
    return leading ? invokeFunc(time) : result;
  }

  function trailingEdge(time: number): ReturnType<F> | undefined {
    timeout = null;

    // Only invoke if there were calls since the last invocation.
    if (trailing && lastArgs) {
      return invokeFunc(time);
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
      if (timeout === null) {
        return leadingEdge(time);
      }
      if (maxing) {
        // Calls are still arriving and maxWait has elapsed: invoke now and restart the timer.
        clearTimeout(timeout);
        timeout = setTimeout(timerExpired, wait);
        return invokeFunc(time);
      }
    }

    timeout ??= setTimeout(timerExpired, wait);
    return result;
  };

  debounced.cancel = () => {
    if (timeout !== null) clearTimeout(timeout);
    timeout = null;
    lastArgs = null;
    lastThis = null;
    lastCallTime = undefined;
    lastInvokeTime = 0;
  };

  debounced.flush = (): ReturnType<F> | undefined => {
    if (timeout === null) return result;
    clearTimeout(timeout);
    return trailingEdge(Date.now());
  };

  return debounced;
}
