// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://shop.example/checkout"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
    expect(script?.id).toBe('posthog');
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
