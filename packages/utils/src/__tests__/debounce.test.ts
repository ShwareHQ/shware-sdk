import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { debounce } from '../debounce';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('debounce', () => {
  test('invokes once on the trailing edge with the last arguments', () => {
    const fn = vi.fn<(x: number) => void>();
    const debounced = debounce(fn, 50);
    debounced(1);
    debounced(2);
    vi.advanceTimersByTime(49);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith(2);
  });

  test('leading invokes immediately and the trailing edge only for later calls', () => {
    const fn = vi.fn<(x: number) => void>();
    const debounced = debounce(fn, 50, { leading: true });
    debounced(1);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    debounced(2);
    debounced(3);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fn).toHaveBeenLastCalledWith(3);
  });

  test('maxWait invokes at least every maxWait while calls keep coming', () => {
    const fn = vi.fn<(x: number) => void>();
    const debounced = debounce(fn, 50, { maxWait: 200 });
    for (let t = 0; t < 1000; t += 10) {
      debounced(t);
      vi.advanceTimersByTime(10);
    }
    // invoked at 200, 400, 600, 800 and 1000 ms
    expect(fn).toHaveBeenCalledTimes(5);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(5);
    expect(fn).toHaveBeenLastCalledWith(990);
  });

  test('cancel drops the pending invocation', () => {
    const fn = vi.fn<(x: number) => void>();
    const debounced = debounce(fn, 50, { maxWait: 100 });
    debounced(1);
    debounced.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
    debounced(2);
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledExactlyOnceWith(2);
  });

  test('flush invokes the pending call immediately and only once', () => {
    const fn = vi.fn<(x: number) => number>((x) => x * 2);
    const debounced = debounce(fn, 50, { maxWait: 100 });
    expect(debounced.flush()).toBeUndefined();
    debounced(1);
    expect(debounced.flush()).toBe(2);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(debounced.flush()).toBe(2);
  });
});
