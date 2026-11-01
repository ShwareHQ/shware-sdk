// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFeatureFlag } from './use-feature-flag';

type Callback = () => void;

afterEach(() => {
  Reflect.deleteProperty(window, 'posthog');
});

describe('useFeatureFlag', () => {
  it('is undefined without PostHog', () => {
    const { result } = renderHook(() => useFeatureFlag('new-checkout'));
    expect(result.current).toBeUndefined();
  });

  it('subscribes on the stub and reads the flag once the library has loaded it', () => {
    const queue: unknown[][] = [];
    const stub = Object.assign(queue, {
      onFeatureFlags: (callback: Callback) => {
        queue.push(['onFeatureFlags', callback]);
      },
    });
    Object.assign(window, { posthog: stub });

    const { result } = renderHook(() => useFeatureFlag('new-checkout'));
    expect(result.current).toBeUndefined();

    // array.js replaces the stub and replays the queue once flags are in.
    const callback = queue[0]?.[1] as Callback;
    Object.assign(window, {
      posthog: {
        __loaded: true,
        getFeatureFlag: (key: string) => key === 'new-checkout' && 'test',
      },
    });
    act(() => callback());
    expect(result.current).toBe('test');
  });

  it('unsubscribes on unmount', () => {
    const unsubscribe = vi.fn<Callback>();
    Object.assign(window, {
      posthog: {
        __loaded: true,
        getFeatureFlag: () => true,
        onFeatureFlags: () => unsubscribe,
      },
    });

    const { result, unmount } = renderHook(() => useFeatureFlag('new-checkout'));
    expect(result.current).toBe(true);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
