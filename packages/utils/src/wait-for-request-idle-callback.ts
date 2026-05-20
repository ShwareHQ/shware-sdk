type Options = { timeout?: number; signal?: AbortSignal };

export function waitForRequestIdleCallback(options: Options = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const { timeout = 4000, signal } = options;

    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const ric = window.requestIdleCallback as typeof window.requestIdleCallback | undefined;
    let cancel: () => void;

    if (ric) {
      const handle = ric(() => resolve(), { timeout });
      cancel = () => window.cancelIdleCallback?.(handle);
    } else {
      const handle = window.setTimeout(() => resolve(), 1500);
      cancel = () => window.clearTimeout(handle);
    }

    signal?.addEventListener(
      'abort',
      () => {
        cancel();
        reject(signal.reason);
      },
      { once: true }
    );
  });
}
