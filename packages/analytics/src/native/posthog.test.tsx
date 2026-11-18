// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import type { PostHogOptions } from 'posthog-react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Event = { event: string; properties?: Record<string, unknown> };
type BeforeSend = (event: Event) => Event | null;

/**
 * Stands in for `posthog-react-native`'s client, which needs the native runtime. Its
 * `captureException` builds the `$exception` as the library does (an `$exception_list` of
 * `type`/`value`) and runs it through the configured `before_send`, so what lands in `sent` is
 * what would reach PostHog.
 */
const { instances, sent } = vi.hoisted(() => ({
  instances: [] as { token: string; options: PostHogOptions }[],
  sent: [] as Event[],
}));
const capture = vi.fn<(name: string, properties?: object) => void>();
const identify = vi.fn<(id: string, properties?: object) => void>();
const reset = vi.fn<() => void>();
const captureException = vi.fn<(error: unknown, properties?: Record<string, unknown>) => void>();

class FakePostHog {
  constructor(
    token: string,
    private readonly options: PostHogOptions = {}
  ) {
    instances.push({ token, options });
  }
  capture = capture;
  identify = identify;
  reset = reset;
  captureException = (error: unknown, properties?: Record<string, unknown>) => {
    captureException(error, properties);
    const e = error instanceof Error ? error : new Error(String(error));
    let event: Event | null = {
      event: '$exception',
      properties: { $exception_list: [{ type: e.name, value: e.message }], ...properties },
    };
    for (const hook of [this.options.before_send ?? []].flat()) {
      if (!event) break;
      event = (hook as unknown as BeforeSend)(event);
    }
    if (event) sent.push(event);
  };
}

vi.mock(import('posthog-react-native'), () => ({ PostHog: FakePostHog as never }));

const config = { host: 'https://us.i.posthog.com' };
const token = 'phc_test' as const;

async function load() {
  return import('./posthog');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  instances.length = 0;
  sent.length = 0;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('posthogAnalytics', () => {
  it('forwards every track, identify and reset through setupAnalytics', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('[]')))
    );
    const { posthogAnalytics } = await load();
    const { baseOptions } = await import('../test/setup');
    const { setupAnalytics } = await import('../setup/index');
    const { track } = await import('../track/index');
    const visitor = await import('../visitor/index');
    setupAnalytics({ ...baseOptions(), integrations: [posthogAnalytics({ token, config })] });

    track('sign_up', { method: 'email' });
    visitor.identify('u1', { email: ['a@b.co'] });
    visitor.reset();

    expect(capture).toHaveBeenCalledWith('sign_up', { method: 'email' });
    expect(identify).toHaveBeenCalledWith('u1', { email: 'a@b.co' });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(instances).toEqual([{ token, options: config }]);
    vi.unstubAllGlobals();
  });

  it('creates one client, even when called again', async () => {
    const { posthogAnalytics, getPosthog } = await load();
    expect(getPosthog()).toBeUndefined();
    posthogAnalytics({ token, config });
    posthogAnalytics({ token, config, errorTracking: true });
    expect(instances).toHaveLength(1);
    expect(getPosthog()).toBeInstanceOf(FakePostHog);
  });

  it('leaves error tracking to the library config when errorTracking is left out', async () => {
    const { posthogAnalytics } = await load();
    posthogAnalytics({ token, config });
    expect(instances[0]?.options.errorTracking).toBeUndefined();
    expect(instances[0]?.options.before_send).toBeUndefined();
  });
});

describe('errorTracking', () => {
  it('turns on the library autocapture', async () => {
    const { posthogAnalytics } = await load();
    posthogAnalytics({ token, config, errorTracking: true });
    expect(instances[0]?.options.errorTracking).toEqual({ autocapture: true });
  });

  it('lets config.errorTracking.autocapture win', async () => {
    const { posthogAnalytics } = await load();
    const autocapture = { uncaughtExceptions: true, unhandledRejections: false };
    posthogAnalytics({
      token,
      config: { ...config, errorTracking: { autocapture } },
      errorTracking: { autocapture: true },
    });
    expect(instances[0]?.options.errorTracking).toEqual({ autocapture });
  });

  it('installs no autocapture and sends no exception when false', async () => {
    const { posthogAnalytics, capturePosthogException, PosthogErrorBoundary } = await load();
    posthogAnalytics({ token, config, errorTracking: false });
    expect(instances[0]?.options.errorTracking).toEqual({ autocapture: false });

    capturePosthogException(new Error('manual'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <PosthogErrorBoundary fallback={<p>failed</p>}>
        <Boom />
      </PosthogErrorBoundary>
    );

    expect(screen.getByText('failed')).toBeTruthy();
    // Both reached the client, and its before_send dropped them.
    expect(captureException).toHaveBeenCalledTimes(2);
    expect(sent).toEqual([]);
  });

  it('drops what ignoreErrors matches, by Type: message or message', async () => {
    const { posthogAnalytics, capturePosthogException } = await load();
    const hostHook = vi.fn<BeforeSend>((event) => event);
    posthogAnalytics({
      token,
      config: { ...config, before_send: hostHook as never },
      errorTracking: { ignoreErrors: ['Network request failed', /^TypeError: .*undefined/g] },
    });

    capturePosthogException(new Error('Network request failed'));
    // Twice: a `g` flag left in place would make the second `test` fail.
    capturePosthogException(new TypeError('x is undefined'));
    capturePosthogException(new TypeError('y is undefined'));
    capturePosthogException(new Error('kept'));

    expect(sent.map((e) => e.properties?.$exception_list)).toEqual([
      [{ type: 'Error', value: 'kept' }],
    ]);
    // The host's own hook runs after the filter, and never sees a dropped exception.
    expect(hostHook).toHaveBeenCalledTimes(1);
  });

  it('passes other events through', async () => {
    const { posthogAnalytics } = await load();
    posthogAnalytics({ token, config, errorTracking: false });
    const [filter] = [instances[0]?.options.before_send ?? []].flat() as unknown as BeforeSend[];
    const event = { event: 'sign_up', properties: { method: 'email' } };
    expect(filter(event)).toBe(event);
  });
});

describe('capturePosthogException', () => {
  it('is a no-op before posthogAnalytics', async () => {
    const { capturePosthogException } = await load();
    expect(() => capturePosthogException(new Error('early'))).not.toThrow();
    expect(captureException).not.toHaveBeenCalled();
  });

  it('sends the error with its properties', async () => {
    const { posthogAnalytics, capturePosthogException } = await load();
    posthogAnalytics({ token, config, errorTracking: true });
    const error = new Error('boom');
    capturePosthogException(error, { area: 'checkout' });
    expect(captureException).toHaveBeenCalledWith(error, { area: 'checkout' });
    expect(sent).toHaveLength(1);
  });

  it('never throws', async () => {
    const { posthogAnalytics, capturePosthogException } = await load();
    posthogAnalytics({ token, config });
    captureException.mockImplementationOnce(() => {
      throw new Error('library failure');
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => capturePosthogException(new Error('boom'))).not.toThrow();
    expect(logged).toHaveBeenCalled();
  });
});

function Boom(): never {
  throw new Error('boom');
}

describe('PosthogErrorBoundary', () => {
  it('reports the error once, with its component stack, and renders the fallback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const setGlobalHandler = vi.fn<(handler: unknown) => void>();
    vi.stubGlobal('ErrorUtils', { setGlobalHandler, getGlobalHandler: () => undefined });
    const { posthogAnalytics, PosthogErrorBoundary } = await load();
    posthogAnalytics({ token, config, errorTracking: true });

    render(
      <PosthogErrorBoundary
        additionalProperties={{ area: 'checkout' }}
        fallback={({ error, exceptionEvent }) => (
          <p>
            {(error as Error).message} {exceptionEvent === undefined ? 'no event' : 'event'}
          </p>
        )}
      >
        <Boom />
      </PosthogErrorBoundary>
    );

    expect(screen.getByText('boom no event')).toBeTruthy();
    expect(captureException).toHaveBeenCalledTimes(1);
    const [error, properties] = captureException.mock.calls[0] ?? [];
    expect((error as Error).message).toBe('boom');
    // Not chained as a cause, as on the web: the component frames would not symbolicate.
    expect((error as Error).cause).toBeUndefined();
    expect(properties).toMatchObject({ area: 'checkout' });
    expect(properties?.$exception_component_stack).toContain('Boom');
    // Uncaught errors are the library's autocapture: the SDK installs no handler of its own that
    // could report a caught error a second time.
    expect(setGlobalHandler).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('renders the children again on resetError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { posthogAnalytics, PosthogErrorBoundary } = await load();
    posthogAnalytics({ token, config, errorTracking: true });
    let fail = true;
    function Maybe() {
      if (fail) throw new Error('boom');
      return <p>fine</p>;
    }
    let resetError = () => {};

    render(
      <PosthogErrorBoundary
        fallback={(props) => {
          resetError = props.resetError;
          return <p>failed</p>;
        }}
      >
        <Maybe />
      </PosthogErrorBoundary>
    );
    expect(screen.getByText('failed')).toBeTruthy();

    fail = false;
    act(() => resetError());
    expect(screen.getByText('fine')).toBeTruthy();
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('still renders the fallback before posthogAnalytics', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { PosthogErrorBoundary } = await load();
    render(
      <PosthogErrorBoundary fallback={<p>failed</p>}>
        <Boom />
      </PosthogErrorBoundary>
    );
    expect(screen.getByText('failed')).toBeTruthy();
    expect(captureException).not.toHaveBeenCalled();
  });
});
