// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PosthogProvider,
  useActiveFeatureFlags,
  useFeatureFlagEnabled,
  useFeatureFlagPayload,
  useFeatureFlagResult,
  useFeatureFlagVariantKey,
  usePostHog,
} from './posthog';

type Callback = () => void;

afterEach(() => {
  Reflect.deleteProperty(window, 'posthog');
});

describe('useFeatureFlagVariantKey', () => {
  it('is undefined without PostHog', () => {
    const { result } = renderHook(() => useFeatureFlagVariantKey('new-checkout'));
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

    const { result } = renderHook(() => useFeatureFlagVariantKey('new-checkout'));
    expect(result.current).toBeUndefined();

    // array.js replaces the stub and replays the queue once flags are in.
    const callback = queue[0]?.[1] as Callback;
    Object.assign(window, {
      posthog: {
        __loaded: true,
        featureFlags: { hasLoadedFlags: true },
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
        featureFlags: { hasLoadedFlags: true },
        getFeatureFlag: () => true,
        onFeatureFlags: () => unsubscribe,
      },
    });

    const { result, unmount } = renderHook(() => useFeatureFlagVariantKey('new-checkout'));
    expect(result.current).toBe(true);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <PosthogProvider bootstrap={{ featureFlags: { 'new-checkout': 'test' } }}>
      {children}
    </PosthogProvider>
  );

  it("renders the server's value on the server", () => {
    function Checkout() {
      return <p>{String(useFeatureFlagVariantKey('new-checkout'))}</p>;
    }
    const html = renderToString(
      <PosthogProvider bootstrap={{ featureFlags: { 'new-checkout': 'test' } }}>
        <Checkout />
      </PosthogProvider>
    );
    expect(html).toBe('<p>test</p>');
  });

  it("keeps the server's value until the library has loaded, then reads the library's", () => {
    const queue: unknown[][] = [];
    const stub = Object.assign(queue, {
      onFeatureFlags: (callback: Callback) => {
        queue.push(['onFeatureFlags', callback]);
      },
    });
    Object.assign(window, { posthog: stub });

    const { result } = renderHook(() => useFeatureFlagVariantKey('new-checkout'), { wrapper });
    expect(result.current).toBe('test');

    const callback = queue[0]?.[1] as Callback;
    Object.assign(window, {
      posthog: {
        __loaded: true,
        featureFlags: { hasLoadedFlags: true },
        getFeatureFlag: () => 'control',
      },
    });
    act(() => callback());
    expect(result.current).toBe('control');
  });

  it("keeps the server's value, reading no flag, until the flags request has answered", () => {
    const getFeatureFlag = vi.fn<(flag: string) => string>(() => 'control');
    const posthog = {
      __loaded: true,
      featureFlags: { hasLoadedFlags: false },
      getFeatureFlag,
      onFeatureFlags: (callback: Callback) => {
        flagsLoaded = callback;
        return () => {};
      },
    };
    let flagsLoaded: Callback = () => {};
    Object.assign(window, { posthog });

    const { result } = renderHook(() => useFeatureFlagVariantKey('new-checkout'), { wrapper });
    expect(result.current).toBe('test');
    expect(getFeatureFlag).not.toHaveBeenCalled();

    posthog.featureFlags.hasLoadedFlags = true;
    act(() => flagsLoaded());
    expect(result.current).toBe('control');
  });

  describe('the other hooks', () => {
    const bootstrapWrapper = ({ children }: { children: ReactNode }) => (
      <PosthogProvider
        bootstrap={{
          featureFlags: { 'new-checkout': 'test', banner: true, legacy: false },
          featureFlagPayloads: { 'new-checkout': { color: 'red' } },
        }}
      >
        {children}
      </PosthogProvider>
    );

    it("read the server's flags until the library has loaded", () => {
      const { result } = renderHook(
        () => ({
          enabled: useFeatureFlagEnabled('legacy'),
          unknown: useFeatureFlagEnabled('missing', true),
          payload: useFeatureFlagPayload('new-checkout'),
          result: useFeatureFlagResult('new-checkout'),
          active: useActiveFeatureFlags(),
        }),
        { wrapper: bootstrapWrapper }
      );
      expect(result.current).toEqual({
        enabled: false,
        unknown: true,
        payload: { color: 'red' },
        result: { key: 'new-checkout', enabled: true, variant: 'test', payload: { color: 'red' } },
        active: ['new-checkout', 'banner'],
      });
    });

    it('read the library once loaded, keeping an unchanged object across reads', () => {
      Object.assign(window, {
        posthog: {
          __loaded: true,
          onFeatureFlags: () => () => {},
          isFeatureEnabled: () => true,
          // A new object on every read, as PostHog's.
          getFeatureFlagResult: (key: string) => ({ key, enabled: true, payload: { n: 1 } }),
          featureFlags: { hasLoadedFlags: true, getFlags: () => ['banner'] },
        },
      });
      const { result, rerender } = renderHook(() => ({
        enabled: useFeatureFlagEnabled('banner'),
        payload: useFeatureFlagPayload('banner'),
        result: useFeatureFlagResult('banner'),
        active: useActiveFeatureFlags(),
      }));
      const first = result.current;
      expect(first).toEqual({
        enabled: true,
        payload: { n: 1 },
        result: { key: 'banner', enabled: true, payload: { n: 1 } },
        active: ['banner'],
      });
      rerender();
      expect(result.current.result).toBe(first.result);
      expect(result.current.payload).toBe(first.payload);
    });
  });
});

describe('usePostHog', () => {
  it('is undefined on the server', () => {
    function Probe() {
      return <p>{usePostHog() === undefined ? 'undefined' : 'defined'}</p>;
    }
    expect(renderToString(<Probe />)).toBe('<p>undefined</p>');
  });

  it('is the stub, then the library once it has replaced the stub', () => {
    const queue: unknown[][] = [];
    const stub = Object.assign(queue, {
      onFeatureFlags: (callback: Callback) => {
        queue.push(['onFeatureFlags', callback]);
      },
    });
    Object.assign(window, { posthog: stub });

    const { result } = renderHook(() => usePostHog());
    expect(result.current).toBe(stub);

    const library = { __loaded: true };
    Object.assign(window, { posthog: library });
    const flagsLoaded = queue[0]?.[1] as Callback;
    act(() => flagsLoaded());
    expect(result.current).toBe(library);
  });
});
