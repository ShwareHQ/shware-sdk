type Options = { timeout?: number; signal?: AbortSignal };

export function waitForRequestIdleCallback(options: Options = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const { timeout = 4000, signal } = options;

    if (signal?.aborted) {
      reject(signal.reason as Error);
      return;
    }

    const onAbort = () => {
      cancel();
      reject(signal?.reason as Error);
    };
    // Detach from the signal once settled, so a long-lived signal does not keep the listener.
    const done = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };

    const ric = window.requestIdleCallback as typeof window.requestIdleCallback | undefined;
    let cancel: () => void;

    if (ric) {
      const handle = ric(done, { timeout });
      // Same as requestIdleCallback: absent on browsers without the API.
      const cic = window.cancelIdleCallback as typeof window.cancelIdleCallback | undefined;
      cancel = () => cic?.(handle);
    } else {
      const handle = window.setTimeout(done, 1500);
      cancel = () => window.clearTimeout(handle);
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
