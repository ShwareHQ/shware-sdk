// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PosthogErrorBoundary, setupReactErrorHandler } from './posthog-error-boundary';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'posthog');
  vi.restoreAllMocks();
});

function Boom(): never {
  throw new Error('boom');
}

describe('PosthogErrorBoundary', () => {
  it('sends the error with its component stack and renders the fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const captureException = vi.fn<(error: unknown, properties?: object) => { uuid: string }>(
      () => ({ uuid: 'event-id' })
    );
    Object.assign(window, { posthog: { captureException } });

    render(
      <PosthogErrorBoundary
        additionalProperties={{ area: 'checkout' }}
        fallback={({ error, exceptionEvent }) => (
          <p>
            {(error as Error).message} {(exceptionEvent as { uuid: string }).uuid}
          </p>
        )}
      >
        <Boom />
      </PosthogErrorBoundary>
    );

    expect(screen.getByText('boom event-id')).toBeTruthy();
    const [error, properties] = captureException.mock.calls[0] ?? [];
    expect((error as Error).message).toBe('boom');
    expect(((error as Error).cause as Error).name).toBe('React ErrorBoundary Error');
    expect(((error as Error).cause as Error).stack).toContain('Boom');
    expect(properties).toEqual({ area: 'checkout' });
  });

  it('renders the children again on resetError', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    function Maybe() {
      if (fail) throw new Error('boom');
      return <p>fine</p>;
    }
    let reset = () => {};

    render(
      <PosthogErrorBoundary
        fallback={({ resetError }) => {
          reset = resetError;
          return <p>failed</p>;
        }}
      >
        <Maybe />
      </PosthogErrorBoundary>
    );
    expect(screen.getByText('failed')).toBeTruthy();

    fail = false;
    act(() => reset());
    expect(screen.getByText('fine')).toBeTruthy();
  });

  it('still renders the fallback without PostHog', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <PosthogErrorBoundary fallback={<p>failed</p>}>
        <Boom />
      </PosthogErrorBoundary>
    );
    expect(screen.getByText('failed')).toBeTruthy();
  });

  it('renders the fallback when reporting fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.assign(window, {
      posthog: {
        captureException: () => {
          throw new Error('posthog failed');
        },
      },
    });
    render(
      <PosthogErrorBoundary fallback={<p>failed</p>}>
        <Boom />
      </PosthogErrorBoundary>
    );
    expect(screen.getByText('failed')).toBeTruthy();
  });

  it('queues the error on the stub, as with an ad blocker that stops the library', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const queue: unknown[][] = [];
    const stub = Object.assign(queue, {
      captureException: (...args: unknown[]) => {
        queue.push(['captureException', ...args]);
      },
    });
    Object.assign(window, { posthog: stub });
    render(
      <PosthogErrorBoundary
        fallback={({ exceptionEvent }) => <p>{exceptionEvent === undefined ? 'queued' : 'sent'}</p>}
      >
        <Boom />
      </PosthogErrorBoundary>
    );
    expect(screen.getByText('queued')).toBeTruthy();
    expect(queue[0]?.[0]).toBe('captureException');
  });
});

describe('setupReactErrorHandler', () => {
  it('sends the error with its component stack and hands the event to the callback', () => {
    const captureException = vi.fn<(error: unknown) => { uuid: string }>(() => ({
      uuid: 'event-id',
    }));
    Object.assign(window, { posthog: { captureException } });
    const callback = vi.fn<(event: unknown, error: unknown) => void>();
    const error = new Error('boom');

    setupReactErrorHandler(callback)(error, { componentStack: '\n    at Boom' });

    expect(captureException).toHaveBeenCalledWith(error);
    expect((error.cause as Error).stack).toBe('\n    at Boom');
    expect(callback).toHaveBeenCalledWith({ uuid: 'event-id' }, error, {
      componentStack: '\n    at Boom',
    });
  });

  it('never throws, and still calls the callback, without PostHog or when it fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const callback = vi.fn<(event: unknown) => void>();
    setupReactErrorHandler(callback)(new Error('boom'), {});
    Object.assign(window, {
      posthog: {
        captureException: () => {
          throw new Error('posthog failed');
        },
      },
    });
    setupReactErrorHandler(callback)(new Error('boom'), {});
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith(undefined, expect.any(Error), {});
  });
});
