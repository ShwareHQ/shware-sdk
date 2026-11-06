// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://shop.example/checkout"}
import type { CaptureResult, PostHogConfig } from '@posthog/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  capturePosthogException,
  getLoadedPosthog,
  getPosthog,
  posthogAnalytics,
  sendPosthogEvent,
  setPosthogUser,
} from './posthog';

const capture = vi.fn<(name: string, properties?: object) => void>();
const reset = vi.fn<() => void>();
const identify = vi.fn<(distinctId: string, properties?: object) => void>();

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(window, { posthog: { capture, reset, identify } });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'posthog');
});

describe('sendPosthogEvent', () => {
  it('captures the event with its properties', () => {
    sendPosthogEvent('sign_up', { method: 'email' });
    expect(capture).toHaveBeenCalledWith('sign_up', { method: 'email' });
    expect(reset).not.toHaveBeenCalled();
  });

  it('captures a logout like any other event, without resetting the identity', () => {
    sendPosthogEvent('logout', undefined);
    expect(capture).toHaveBeenCalledWith('logout', undefined);
    expect(reset).not.toHaveBeenCalled();
  });

  it('drops web vitals', () => {
    sendPosthogEvent('LCP', { value: 1200 });
    expect(capture).not.toHaveBeenCalled();
  });

  it('says it is not ready before the snippet has run', () => {
    Reflect.deleteProperty(window, 'posthog');
    expect(sendPosthogEvent('sign_up', { method: 'email' })).toBe(false);
  });

  it('stays silent during local development', () => {
    const original = window.location.href;
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost:3000/'),
      configurable: true,
    });

    sendPosthogEvent('sign_up', { method: 'email' });
    expect(capture).not.toHaveBeenCalled();

    Object.defineProperty(window, 'location', { value: new URL(original), configurable: true });
  });
});

describe('setPosthogUser', () => {
  it('identifies as the user, with the email to match on', () => {
    setPosthogUser({ user_id: 'u1', user_data: { email: 'a@b.co' } });
    expect(identify).toHaveBeenCalledWith('u1', { email: 'a@b.co' });

    setPosthogUser({ user_id: 'u1' });
    expect(identify).toHaveBeenLastCalledWith('u1', { email: undefined });
  });

  it('resets the posthog identity on sign-out: reset() hands no user', () => {
    setPosthogUser({});
    expect(reset).toHaveBeenCalledTimes(1);
    expect(identify).not.toHaveBeenCalled();

    setPosthogUser({ user_id: 'u1' });
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe('posthogAnalytics', () => {
  it('inits the snippet with the token and config', () => {
    const { script } = posthogAnalytics({
      token: 'phc_test',
      config: { api_host: 'https://us.i.posthog.com', defaults: '2026-01-30' },
    });
    expect(script?.id).toBe('posthog-snippet');
    expect(script?.strategy).toBe('beforeInteractive');
    expect(script?.inline).toContain(
      'posthog.init("phc_test", {"api_host":"https://us.i.posthog.com","defaults":"2026-01-30"});'
    );
  });

  it('queues calls on the stub until the library loads', () => {
    Reflect.deleteProperty(window, 'posthog');
    const { script } = posthogAnalytics({
      token: 'phc_test',
      config: { api_host: 'https://us.i.posthog.com' },
    });
    document.head.append(document.createElement('script'));
    // Runs the snippet as the browser would: jsdom does not execute inline scripts by default.
    // oxlint-disable-next-line typescript/no-implied-eval
    new Function(script?.inline ?? '')();

    sendPosthogEvent('sign_up', { method: 'email' });
    const stub = getPosthog() as unknown as unknown[];
    expect(stub).toContainEqual(['capture', 'sign_up', { method: 'email' }]);
    expect(document.querySelector('script[src$="/static/array.js"]')?.getAttribute('src')).toBe(
      'https://us-assets.i.posthog.com/static/array.js'
    );
  });

  it('leaves an already loaded library in place when the snippet runs again', () => {
    for (const s of document.querySelectorAll('script[src$="/static/array.js"]')) s.remove();
    const init = vi.fn<() => undefined>();
    const loaded = { __loaded: true, init };
    Object.assign(window, { posthog: loaded });
    const { script } = posthogAnalytics({
      token: 'phc_test',
      config: { api_host: 'https://us.i.posthog.com' },
    });
    // oxlint-disable-next-line typescript/no-implied-eval
    new Function(script?.inline ?? '')();

    expect(getPosthog()).toBe(loaded);
    expect(init).toHaveBeenCalledWith('phc_test', { api_host: 'https://us.i.posthog.com' });
    expect(document.querySelector('script[src$="/static/array.js"]')).toBeNull();
  });
});

describe('getPosthog / getLoadedPosthog', () => {
  it('is undefined before the snippet has run', () => {
    Reflect.deleteProperty(window, 'posthog');
    expect(getPosthog()).toBeUndefined();
    expect(getLoadedPosthog()).toBeUndefined();
  });

  it('hands out the stub for queued calls, but only the loaded instance for values', () => {
    expect(getPosthog()).toBe(Reflect.get(window, 'posthog'));
    expect(getLoadedPosthog()).toBeUndefined();

    Object.assign(window, { posthog: { capture, reset, identify, __loaded: true } });
    expect(getLoadedPosthog()).toBe(Reflect.get(window, 'posthog'));
  });
});

describe('posthogAnalytics config', () => {
  it('cannot end the inline script early', () => {
    const { script } = posthogAnalytics({
      token: 'phc_test',
      config: {
        api_host: 'https://us.i.posthog.com',
        bootstrap: { distinctID: '</script><script>alert(1)</script>' },
      },
    });
    expect(script?.inline).not.toContain('</script>');
    expect(script?.inline).toContain('\\u003c/script>');
  });
});

describe('posthogAnalytics preconnect', () => {
  it('preconnects to the assets host the snippet loads array.js from', () => {
    const { preconnect } = posthogAnalytics({
      token: 'phc_test',
      config: { api_host: 'https://eu.i.posthog.com' },
    });
    expect(preconnect).toEqual(['https://eu-assets.i.posthog.com']);
  });

  it('needs none behind a same-origin reverse proxy', () => {
    const { preconnect } = posthogAnalytics({ token: 'phc_test', config: { api_host: '/ingest' } });
    expect(preconnect).toEqual([]);
  });

  it('works in browsers without URL.canParse (Safari < 17, Chrome < 120)', () => {
    // jsdom's URL inherits `canParse` from Node's, so shadow it rather than delete it.
    vi.stubGlobal(
      'URL',
      class extends URL {
        static override canParse = undefined as unknown as typeof URL.canParse;
      }
    );
    try {
      const absolute = posthogAnalytics({
        token: 'phc_test',
        config: { api_host: 'https://us.i.posthog.com' },
      });
      const relative = posthogAnalytics({ token: 'phc_test', config: { api_host: '/ingest' } });
      expect(absolute.preconnect).toEqual(['https://us-assets.i.posthog.com']);
      expect(relative.preconnect).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('posthogFlagsReady', () => {
  // One promise per page: each test gets a fresh module.
  async function load() {
    vi.resetModules();
    return import('./posthog');
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when the flags load, and is the same promise every call', async () => {
    let onFlags: () => void = () => {};
    Object.assign(window, {
      posthog: {
        onFeatureFlags: (callback: () => void) => {
          onFlags = callback;
        },
      },
    });
    const { posthogFlagsReady } = await load();
    const ready = posthogFlagsReady();
    expect(posthogFlagsReady()).toBe(ready);

    const resolved = vi.fn<() => void>();
    void ready.then(resolved);
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();

    onFlags();
    await ready;
    expect(resolved).toHaveBeenCalled();
  });

  it('gives up waiting after the timeout, e.g. when an ad blocker stops the library', async () => {
    vi.useFakeTimers();
    Object.assign(window, { posthog: { onFeatureFlags: () => {} } });
    const { posthogFlagsReady } = await load();
    const ready = posthogFlagsReady(1000);

    vi.advanceTimersByTime(1000);
    await expect(ready).resolves.toBeUndefined();
  });

  it('resolves on the timeout without the snippet too', async () => {
    vi.useFakeTimers();
    Reflect.deleteProperty(window, 'posthog');
    const { posthogFlagsReady } = await load();
    const ready = posthogFlagsReady(500);

    vi.advanceTimersByTime(500);
    await expect(ready).resolves.toBeUndefined();
  });
});

describe('capturePosthogException', () => {
  it('sends the error with its properties and returns the event', () => {
    const captureException = vi.fn<(error: unknown, properties?: object) => { uuid: string }>(
      () => ({ uuid: 'event-id' })
    );
    Object.assign(window, { posthog: { captureException } });
    const error = new Error('boom');

    expect(capturePosthogException(error, { area: 'upload' })).toEqual({ uuid: 'event-id' });
    expect(captureException).toHaveBeenCalledWith(error, { area: 'upload' });
  });

  it('never throws, without PostHog or when it fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Reflect.deleteProperty(window, 'posthog');
    expect(capturePosthogException(new Error('boom'))).toBeUndefined();

    Object.assign(window, {
      posthog: {
        captureException: () => {
          throw new Error('posthog failed');
        },
      },
    });
    expect(capturePosthogException(new Error('boom'))).toBeUndefined();
    vi.mocked(console.error).mockRestore();
  });
});

describe('posthogAnalytics errorTracking', () => {
  type InitConfig = Partial<PostHogConfig> & { before_send?: (e: CaptureResult) => unknown };

  /** Runs the snippet and returns the config it handed `posthog.init`. */
  function initConfig(errorTracking: Parameters<typeof posthogAnalytics>[0]['errorTracking']) {
    Reflect.deleteProperty(window, 'posthog');
    const { script } = posthogAnalytics({
      token: 'phc_test',
      config: { api_host: 'https://us.i.posthog.com' },
      errorTracking,
    });
    document.head.append(document.createElement('script'));
    // oxlint-disable-next-line typescript/no-implied-eval
    new Function(script?.inline ?? '')();
    const queued = Reflect.get(Reflect.get(window, 'posthog') as object, '_i') as unknown[][];
    return queued[0]?.[1] as InitConfig;
  }

  function exception(
    list: { type?: string; value?: string; frames?: { filename: string }[] }[]
  ): CaptureResult {
    return {
      uuid: 'id',
      event: '$exception',
      properties: {
        $exception_list: list.map(({ type, value, frames }) => ({
          type,
          value,
          stacktrace: frames && { type: 'raw', frames },
        })),
      },
    };
  }

  it('turns on exception autocapture and passes what no rule matches', () => {
    const config = initConfig(true);
    expect(config.capture_exceptions).toBe(true);
    const event = exception([{ type: 'Error', value: 'boom' }]);
    expect(config.before_send?.(event)).toBe(event);
  });

  it('never touches other events', () => {
    const config = initConfig(false);
    const event: CaptureResult = { uuid: 'id', event: 'sign_up', properties: {} };
    expect(config.before_send?.(event)).toBe(event);
  });

  it('drops errors matching ignoreErrors, by substring or regular expression', () => {
    const config = initConfig({ ignoreErrors: ['UET is not defined', /^Java object/i] });
    const drop = (type: string, value: string) =>
      config.before_send?.(exception([{ type, value }])) === null;

    expect(drop('ReferenceError', 'UET is not defined')).toBe(true);
    expect(drop('Error', 'java object is gone')).toBe(true);
    expect(drop('Error', 'Error invoking postMessage: Java object is gone')).toBe(false);
    expect(drop('Error', 'boom')).toBe(false);
  });

  it('matches every time with a global or sticky regular expression', () => {
    const config = initConfig({ ignoreErrors: [/UET/g, /^Java/y] });
    const uet = exception([{ type: 'ReferenceError', value: 'UET is not defined' }]);
    const java = exception([{ value: 'Java object is gone' }]);
    for (let i = 0; i < 3; i++) {
      expect(config.before_send?.(uet)).toBeNull();
      expect(config.before_send?.(java)).toBeNull();
    }
  });

  it('matches the type too, and every error in the chain', () => {
    const config = initConfig({ ignoreErrors: ['NotSupportedError: Missing request type.'] });
    const event = exception([
      { type: 'Error', value: 'one tap failed' },
      { type: 'NotSupportedError', value: 'Missing request type.' },
    ]);
    expect(config.before_send?.(event)).toBeNull();
  });

  it('drops errors thrown in a denied script, by the innermost frame only', () => {
    const config = initConfig({ denyUrls: ['/gsi/client'] });
    const gsi = { filename: 'https://accounts.google.com/gsi/client' };
    const app = { filename: 'https://example.com/assets/index.js' };

    expect(config.before_send?.(exception([{ value: 'pa', frames: [app, gsi] }]))).toBeNull();
    const callback = exception([{ value: 'ours', frames: [gsi, app] }]);
    expect(config.before_send?.(callback)).toBe(callback);
  });

  it('sends no exception at all when false', () => {
    const config = initConfig(false);
    expect(config.capture_exceptions).toBe(false);
    expect(config.before_send?.(exception([{ type: 'Error', value: 'boom' }]))).toBeNull();
  });

  it('lets config.capture_exceptions win over autocapture', () => {
    const { script } = posthogAnalytics({
      token: 'phc_test',
      config: { api_host: 'https://us.i.posthog.com', capture_exceptions: false },
      errorTracking: { autocapture: true },
    });
    expect(script?.inline).toContain('"capture_exceptions":false');
  });

  it('keeps its variables off window, and patterns cannot end the inline script', () => {
    const { script } = posthogAnalytics({
      token: 'phc_test',
      config: { api_host: 'https://us.i.posthog.com' },
      errorTracking: { ignoreErrors: ['</script><script>alert(1)</script>'] },
    });
    expect(script?.inline).not.toContain('</script>');
    initConfig(true);
    expect(Reflect.has(window, 'c')).toBe(false);
  });

  it('leaves the snippet as it was without the option', () => {
    const { script } = posthogAnalytics({
      token: 'phc_test',
      config: { api_host: 'https://us.i.posthog.com' },
    });
    expect(script?.inline).not.toContain('before_send');
  });
});
