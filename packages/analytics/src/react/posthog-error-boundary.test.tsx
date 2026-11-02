// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PosthogErrorBoundary } from './posthog-error-boundary';

afterEach(() => {
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
});
