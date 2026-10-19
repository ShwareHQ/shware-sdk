import { act, cleanup, render, renderHook } from '@testing-library/react';
import { Activity, useLayoutEffect, useRef } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useDebouncedCallback,
  useExponentialHint,
  useLatestRef,
  usePrevious,
} from '../../utils/dist/index.mjs';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('synchronous debounced callbacks', () => {
  it('keeps the pending queue and uses the latest callback', () => {
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

  it('uses the latest callback when a child layout effect invokes the leading edge', () => {
    vi.useFakeTimers();
    const record = vi.fn<(value: string) => void>();
    function Child({ value, onInvoke }: { value: string; onInvoke: () => void }) {
      useLayoutEffect(() => {
        onInvoke();
      }, [value, onInvoke]);
      return null;
    }
    function Parent({ value }: { value: string }) {
      const invoke = useDebouncedCallback(() => record(value), 100, { leading: true });
      return <Child value={value} onInvoke={invoke} />;
    }
    const view = render(<Parent value="first" />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    view.rerender(<Parent value="latest" />);
    expect(record.mock.calls.map(([value]) => value)).toEqual(['first', 'latest']);
  });

  it('uses the latest callback when a child layout effect flushes a queued invocation', () => {
    const record = vi.fn<(value: string) => void>();
    function Child({ value, onFlush }: { value: string; onFlush: () => void }) {
      useLayoutEffect(() => {
        if (value === 'latest') onFlush();
      }, [value, onFlush]);
      return null;
    }
    function Parent({ value }: { value: string }) {
      const invoke = useDebouncedCallback(() => record(value), 100);
      return (
        <>
          <button type="button" onClick={() => invoke()}>
            Queue
          </button>
          <Child value={value} onFlush={invoke.flush} />
        </>
      );
    }
    const view = render(<Parent value="first" />);
    act(() => view.getByText('Queue').click());
    view.rerender(<Parent value="latest" />);
    expect(record).toHaveBeenCalledExactlyOnceWith('latest');
  });

  it('uses the latest callback for a focus event fired before the parent layout effects', () => {
    vi.useFakeTimers();
    const record = vi.fn<(value: string) => void>();
    function Field({ onFocus }: { onFocus: () => void }) {
      const input = useRef<HTMLInputElement>(null);
      useLayoutEffect(() => {
        input.current?.focus();
      }, []);
      return <input ref={input} onFocus={onFocus} />;
    }
    function Parent({ value }: { value: string }) {
      const invoke = useDebouncedCallback(() => record(value), 100, { leading: true });
      return <Field key={value} onFocus={() => invoke()} />;
    }
    const view = render(<Parent value="first" />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    view.rerender(<Parent value="latest" />);
    expect(record.mock.calls.map(([value]) => value)).toEqual(['first', 'latest']);
  });

  it('keeps a retained callback current after an Activity commits new props while hidden', () => {
    const record = vi.fn<(value: string) => void>();
    function Editor({
      value,
      onRegister,
    }: {
      value: string;
      onRegister: (invoke: () => void) => void;
    }) {
      const invoke = useDebouncedCallback(() => record(value), 100, { leading: true });
      useLayoutEffect(() => {
        onRegister(invoke);
      }, [invoke, onRegister]);
      return <output>{value}</output>;
    }
    const register = vi.fn<(invoke: () => void) => void>();
    const view = render(
      <Activity mode="visible">
        <Editor value="first" onRegister={register} />
      </Activity>
    );
    const invoke = register.mock.calls[0][0];
    view.rerender(
      <Activity mode="hidden">
        <Editor value="first" onRegister={register} />
      </Activity>
    );
    view.rerender(
      <Activity mode="hidden">
        <Editor value="latest" onRegister={register} />
      </Activity>
    );
    expect(view.container.textContent).toBe('latest');
    act(() => invoke());
    expect(record).toHaveBeenCalledExactlyOnceWith('latest');
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

describe('usePrevious public contract', () => {
  it('starts undefined and advances after every committed effect, including equal values', () => {
    const { result, rerender } = renderHook(({ value }) => usePrevious(value), {
      initialProps: { value: 'first' },
    });
    expect(result.current).toBeUndefined();
    rerender({ value: 'second' });
    expect(result.current).toBe('first');
    rerender({ value: 'second' });
    expect(result.current).toBe('second');
    rerender({ value: 'third' });
    expect(result.current).toBe('second');
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
