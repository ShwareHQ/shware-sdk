import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenBucket } from '../token-bucket';

describe('TokenBucket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('takes tokens without waiting while the bucket has enough', async () => {
    const bucket = new TokenBucket({ rate: 1, capacity: 2, requested: 1 });
    await expect(bucket.removeTokens()).resolves.toBe(1);
    await expect(bucket.removeTokens()).resolves.toBe(0);
    bucket.destroy();
  });

  it.each([
    ['minute', 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['day', 24 * 60 * 60 * 1000],
  ] as const)(
    'waits one %s interval for a refill instead of polling every second',
    async (interval, ms) => {
      const bucket = new TokenBucket({ rate: 1, capacity: 1, requested: 1, interval });
      await bucket.removeTokens();

      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      let done = false;
      const pending = bucket.removeTokens().then(() => {
        done = true;
      });

      await vi.advanceTimersByTimeAsync(ms - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(done).toBe(true);
      // One wait of the whole interval, not a wake-up every 1000 ms.
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), ms);
      setTimeoutSpy.mockRestore();
      bucket.destroy();
    }
  );

  it('does not keep a Node process alive with its refill timer', () => {
    vi.useRealTimers();
    const unref = vi.fn<() => void>();
    const setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockReturnValue({ unref } as unknown as NodeJS.Timeout);
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});

    const bucket = new TokenBucket({ rate: 1, capacity: 1, requested: 1 });
    expect(unref).toHaveBeenCalledTimes(1);
    bucket.destroy();

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});
