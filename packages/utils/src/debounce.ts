type Procedure = (...args: never[]) => unknown;

type DebounceOptions = {
  /**
   * Whether to execute at the beginning immediately (default is false)
   * true: Execute immediately, then wait for no operations within the wait ms before resetting
   * false: Execute only after wait ms of inactivity
   */
  immediate?: boolean;
};

export interface DebouncedFunction<F extends Procedure> {
  (this: ThisParameterType<F>, ...args: Parameters<F>): void;
  cancel: () => void; // Used to clear the timer
}

export function debounce<F extends Procedure>(
  func: F,
  wait: number,
  options: DebounceOptions = {}
): DebouncedFunction<F> {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const { immediate = false } = options;

  const debounced = function (this: ThisParameterType<F>, ...args: Parameters<F>) {
    // On every trigger, clear the previous timer.
    // This is the core of debouncing: as long as you keep triggering, the timer keeps being reset and never completes.
    if (timeout) {
      clearTimeout(timeout);
    }

    // Handle the immediate execution logic.
    if (immediate) {
      // If there's no timer running, this means it's the "first fire"
      const callNow = !timeout;

      // Set a timer, just to reset the timeout variable after wait ms.
      // Any trigger within wait ms will prevent entering the callNow branch.
      timeout = setTimeout(() => {
        timeout = null;
      }, wait);

      if (callNow) {
        func.apply(this, args);
      }
    } else {
      // Standard mode: restart the timer, only the last trigger gets executed after wait ms.
      timeout = setTimeout(() => {
        func.apply(this, args);
      }, wait);
    }
  };

  // Cancel method: used for component unmount or manual cancellation.
  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  return debounced;
}
