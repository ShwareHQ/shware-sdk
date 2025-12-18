import { describe, expect, it, vi } from 'vitest';
import { once } from '../promise';

describe('once', () => {
  it('should call the function only once', async () => {
    const fn = vi.fn().mockResolvedValue('result');
    const onceFn = once(fn);

    await onceFn();
    await onceFn();
    await onceFn();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should return cached result on subsequent calls', async () => {
    const fn = vi.fn().mockResolvedValue('cached-result');
    const onceFn = once(fn);

    const result1 = await onceFn();
    const result2 = await onceFn();
    const result3 = await onceFn();

    expect(result1).toBe('cached-result');
    expect(result2).toBe('cached-result');
    expect(result3).toBe('cached-result');
  });

  it('should pass arguments to the original function', async () => {
    const fn = vi.fn().mockResolvedValue('result');
    const onceFn = once(fn);
    await onceFn('arg1', 'arg2', 123);
    expect(fn).toHaveBeenCalledWith('arg1', 'arg2', 123);
  });

  it('should allow retry after error', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('first error'))
      .mockResolvedValueOnce('success');
    const onceFn = once(fn);

    // First call should fail
    await expect(onceFn()).rejects.toThrow('first error');

    // Second call should succeed (retry allowed)
    const result = await onceFn();
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should reset promise on error to allow concurrent retries', async () => {
    let callCount = 0;
    const fn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error('error'));
      }
      return Promise.resolve('success');
    });
    const onceFn = once(fn);

    // First call fails
    await expect(onceFn()).rejects.toThrow('error');

    // After error, promise should be reset, allowing retry
    const result = await onceFn();
    expect(result).toBe('success');
  });

  it('should cache result even with different arguments on subsequent calls', async () => {
    const fn = vi.fn().mockImplementation((x: number) => Promise.resolve(x * 2));
    const onceFn = once(fn);

    const result1 = await onceFn(5);
    const result2 = await onceFn(10); // Different argument, but should return cached result

    expect(result1).toBe(10);
    expect(result2).toBe(10); // Returns cached result from first call
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(5);
  });
});
