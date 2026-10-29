import { afterEach, describe, expect, it, vi } from 'vitest';
import { expiringStorage } from '../storage';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

describe('expiringStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns a stored value until it expires', () => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', memoryStorage());
    expiringStorage.setItem('k', { a: 1 }, 1000);
    expect(expiringStorage.getItem('k')).toEqual({ a: 1 });

    vi.advanceTimersByTime(1001);
    expect(expiringStorage.getItem('k')).toBeNull();
  });

  it('returns null when localStorage is not defined (SSR)', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(expiringStorage.getItem('k')).toBeNull();
  });

  it('returns null when reading localStorage throws (blocked storage)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    expect(expiringStorage.getItem('k')).toBeNull();
  });
});
