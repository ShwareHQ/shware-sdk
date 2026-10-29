import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForRequestIdleCallback } from '../wait-for-request-idle-callback';

function stubWindow(withIdleCallback: boolean) {
  const callbacks: Array<() => void> = [];
  const cancelIdleCallback = vi.fn<(handle: number) => void>();
  vi.stubGlobal('window', {
    requestIdleCallback: withIdleCallback ? (cb: () => void) => callbacks.push(cb) : undefined,
    cancelIdleCallback,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });
  return { callbacks, cancelIdleCallback };
}

describe('waitForRequestIdleCallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('removes its abort listener from the signal once idle', async () => {
    const { callbacks, cancelIdleCallback } = stubWindow(true);
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');

    const promise = waitForRequestIdleCallback({ signal: controller.signal });
    callbacks[0]();
    await expect(promise).resolves.toBeUndefined();

    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);

    // Aborting afterwards does not cancel anything.
    controller.abort();
    expect(cancelIdleCallback).not.toHaveBeenCalled();
  });

  it('removes its abort listener on the setTimeout fallback too', async () => {
    vi.useFakeTimers();
    stubWindow(false);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');

    const promise = waitForRequestIdleCallback({ signal: controller.signal });
    await vi.advanceTimersByTimeAsync(1500);
    await expect(promise).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('rejects and cancels the idle callback when aborted first', async () => {
    const { cancelIdleCallback } = stubWindow(true);
    const controller = new AbortController();
    const promise = waitForRequestIdleCallback({ signal: controller.signal });

    controller.abort(new Error('stop'));
    await expect(promise).rejects.toThrow('stop');
    expect(cancelIdleCallback).toHaveBeenCalledTimes(1);
  });
});
