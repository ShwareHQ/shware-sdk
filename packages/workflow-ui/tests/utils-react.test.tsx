import { act, cleanup, render, renderHook } from '@testing-library/react';
import { Suspense, startTransition, use, useLayoutEffect, useState } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedCallback, useExponentialHint, useLatestRef } from '../../utils/dist/index.mjs';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('committed debounced callbacks', () => {
  it('keeps the pending queue and uses the latest committed callback', () => {
    vi.useFakeTimers();
    const first = vi.fn<(value: string) => void>();
    const latest = vi.fn<(value: string) => void>();
    const { result, rerender } = renderHook(({ fn }) => useDebouncedCallback(fn, 100), {
      initialProps: { fn: first },
    });
    const original = result.current;
    act(() => result.current('queued'));
    rerender({ fn: latest });
    expect(result.current).toBe(original);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledExactlyOnceWith('queued');
  });

  it('does not expose a callback from a suspended transition to an existing event handler', async () => {
    const record = vi.fn<(value: string) => void>();
    const suspended = new Promise<void>(() => {});
    function Page() {
      const [value, setValue] = useState('committed');
      const invoke = useDebouncedCallback(() => record(value), 100, { leading: true });
      if (value === 'pending') use(suspended);
      return (
        <>
          <output>{value}</output>
          <button type="button" onClick={() => startTransition(() => setValue('pending'))}>
            Transition
          </button>
          <button type="button" onClick={() => invoke()}>
            Invoke
          </button>
        </>
      );
    }
    const view = render(
      <Suspense fallback="Loading">
        <Page />
      </Suspense>
    );
    await act(async () => view.getByText('Transition').click());
    expect(view.getByRole('status').textContent).toBe('committed');
    act(() => view.getByText('Invoke').click());
    expect(record).toHaveBeenCalledExactlyOnceWith('committed');
  });

  it('supports flush, cancel and maximum wait without replacing its callback', () => {
    vi.useFakeTimers();
    const record = vi.fn<(value: string) => void>();
    const { result } = renderHook(() => useDebouncedCallback(record, 100, { maxWait: 150 }));
    act(() => result.current('flushed'));
    act(() => result.current.flush());
    expect(record).toHaveBeenCalledExactlyOnceWith('flushed');
    act(() => result.current('cancelled'));
    act(() => result.current.cancel());
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(record).toHaveBeenCalledTimes(1);
    act(() => result.current('early'));
    act(() => {
      vi.advanceTimersByTime(80);
    });
    act(() => result.current('latest'));
    act(() => {
      vi.advanceTimersByTime(70);
    });
    expect(record).toHaveBeenLastCalledWith('latest');
    expect(record).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('uses the latest flushOnExit=%s when unmounting', (flushOnExit) => {
    vi.useFakeTimers();
    const record = vi.fn<() => void>();
    const { result, rerender, unmount } = renderHook(
      ({ flush }) => useDebouncedCallback(record, 100, { flushOnExit: flush }),
      { initialProps: { flush: !flushOnExit } }
    );
    act(() => result.current());
    rerender({ flush: flushOnExit });
    unmount();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(record).toHaveBeenCalledTimes(Number(flushOnExit));
  });

  it('flushes on hidden and removes the visibility listener on unmount', () => {
    const record = vi.fn<() => void>();
    const { result, unmount } = renderHook(() =>
      useDebouncedCallback(record, 100, { flushOnExit: true })
    );
    act(() => result.current());
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(record).toHaveBeenCalledTimes(1);
    unmount();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(record).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });
});

describe('legacy useLatestRef contract', () => {
  it('updates the same ref before a child layout effect reads it', () => {
    const read = vi.fn<(value: string) => void>();
    function Child({ value, readLatest }: { value: string; readLatest: () => string }) {
      useLayoutEffect(() => read(readLatest()), [value, readLatest]);
      return null;
    }
    function Parent({ value }: { value: string }) {
      const latest = useLatestRef(value);
      return <Child value={value} readLatest={() => latest.current} />;
    }
    const view = render(<Parent value="first" />);
    view.rerender(<Parent value="latest" />);
    expect(read.mock.calls.map(([value]) => value)).toEqual(['first', 'latest']);
  });
});

describe('exponential hints', () => {
  it('hydrates hidden server markup before checking persisted eligibility', async () => {
    function Hint() {
      return <output>{String(useExponentialHint('welcome').visible)}</output>;
    }
    const container = document.createElement('div');
    container.innerHTML = renderToString(<Hint />);
    document.body.append(container);
    expect(container.textContent).toBe('false');
    const recover = vi.fn<(error: unknown) => void>();
    const root = hydrateRoot(container, <Hint />, { onRecoverableError: recover });
    await act(async () => {});
    expect(container.textContent).toBe('true');
    expect(recover).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
  });

  it('keeps a dismissed mounted session hidden after time passes, but rechecks on remount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
    const first = renderHook(() => useExponentialHint('welcome'));
    expect(first.result.current.visible).toBe(true);
    act(() => first.result.current.dismiss());
    vi.advanceTimersByTime(5 * 86_400_000);
    first.rerender();
    expect(first.result.current.visible).toBe(false);
    first.unmount();
    const second = renderHook(() => useExponentialHint('welcome'));
    expect(second.result.current.visible).toBe(true);
  });

  it.each([
    { count: 1, days: 3, visible: false },
    { count: 1, days: 4, visible: true },
    { count: 2, days: 15, visible: false },
    { count: 2, days: 16, visible: true },
    { count: 3, days: 100, visible: false },
    { count: 1, days: -1, visible: false },
  ])(
    'preserves persisted backoff: $count dismissals, $days elapsed days',
    ({ count, days, visible }) => {
      vi.useFakeTimers();
      const dismissedAt = Date.UTC(2026, 9, 1);
      vi.setSystemTime(dismissedAt + days * 86_400_000);
      localStorage.setItem(
        'exponential-hints',
        JSON.stringify({ welcome: { dismissCount: count, lastDismissedAt: dismissedAt } })
      );
      const { result } = renderHook(() => useExponentialHint('welcome'));
      expect(result.current.visible).toBe(visible);
    }
  );
});
